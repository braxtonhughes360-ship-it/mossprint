import { beforeEach, describe, expect, it } from 'vitest'
// The app's better-sqlite3 build targets Electron's ABI, so unit tests use Node's built-in
// sqlite instead — the push module only touches prepare/get/all/run/exec, shared by both.
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../src/main/sqlite'
import {
  countPendingPushEvents,
  ensureCalendarPushColumns,
  getPushInfo,
  googleClientEventId,
  googleTokenHasWriteScope,
  listPendingPushDeletes,
  listPendingPushUpserts,
  reconcileGoogleCancellation,
  reconcileGoogleEcho,
  recordPushError,
  recordPushSuccess
} from '../src/main/calendarGooglePush'

/** The calendar_events schema as it shipped before the push columns (beta.4). */
const LEGACY_SCHEMA = `
  CREATE TABLE calendar_sources (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    sync_token TEXT,
    last_sync_at TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT REFERENCES calendar_sources(id) ON DELETE SET NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'local',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'general',
    course_id TEXT,
    recurrence_rule TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`

const NOW = '2026-07-03T12:00:00.000Z'

let db: SqliteDatabase

function insertEvent(overrides: Partial<Record<string, string | null>> = {}): string {
  const id = overrides.id ?? crypto.randomUUID()
  db.prepare(
    `
    INSERT INTO calendar_events (
      id, source_id, external_id, title, start_at, end_at, timezone,
      location, notes, kind, course_id, recurrence_rule, deleted_at,
      push_state, google_event_id, created_at, updated_at
    ) VALUES (
      @id, @source_id, @external_id, @title, @start_at, @end_at, 'local',
      @location, @notes, 'general', NULL, NULL, @deleted_at,
      @push_state, @google_event_id, @created_at, @updated_at
    )
  `
  ).run({
    id,
    source_id: null,
    external_id: null,
    title: 'Dentist',
    start_at: '2026-07-10T14:00:00.000Z',
    end_at: '2026-07-10T15:00:00.000Z',
    location: '',
    notes: '',
    deleted_at: null,
    push_state: null,
    google_event_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  })
  return id
}

function getRow(id: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function eventCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n
}

beforeEach(() => {
  db = new DatabaseSync(':memory:') as unknown as SqliteDatabase
  db.exec(LEGACY_SCHEMA)
  ensureCalendarPushColumns(db)
})

describe('ensureCalendarPushColumns (migration)', () => {
  it('adds push_state and google_event_id to a legacy table', () => {
    const fresh = new DatabaseSync(':memory:') as unknown as SqliteDatabase
    fresh.exec(LEGACY_SCHEMA)
    fresh
      .prepare(
        `INSERT INTO calendar_events (id, title, start_at, end_at, created_at, updated_at)
         VALUES ('legacy-1', 'Old event', @t, @t, @t, @t)`
      )
      .run({ t: NOW })

    expect(ensureCalendarPushColumns(fresh)).toBe(true)

    const columns = (fresh.prepare('PRAGMA table_info(calendar_events)').all() as Array<{
      name: string
    }>).map((col) => col.name)
    expect(columns).toContain('push_state')
    expect(columns).toContain('google_event_id')

    // Pre-existing rows are out of push scope (never surprise-uploaded).
    const legacy = fresh
      .prepare('SELECT push_state, google_event_id FROM calendar_events WHERE id = ?')
      .get('legacy-1') as { push_state: string | null; google_event_id: string | null }
    expect(legacy.push_state).toBeNull()
    expect(legacy.google_event_id).toBeNull()
  })

  it('is idempotent', () => {
    expect(ensureCalendarPushColumns(db)).toBe(false)
    expect(ensureCalendarPushColumns(db)).toBe(false)
  })
})

describe('echo protection (push → pull reconcile)', () => {
  it('reconciles a pushed event coming back in the pull — no duplicate', () => {
    const id = insertEvent({ push_state: 'pending' })
    recordPushSuccess(db, id, 'gid-123')

    const reconciled = reconcileGoogleEcho(db, 'gid-123', {
      title: 'Dentist',
      startAt: '2026-07-10T14:00:00.000Z',
      endAt: '2026-07-10T15:00:00.000Z',
      location: '',
      notes: ''
    })

    expect(reconciled).toBe(true)
    expect(eventCount()).toBe(1)
    const row = getRow(id)
    expect(row.push_state).toBe('pushed')
    expect(row.source_id).toBeNull()
  })

  it('falls back to the dashless MOSS UUID when the push crashed before recording the id', () => {
    const id = insertEvent({ push_state: 'pending' })
    const clientId = googleClientEventId(id)

    const reconciled = reconcileGoogleEcho(db, clientId, {
      title: 'Dentist',
      startAt: '2026-07-10T14:00:00.000Z',
      endAt: '2026-07-10T15:00:00.000Z',
      location: '',
      notes: ''
    })

    expect(reconciled).toBe(true)
    const row = getRow(id)
    expect(row.google_event_id).toBe(clientId)
    expect(row.push_state).toBe('pushed')
  })

  it('does not match unknown Google ids (source-linked upsert proceeds)', () => {
    insertEvent({ push_state: 'pending' })
    expect(
      reconcileGoogleEcho(db, 'someone-elses-event', {
        title: 'x',
        startAt: NOW,
        endAt: NOW,
        location: '',
        notes: ''
      })
    ).toBe(false)
  })

  it('edit conflict: the Google copy wins on pull (last-writer-wins, documented)', () => {
    const id = insertEvent({ push_state: 'pending', title: 'Local edit not yet pushed' })
    recordPushSuccess(db, id, 'gid-456')
    db.prepare(`UPDATE calendar_events SET title = 'Local edit', push_state = 'pending' WHERE id = ?`).run(id)

    reconcileGoogleEcho(db, 'gid-456', {
      title: 'Google edit',
      startAt: '2026-07-10T16:00:00.000Z',
      endAt: '2026-07-10T17:00:00.000Z',
      location: 'Room 4',
      notes: 'moved'
    })

    const row = getRow(id)
    expect(row.title).toBe('Google edit')
    expect(row.start_at).toBe('2026-07-10T16:00:00.000Z')
    expect(row.location).toBe('Room 4')
    expect(row.push_state).toBe('pushed')
  })

  it('cancellation echo soft-deletes the local MOSS-owned row', () => {
    const id = insertEvent({ push_state: 'pushed', google_event_id: 'gid-789' })
    expect(reconcileGoogleCancellation(db, 'gid-789')).toBe(true)
    expect(getRow(id).deleted_at).not.toBeNull()
    expect(reconcileGoogleCancellation(db, 'gid-unknown')).toBe(false)
  })
})

describe('push queue guards', () => {
  it('lists pending/errored MOSS-created events, never source-linked ones', () => {
    db.prepare(
      `INSERT INTO calendar_sources (id, kind, label, created_at) VALUES ('src-1', 'google', 'G', @t)`
    ).run({ t: NOW })
    const pending = insertEvent({ push_state: 'pending' })
    const errored = insertEvent({ push_state: 'error' })
    insertEvent({ push_state: null })
    insertEvent({ push_state: 'pushed', google_event_id: 'gid-1' })
    insertEvent({ source_id: 'src-1', external_id: 'ext-1', push_state: 'pending' })

    const upserts = listPendingPushUpserts(db).map((row) => row.id)
    expect(upserts).toContain(pending)
    expect(upserts).toContain(errored)
    expect(upserts).toHaveLength(2)
  })

  it('DELETE pushes require a MOSS-recorded google_event_id (never delete foreign events)', () => {
    const pushedThenDeleted = insertEvent({
      push_state: 'pending',
      google_event_id: 'gid-mine',
      deleted_at: NOW
    })
    // Deleted before it ever reached Google — nothing to delete upstream.
    insertEvent({ push_state: 'pending', deleted_at: NOW })

    const deletes = listPendingPushDeletes(db)
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toEqual({ id: pushedThenDeleted, google_event_id: 'gid-mine' })
  })

  it('counts the push backlog for the settings status line', () => {
    insertEvent({ push_state: 'pending' })
    insertEvent({ push_state: 'error' })
    insertEvent({ push_state: 'pending', google_event_id: 'gid-2', deleted_at: NOW })
    insertEvent({ push_state: null })
    insertEvent({ push_state: 'pushed', google_event_id: 'gid-3' })
    expect(countPendingPushEvents(db)).toBe(3)
  })

  it('recordPushError keeps the event queued for the next sync', () => {
    const id = insertEvent({ push_state: 'pending' })
    recordPushError(db, id)
    expect(getPushInfo(db, id)?.pushState).toBe('error')
    expect(listPendingPushUpserts(db).map((row) => row.id)).toContain(id)
  })
})

describe('scope + client id helpers', () => {
  it('detects write-capable tokens by scope', () => {
    expect(
      googleTokenHasWriteScope({
        scope: 'https://www.googleapis.com/auth/calendar.events'
      })
    ).toBe(true)
    expect(
      googleTokenHasWriteScope({ scope: 'https://www.googleapis.com/auth/calendar' })
    ).toBe(true)
    expect(
      googleTokenHasWriteScope({
        scope: 'https://www.googleapis.com/auth/calendar.readonly'
      })
    ).toBe(false)
    expect(
      googleTokenHasWriteScope({
        scope: 'https://www.googleapis.com/auth/calendar.events.readonly'
      })
    ).toBe(false)
    expect(googleTokenHasWriteScope({})).toBe(false)
    expect(googleTokenHasWriteScope(null)).toBe(false)
  })

  it('derives a Google-legal client event id from the MOSS UUID', () => {
    const id = googleClientEventId('AB12cd34-ef56-7890-ab12-cd34ef567890')
    // Google requires base32hex (0-9a-v), 5–1024 chars.
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/)
    expect(id).toBe('ab12cd34ef567890ab12cd34ef567890')
  })
})
