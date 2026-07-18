import type { SqliteDatabase } from './sqlite'

/**
 * Push-side sync state for MOSS-created events (source_id IS NULL) mirrored to the linked
 * Google calendar. Pure SQL helpers — no Electron imports — so reconciliation and the schema
 * migration stay unit-testable against an in-memory database.
 *
 * State machine (push_state, google_event_id):
 * - NULL, NULL          → not in push scope (created before Google was linked, or no link)
 * - 'pending', NULL     → created while linked; awaiting events.insert
 * - 'pending', <id>     → edited (awaiting events.patch) or deleted (awaiting events.delete)
 * - 'pushed', <id>      → Google has the current copy
 * - 'error', …          → last push failed; retried on next sync
 *
 * Echo protection: a pushed event returning in the next pull reconciles by google_event_id
 * (fallback: the dashless MOSS UUID used as the client-supplied Google id) instead of
 * inserting a source-linked duplicate. Conflict policy: the Google copy wins on pull.
 */

export type CalendarPushState = 'pending' | 'pushed' | 'error'

export interface CalendarPushUpsertRow {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string
  notes: string
  google_event_id: string | null
}

export interface CalendarPushDeleteRow {
  id: string
  google_event_id: string
}

/** Adds the push-state columns (idempotent). Returns true when a column was added. */
export function ensureCalendarPushColumns(db: SqliteDatabase): boolean {
  const columns = db.prepare('PRAGMA table_info(calendar_events)').all() as Array<{
    name: string
  }>
  const names = new Set(columns.map((col) => col.name))
  let added = false
  if (!names.has('push_state')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN push_state TEXT')
    added = true
  }
  if (!names.has('google_event_id')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN google_event_id TEXT')
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_calendar_events_google_push ON calendar_events(google_event_id)'
    )
    added = true
  }
  return added
}

/**
 * Google accepts client-supplied event ids in base32hex (chars 0-9a-v, length 5–1024).
 * A dashless UUID satisfies that, and makes inserts idempotent: if MOSS crashes after
 * events.insert but before recording the id, the retry 409s instead of duplicating.
 */
export function googleClientEventId(mossEventId: string): string {
  return mossEventId.replace(/-/g, '').toLowerCase()
}

/** MOSS-created events awaiting insert/patch (pending or errored, not deleted). */
export function listPendingPushUpserts(db: SqliteDatabase): CalendarPushUpsertRow[] {
  return db
    .prepare(
      `
      SELECT id, title, start_at, end_at, location, notes, google_event_id
      FROM calendar_events
      WHERE source_id IS NULL
        AND deleted_at IS NULL
        AND push_state IN ('pending', 'error')
      ORDER BY created_at ASC
    `
    )
    .all() as CalendarPushUpsertRow[]
}

/**
 * MOSS-created events deleted locally that still need the upstream delete. Requires
 * google_event_id — MOSS only ever deletes Google events it pushed itself.
 */
export function listPendingPushDeletes(db: SqliteDatabase): CalendarPushDeleteRow[] {
  return db
    .prepare(
      `
      SELECT id, google_event_id
      FROM calendar_events
      WHERE source_id IS NULL
        AND deleted_at IS NOT NULL
        AND google_event_id IS NOT NULL
        AND push_state IN ('pending', 'error')
      ORDER BY updated_at ASC
    `
    )
    .all() as CalendarPushDeleteRow[]
}

export function recordPushSuccess(
  db: SqliteDatabase,
  eventId: string,
  googleEventId: string
): void {
  db.prepare(
    `
    UPDATE calendar_events
    SET push_state = 'pushed', google_event_id = @googleEventId
    WHERE id = @eventId
  `
  ).run({ eventId, googleEventId })
}

export function recordPushError(db: SqliteDatabase, eventId: string): void {
  db.prepare(`UPDATE calendar_events SET push_state = 'error' WHERE id = ?`).run(eventId)
}

export function countPendingPushEvents(db: SqliteDatabase): number {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS n
      FROM calendar_events
      WHERE source_id IS NULL
        AND push_state IN ('pending', 'error')
        AND (deleted_at IS NULL OR google_event_id IS NOT NULL)
    `
    )
    .get() as { n: number }
  return row.n
}

export function getPushInfo(
  db: SqliteDatabase,
  eventId: string
): { pushState: CalendarPushState | null; googleEventId: string | null } | null {
  const row = db
    .prepare('SELECT push_state, google_event_id FROM calendar_events WHERE id = ?')
    .get(eventId) as { push_state: CalendarPushState | null; google_event_id: string | null } | undefined
  return row ? { pushState: row.push_state, googleEventId: row.google_event_id } : null
}

export interface GoogleEchoFields {
  title: string
  startAt: string
  endAt: string
  location: string
  notes: string
}

/**
 * Reconciles a pulled Google event against a MOSS-pushed local row. 'updated' / 'unchanged'
 * mean a match was found (the caller must then skip the source-linked upsert — echo
 * protection); 'unchanged' additionally means the row already carried the Google copy, so
 * nothing was written and the echo must not count toward sync stats. The Google copy wins:
 * local fields are overwritten (last-writer-wins, Google on pull).
 */
export function reconcileGoogleEcho(
  db: SqliteDatabase,
  googleEventId: string,
  fields: GoogleEchoFields
): 'updated' | 'unchanged' | 'none' {
  const match = findPushedLocalRow(db, googleEventId)
  if (!match) {
    return 'none'
  }

  if (
    match.push_state === 'pushed' &&
    match.google_event_id === googleEventId &&
    match.title === fields.title &&
    match.start_at === fields.startAt &&
    match.end_at === fields.endAt &&
    match.location === fields.location &&
    match.notes === fields.notes
  ) {
    return 'unchanged'
  }

  db.prepare(
    `
    UPDATE calendar_events
    SET title = @title,
        start_at = @startAt,
        end_at = @endAt,
        location = @location,
        notes = @notes,
        push_state = 'pushed',
        google_event_id = @googleEventId,
        updated_at = @updatedAt
    WHERE id = @id
  `
  ).run({
    id: match.id,
    googleEventId,
    updatedAt: new Date().toISOString(),
    ...fields
  })
  return 'updated'
}

/**
 * A pushed event cancelled upstream: soft-delete the local copy (Google wins on pull).
 * Returns true when a local row was matched.
 */
export function reconcileGoogleCancellation(db: SqliteDatabase, googleEventId: string): boolean {
  const match = findPushedLocalRow(db, googleEventId)
  if (!match) {
    return false
  }

  // Already soft-deleted with the push state settled — a full re-sync replaying the
  // cancellation has nothing left to write.
  if (
    match.deleted_at !== null &&
    match.push_state === 'pushed' &&
    match.google_event_id === googleEventId
  ) {
    return true
  }

  const updatedAt = new Date().toISOString()
  db.prepare(
    `
    UPDATE calendar_events
    SET deleted_at = COALESCE(deleted_at, @updatedAt),
        push_state = 'pushed',
        google_event_id = @googleEventId,
        updated_at = @updatedAt
    WHERE id = @id
  `
  ).run({ id: match.id, googleEventId, updatedAt })
  return true
}

interface PushedLocalRow {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string
  notes: string
  push_state: string | null
  google_event_id: string | null
  deleted_at: string | null
}

function findPushedLocalRow(db: SqliteDatabase, googleEventId: string): PushedLocalRow | null {
  // Primary match: the recorded Google id. Fallback: the dashless-UUID client id covers a
  // crash between events.insert and recordPushSuccess.
  const row = db
    .prepare(
      `
      SELECT id, title, start_at, end_at, location, notes, push_state, google_event_id, deleted_at
      FROM calendar_events
      WHERE source_id IS NULL
        AND (google_event_id = @googleEventId
             OR (google_event_id IS NULL
                 AND push_state IS NOT NULL
                 AND lower(replace(id, '-', '')) = @googleEventId))
      LIMIT 1
    `
    )
    .get({ googleEventId }) as PushedLocalRow | undefined
  return row ?? null
}

/**
 * True when a stored Google token carries a scope that allows event writes. Connections made
 * before the write scope shipped hold `calendar.readonly` and must reconnect to push.
 */
export function googleTokenHasWriteScope(token: Record<string, unknown> | null): boolean {
  if (!token || typeof token.scope !== 'string') {
    return false
  }
  const scopes = token.scope.split(/\s+/)
  return (
    scopes.includes('https://www.googleapis.com/auth/calendar.events') ||
    scopes.includes('https://www.googleapis.com/auth/calendar')
  )
}
