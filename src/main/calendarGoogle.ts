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

// `calendar.events` covers reading events (sync) AND deleting them (two-way delete write-back).
// Connections made before this change hold a read-only token; delete write-back surfaces a
// "reconnect" hint for them and still removes the event locally.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events']

export interface CalendarGoogleSyncResult {
  sourceId: string
  imported: number
  updated: number
  stale: boolean
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
): 'imported' | 'updated' {
  const existing = getDb()
    .prepare(
      `
      SELECT id FROM calendar_events
      WHERE source_id = @sourceId AND external_id = @externalId
    `
    )
    .get({ sourceId, externalId }) as { id: string } | undefined

  const updatedAt = new Date().toISOString()

  if (existing) {
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

export async function syncGoogleSource(sourceId: string): Promise<CalendarGoogleSyncResult> {
  const source = getGoogleSource(sourceId)
  if (!source || source.kind !== 'google') {
    throw new Error('Not a Google calendar source')
  }

  const configJson = JSON.parse(source.configJson) as { calendarId?: string }
  const calendarId = configJson.calendarId ?? 'primary'
  const { calendar } = buildOAuthClient(sourceId)

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
        } else {
          updated += 1
        }
      }

      pageToken = response.data.nextPageToken ?? undefined
      if (!pageToken && response.data.nextSyncToken) {
        nextSyncToken = response.data.nextSyncToken
      }
    } while (pageToken)

    touchSource(sourceId, nextSyncToken, false)
    return { sourceId, imported, updated, stale: false }
  } catch (error) {
    if (syncToken && isInvalidSyncTokenError(error)) {
      getDb().prepare('UPDATE calendar_sources SET sync_token = NULL WHERE id = ?').run(sourceId)
      return syncGoogleSource(sourceId)
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
} {
  const configured = isGoogleOAuthConfigured()
  const source = findGoogleSource()
  const connected = Boolean(source && readGoogleToken(source.id))
  return { configured, connected, source }
}

export { isGoogleOAuthConfigured, storeGoogleOAuthClientConfig }
