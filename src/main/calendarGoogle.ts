import { randomUUID } from 'node:crypto'
import { google, type calendar_v3 } from 'googleapis'
import type { CalendarSourceRecord } from '@shared/calendar'
import { getCalendarSourceById } from './calendar'
import { getDb } from './database'
import {
  createGoogleOAuthClient,
  createGoogleOAuthClientForRedirect,
  isGoogleOAuthConfigured,
  runGoogleOAuthLoopback,
  storeGoogleOAuthClientConfig
} from './googleOAuth'
import {
  deleteGoogleToken,
  readGoogleToken,
  storeGoogleToken
} from './calendarCredentials'
import {
  countPendingPushEvents,
  getPushInfo,
  googleClientEventId,
  googleTokenHasWriteScope,
  listPendingPushDeletes,
  listPendingPushUpserts,
  reconcileGoogleCancellation,
  reconcileGoogleEcho,
  recordPushError,
  recordPushSuccess,
  type CalendarPushState,
  type CalendarPushUpsertRow
} from './calendarGooglePush'

// `calendar.events` covers reading events (sync) AND deleting them (two-way delete write-back).
// Connections made before this change hold a read-only token; delete write-back surfaces a
// "reconnect" hint for them and still removes the event locally.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events']

export interface CalendarGoogleSyncResult {
  sourceId: string
  imported: number
  updated: number
  stale: boolean
  /** MOSS-created events pushed to Google during this sync (insert/update/delete). */
  pushed?: number
  /** Push attempts that failed and stay queued for the next sync. */
  pushErrors?: number
}

export interface CalendarGooglePushResult {
  pushed: number
  failed: number
  /** True when the stored token lacks the write scope — Settings shows the Reconnect hint. */
  reconnectRequired: boolean
}

export interface CalendarGoogleConnectResult {
  sourceId: string
  label: string
  imported: number
  updated: number
}

function rowToSource(row: {
  id: string
  kind: string
  label: string
  config_json: string
  sync_token: string | null
  last_sync_at: string | null
  stale: number
  enabled: number
  created_at: string
}): CalendarSourceRecord {
  return {
    id: row.id,
    kind: row.kind as CalendarSourceRecord['kind'],
    label: row.label,
    configJson: row.config_json,
    syncToken: row.sync_token,
    lastSyncAt: row.last_sync_at,
    stale: row.stale === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at
  }
}

function getGoogleSource(sourceId: string): CalendarSourceRecord | null {
  const row = getDb()
    .prepare(
      `
      SELECT id, kind, label, config_json, sync_token, last_sync_at, stale, enabled, created_at
      FROM calendar_sources
      WHERE id = ?
    `
    )
    .get(sourceId) as {
    id: string
    kind: string
    label: string
    config_json: string
    sync_token: string | null
    last_sync_at: string | null
    stale: number
    enabled: number
    created_at: string
  } | undefined

  return row ? rowToSource(row) : null
}

function findGoogleSource(): CalendarSourceRecord | null {
  const row = getDb()
    .prepare(
      `
      SELECT id, kind, label, config_json, sync_token, last_sync_at, stale, enabled, created_at
      FROM calendar_sources
      WHERE kind = 'google' AND enabled = 1
      ORDER BY created_at ASC
      LIMIT 1
    `
    )
    .get() as {
    id: string
    kind: string
    label: string
    config_json: string
    sync_token: string | null
    last_sync_at: string | null
    stale: number
    enabled: number
    created_at: string
  } | undefined

  return row ? rowToSource(row) : null
}

function createGoogleSource(label: string, calendarId = 'primary'): string {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const configJson = JSON.stringify({ calendarId })

  getDb()
    .prepare(
      `
      INSERT INTO calendar_sources (
        id, kind, label, config_json, sync_token, last_sync_at, stale, enabled, created_at
      ) VALUES (
        @id, 'google', @label, @configJson, NULL, NULL, 0, 1, @createdAt
      )
    `
    )
    .run({ id, label, configJson, createdAt })

  return id
}

function touchSource(sourceId: string, syncToken: string | null, stale = false): void {
  const lastSyncAt = new Date().toISOString()
  getDb()
    .prepare(
      `
      UPDATE calendar_sources
      SET last_sync_at = @lastSyncAt, sync_token = @syncToken, stale = @stale
      WHERE id = @sourceId
    `
    )
    .run({ sourceId, lastSyncAt, syncToken, stale: stale ? 1 : 0 })
}

function markSourceStale(sourceId: string): void {
  getDb().prepare('UPDATE calendar_sources SET stale = 1 WHERE id = ?').run(sourceId)
}

function upsertGoogleEvent(
  sourceId: string,
  externalId: string,
  title: string,
  startAt: string,
  endAt: string,
  location: string,
  notes: string
): 'imported' | 'updated' | 'unchanged' {
  const existing = getDb()
    .prepare(
      `
      SELECT id, title, start_at, end_at, location, notes, deleted_at
      FROM calendar_events
      WHERE source_id = @sourceId AND external_id = @externalId
    `
    )
    .get({ sourceId, externalId }) as
    | {
        id: string
        title: string
        start_at: string
        end_at: string
        location: string
        notes: string
        deleted_at: string | null
      }
    | undefined

  const updatedAt = new Date().toISOString()

  if (existing) {
    if (
      existing.deleted_at === null &&
      existing.title === title &&
      existing.start_at === startAt &&
      existing.end_at === endAt &&
      existing.location === location &&
      existing.notes === notes
    ) {
      return 'unchanged'
    }

    getDb()
      .prepare(
        `
        UPDATE calendar_events SET
          title = @title,
          start_at = @startAt,
          end_at = @endAt,
          location = @location,
          notes = @notes,
          deleted_at = NULL,
          updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id: existing.id,
        title,
        startAt,
        endAt,
        location,
        notes,
        updatedAt
      })
    return 'updated'
  }

  const id = randomUUID()
  getDb()
    .prepare(
      `
      INSERT INTO calendar_events (
        id, source_id, external_id, title, start_at, end_at, timezone,
        location, notes, kind, course_id, recurrence_rule, deleted_at,
        created_at, updated_at
      ) VALUES (
        @id, @sourceId, @externalId, @title, @startAt, @endAt, 'local',
        @location, @notes, 'general', NULL, NULL, NULL,
        @createdAt, @updatedAt
      )
    `
    )
    .run({
      id,
      sourceId,
      externalId,
      title,
      startAt,
      endAt,
      location,
      notes,
      createdAt: updatedAt,
      updatedAt
    })

  return 'imported'
}

function softDeleteGoogleEvent(sourceId: string, externalId: string): void {
  const updatedAt = new Date().toISOString()
  getDb()
    .prepare(
      `
      UPDATE calendar_events
      SET deleted_at = @updatedAt, updated_at = @updatedAt
      WHERE source_id = @sourceId AND external_id = @externalId AND deleted_at IS NULL
    `
    )
    .run({ sourceId, externalId, updatedAt })
}

function googleEventTimes(event: calendar_v3.Schema$Event): { startAt: string; endAt: string } | null {
  const startRaw = event.start?.dateTime ?? event.start?.date
  if (!startRaw) {
    return null
  }

  const endRaw = event.end?.dateTime ?? event.end?.date ?? startRaw
  const startAt = new Date(startRaw).toISOString()
  const endAt = new Date(endRaw).toISOString()
  return { startAt, endAt }
}

function isInvalidSyncTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const status = (error as { code?: number; response?: { status?: number } }).response?.status
  return status === 410 || status === 404
}

function buildOAuthClient(sourceId: string): {
  oauth2: InstanceType<typeof google.auth.OAuth2>
  calendar: calendar_v3.Calendar
} {
  const tokens = readGoogleToken(sourceId)
  if (!tokens) {
    throw new Error('Google Calendar credentials missing — reconnect')
  }

  const oauth2 = createGoogleOAuthClient()
  oauth2.setCredentials(tokens)
  oauth2.on('tokens', (nextTokens) => {
    const merged = { ...tokens, ...nextTokens }
    storeGoogleToken(sourceId, merged)
  })

  return {
    oauth2,
    calendar: google.calendar({ version: 'v3', auth: oauth2 })
  }
}

export async function connectGoogleCalendar(
  label = 'Google Calendar'
): Promise<CalendarGoogleConnectResult> {
  if (!isGoogleOAuthConfigured()) {
    throw new Error(
      'Google sign-in is not set up yet. Ask your household admin to add OAuth once — see Settings → Calendar.'
    )
  }

  const { code, redirectUri, codeVerifier } = await runGoogleOAuthLoopback(SCOPES)
  const oauth2 = createGoogleOAuthClientForRedirect(redirectUri)
  const { tokens } = await oauth2.getToken({ code, codeVerifier })
  if (!tokens.access_token) {
    throw new Error('Google OAuth did not return an access token')
  }

  const existing = findGoogleSource()
  const sourceId = existing?.id ?? createGoogleSource(label)
  storeGoogleToken(sourceId, tokens as Record<string, unknown>)

  const sync = await syncGoogleSource(sourceId)
  return {
    sourceId,
    label: existing?.label ?? label,
    imported: sync.imported,
    updated: sync.updated
  }
}

function pushRequestBody(row: CalendarPushUpsertRow): calendar_v3.Schema$Event {
  return {
    summary: row.title,
    location: row.location || undefined,
    description: row.notes || undefined,
    start: { dateTime: row.start_at },
    end: { dateTime: row.end_at }
  }
}

async function pushUpsertRow(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  row: CalendarPushUpsertRow
): Promise<void> {
  const requestBody = pushRequestBody(row)

  if (row.google_event_id) {
    try {
      await calendar.events.patch({ calendarId, eventId: row.google_event_id, requestBody })
      recordPushSuccess(getDb(), row.id, row.google_event_id)
    } catch (error) {
      const status = googleErrorStatus(error)
      if (status === 404 || status === 410) {
        // Deleted upstream — the Google copy wins; the pull cancels the local row next.
        recordPushSuccess(getDb(), row.id, row.google_event_id)
        return
      }
      throw error
    }
    return
  }

  // Client-supplied id (dashless MOSS UUID) makes the insert idempotent: a retry after a
  // crash-before-record 409s instead of duplicating the event in Google.
  const clientEventId = googleClientEventId(row.id)
  try {
    const response = await calendar.events.insert({
      calendarId,
      requestBody: { ...requestBody, id: clientEventId }
    })
    recordPushSuccess(getDb(), row.id, response.data.id ?? clientEventId)
  } catch (error) {
    if (googleErrorStatus(error) !== 409) {
      throw error
    }
    await calendar.events.patch({ calendarId, eventId: clientEventId, requestBody })
    recordPushSuccess(getDb(), row.id, clientEventId)
  }
}

async function pushPendingWithClient(
  calendar: calendar_v3.Calendar,
  calendarId: string
): Promise<CalendarGooglePushResult> {
  let pushed = 0
  let failed = 0

  for (const row of listPendingPushUpserts(getDb())) {
    try {
      await pushUpsertRow(calendar, calendarId, row)
      pushed += 1
    } catch (error) {
      const status = googleErrorStatus(error)
      if (status === 401 || status === 403) {
        return { pushed, failed, reconnectRequired: true }
      }
      recordPushError(getDb(), row.id)
      failed += 1
    }
  }

  // Deletes are guarded upstream: only rows whose google_event_id MOSS itself recorded on a
  // successful push are listed — MOSS never deletes a Google event it didn't create.
  for (const row of listPendingPushDeletes(getDb())) {
    try {
      await calendar.events.delete({ calendarId, eventId: row.google_event_id })
      recordPushSuccess(getDb(), row.id, row.google_event_id)
      pushed += 1
    } catch (error) {
      const status = googleErrorStatus(error)
      if (status === 404 || status === 410) {
        // Already gone upstream — MOSS and Google agree.
        recordPushSuccess(getDb(), row.id, row.google_event_id)
        pushed += 1
      } else if (status === 401 || status === 403) {
        return { pushed, failed, reconnectRequired: true }
      } else {
        recordPushError(getDb(), row.id)
        failed += 1
      }
    }
  }

  return { pushed, failed, reconnectRequired: false }
}

/**
 * Best-effort push of queued MOSS-created events to the linked Google calendar. Never throws:
 * failures stay queued ('pending'/'error') and retry on the next sync. Called fire-and-forget
 * after event CRUD and as the first phase of syncGoogleSource.
 */
export async function pushPendingGoogleEvents(): Promise<CalendarGooglePushResult> {
  const none: CalendarGooglePushResult = { pushed: 0, failed: 0, reconnectRequired: false }
  try {
    const source = findGoogleSource()
    if (!source) return none
    const tokens = readGoogleToken(source.id)
    if (!tokens) return none
    if (!googleTokenHasWriteScope(tokens)) {
      return { ...none, reconnectRequired: true }
    }
    if (countPendingPushEvents(getDb()) === 0) return none

    const configJson = JSON.parse(source.configJson) as { calendarId?: string }
    const calendarId = configJson.calendarId ?? 'primary'
    const { calendar } = buildOAuthClient(source.id)
    return await pushPendingWithClient(calendar, calendarId)
  } catch {
    // Events stay queued; pendingPushCount in the Google status surfaces the backlog.
    return { ...none, failed: 1 }
  }
}

export async function syncGoogleSource(sourceId: string): Promise<CalendarGoogleSyncResult> {
  const source = getGoogleSource(sourceId)
  if (!source || source.kind !== 'google') {
    throw new Error('Not a Google calendar source')
  }

  const configJson = JSON.parse(source.configJson) as { calendarId?: string }
  const calendarId = configJson.calendarId ?? 'primary'
  const { calendar } = buildOAuthClient(sourceId)

  // Push before pull: queued local edits reach Google first, so the pull's echo of them is
  // a reconcile, not a conflict. Read-only tokens skip the push entirely (pull unchanged).
  let pushed = 0
  let pushErrors = 0
  if (googleTokenHasWriteScope(readGoogleToken(sourceId))) {
    const pushResult = await pushPendingWithClient(calendar, calendarId)
    pushed = pushResult.pushed
    pushErrors = pushResult.failed
  }

  let imported = 0
  let updated = 0
  let syncToken = source.syncToken
  let nextSyncToken: string | null = syncToken
  let pageToken: string | undefined

  try {
    do {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId,
        singleEvents: true,
        showDeleted: true,
        maxResults: 250
      }

      if (syncToken) {
        params.syncToken = syncToken
      } else {
        const timeMin = new Date()
        timeMin.setDate(timeMin.getDate() - 90)
        const timeMax = new Date()
        timeMax.setDate(timeMax.getDate() + 365)
        params.timeMin = timeMin.toISOString()
        params.timeMax = timeMax.toISOString()
      }

      if (pageToken) {
        params.pageToken = pageToken
      }

      const response = await calendar.events.list(params)
      const items = response.data.items ?? []

      for (const event of items) {
        if (!event.id) {
          continue
        }

        if (event.status === 'cancelled') {
          // Echo protection: a MOSS-pushed event cancelled upstream soft-deletes the local
          // MOSS-owned row; source-linked rows take the existing path.
          reconcileGoogleCancellation(getDb(), event.id)
          softDeleteGoogleEvent(sourceId, event.id)
          continue
        }

        const times = googleEventTimes(event)
        if (!times) {
          continue
        }

        const title = event.summary?.trim() || 'Untitled event'
        const location = event.location?.trim() ?? ''
        const notes = event.description?.trim() ?? ''

        // Echo protection: a pushed MOSS event returning in the pull reconciles into its
        // original local row (Google copy wins) instead of inserting a duplicate.
        const echo = reconcileGoogleEcho(getDb(), event.id, {
          title,
          startAt: times.startAt,
          endAt: times.endAt,
          location,
          notes
        })
        if (echo !== 'none') {
          if (echo === 'updated') {
            updated += 1
          }
          continue
        }

        const result = upsertGoogleEvent(
          sourceId,
          event.id,
          title,
          times.startAt,
          times.endAt,
          location,
          notes
        )

        if (result === 'imported') {
          imported += 1
        } else if (result === 'updated') {
          updated += 1
        }
      }

      pageToken = response.data.nextPageToken ?? undefined
      if (!pageToken && response.data.nextSyncToken) {
        nextSyncToken = response.data.nextSyncToken
      }
    } while (pageToken)

    touchSource(sourceId, nextSyncToken, false)
    return { sourceId, imported, updated, stale: false, pushed, pushErrors }
  } catch (error) {
    if (syncToken && isInvalidSyncTokenError(error)) {
      getDb().prepare('UPDATE calendar_sources SET sync_token = NULL WHERE id = ?').run(sourceId)
      const retry = await syncGoogleSource(sourceId)
      return {
        ...retry,
        pushed: (retry.pushed ?? 0) + pushed,
        pushErrors: (retry.pushErrors ?? 0) + pushErrors
      }
    }

    markSourceStale(sourceId)
    throw error
  }
}

export async function syncCalendarSource(sourceId: string): Promise<CalendarGoogleSyncResult> {
  const source = getCalendarSourceById(sourceId)
  if (!source) {
    throw new Error('Calendar source not found')
  }

  if (source.kind === 'google') {
    return syncGoogleSource(sourceId)
  }

  if (source.kind === 'ics_url') {
    const { syncIcsSource } = await import('./calendarIcs')
    const result = await syncIcsSource(sourceId)
    return {
      sourceId: result.sourceId,
      imported: result.imported,
      updated: result.updated,
      stale: false
    }
  }

  if (source.kind === 'caldav') {
    const { syncCaldavSource } = await import('./calendarCaldav')
    const result = await syncCaldavSource(sourceId)
    return {
      sourceId: result.sourceId,
      imported: result.imported,
      updated: result.updated,
      stale: false
    }
  }

  throw new Error(`Sync is not implemented for source kind: ${source.kind}`)
}

function googleErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const withResponse = error as { code?: number | string; response?: { status?: number } }
  if (typeof withResponse.response?.status === 'number') return withResponse.response.status
  if (typeof withResponse.code === 'number') return withResponse.code
  return null
}

/**
 * Best-effort upstream delete for a Google-synced event. Returns whether the remote delete
 * happened; the local soft-delete is the caller's responsibility and always proceeds.
 */
export async function deleteGoogleRemoteEvent(
  sourceId: string,
  externalId: string
): Promise<{ deleted: boolean; reason?: 'reconnect-required' | 'sync-error' | 'no-credentials' }> {
  const source = getGoogleSource(sourceId)
  if (!source || source.kind !== 'google') {
    return { deleted: false, reason: 'sync-error' }
  }
  if (!readGoogleToken(sourceId)) {
    return { deleted: false, reason: 'no-credentials' }
  }

  const configJson = JSON.parse(source.configJson) as { calendarId?: string }
  const calendarId = configJson.calendarId ?? 'primary'

  try {
    const { calendar } = buildOAuthClient(sourceId)
    await calendar.events.delete({ calendarId, eventId: externalId })
    return { deleted: true }
  } catch (error) {
    const status = googleErrorStatus(error)
    // Already gone upstream — treat as success so MOSS and Google agree.
    if (status === 404 || status === 410) return { deleted: true }
    // Read-only token (connected before write scope) — caller should prompt a reconnect.
    if (status === 401 || status === 403) return { deleted: false, reason: 'reconnect-required' }
    return { deleted: false, reason: 'sync-error' }
  }
}

/** Push bookkeeping for one event (used by the delete IPC to report remote outcome). */
export function getCalendarEventPushInfo(
  eventId: string
): { pushState: CalendarPushState | null; googleEventId: string | null } | null {
  return getPushInfo(getDb(), eventId)
}

export function disconnectGoogleCalendar(sourceId: string): { ok: true } {
  const source = getGoogleSource(sourceId)
  if (!source || source.kind !== 'google') {
    throw new Error('Not a Google calendar source')
  }

  deleteGoogleToken(sourceId)
  getDb().prepare('UPDATE calendar_sources SET enabled = 0, stale = 0 WHERE id = ?').run(sourceId)
  return { ok: true }
}

export function getGoogleCalendarStatus(): {
  configured: boolean
  connected: boolean
  source: CalendarSourceRecord | null
  writeCapable: boolean
  pendingPushCount: number
} {
  const configured = isGoogleOAuthConfigured()
  const source = findGoogleSource()
  const tokens = source ? readGoogleToken(source.id) : null
  const connected = Boolean(source && tokens)
  return {
    configured,
    connected,
    source,
    // Connections made before the write scope shipped hold a read-only token — Settings
    // shows the one-line "Reconnect" affordance until the user re-consents.
    writeCapable: connected && googleTokenHasWriteScope(tokens),
    pendingPushCount: countPendingPushEvents(getDb())
  }
}

export { isGoogleOAuthConfigured, storeGoogleOAuthClientConfig }
