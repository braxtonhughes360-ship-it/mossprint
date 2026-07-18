import { randomUUID } from 'node:crypto'
import ical, { type CalendarResponse, type ParameterValue, type VEvent } from 'node-ical'
import type { CalendarIcsImportResult } from '@shared/calendar'
import { getDb } from './database'

const IMPORT_PAST_DAYS = 90
const IMPORT_FUTURE_DAYS = 365

function paramText(value: ParameterValue | undefined, fallback = 'Untitled'): string {
  if (typeof value === 'string') {
    return value.trim() || fallback
  }

  if (value && typeof value === 'object' && 'val' in value) {
    const text = String((value as { val: string }).val).trim()
    return text || fallback
  }

  return fallback
}

function dateToIso(value: Date | { toISOString?: () => string } | undefined): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value.toISOString === 'function') {
    return value.toISOString()
  }

  return null
}

function importWindow(): { from: Date; to: Date } {
  const from = new Date()
  from.setDate(from.getDate() - IMPORT_PAST_DAYS)
  const to = new Date()
  to.setDate(to.getDate() + IMPORT_FUTURE_DAYS)
  return { from, to }
}

type SubscribableSourceKind = 'ics_url' | 'caldav'

function findOrCreateSource(
  label: string,
  config: Record<string, string>,
  kind: SubscribableSourceKind = 'ics_url'
): { id: string; created: boolean } {
  const configJson = JSON.stringify(config)
  const existing = getDb()
    .prepare('SELECT id FROM calendar_sources WHERE kind = ? AND config_json = ?')
    .get(kind, configJson) as { id: string } | undefined

  if (existing) {
    return { id: existing.id, created: false }
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `
      INSERT INTO calendar_sources (
        id, kind, label, config_json, sync_token, last_sync_at, stale, enabled, created_at
      ) VALUES (
        @id, @kind, @label, @configJson, NULL, @createdAt, 0, 1, @createdAt
      )
    `
    )
    .run({ id, kind, label, configJson, createdAt })

  return { id, created: true }
}

function touchSource(sourceId: string): void {
  const lastSyncAt = new Date().toISOString()
  getDb()
    .prepare(
      `
      UPDATE calendar_sources
      SET last_sync_at = @lastSyncAt, stale = 0, label = label
      WHERE id = @sourceId
    `
    )
    .run({ sourceId, lastSyncAt })
}

function upsertImportedEvent(
  sourceId: string,
  externalId: string,
  title: string,
  startAt: string,
  endAt: string,
  location: string,
  notes: string,
  recurrenceRule: string | null
): 'imported' | 'updated' | 'unchanged' {
  const existing = getDb()
    .prepare(
      `
      SELECT id, title, start_at, end_at, location, notes, recurrence_rule, deleted_at
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
        recurrence_rule: string | null
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
      existing.notes === notes &&
      existing.recurrence_rule === recurrenceRule
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
          recurrence_rule = @recurrenceRule,
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
        recurrenceRule,
        updatedAt
      })
    return 'updated'
  }

  const id = randomUUID()
  const createdAt = updatedAt

  getDb()
    .prepare(
      `
      INSERT INTO calendar_events (
        id, source_id, external_id, title, start_at, end_at, timezone,
        location, notes, kind, course_id, recurrence_rule, deleted_at,
        created_at, updated_at
      ) VALUES (
        @id, @sourceId, @externalId, @title, @startAt, @endAt, 'local',
        @location, @notes, 'general', NULL, @recurrenceRule, NULL,
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
      recurrenceRule,
      createdAt,
      updatedAt
    })

  return 'imported'
}

function recurrenceRuleText(event: VEvent): string | null {
  if (!event.rrule) {
    return null
  }

  try {
    return JSON.stringify(event.rrule)
  } catch {
    return null
  }
}

function collectInstances(parsed: CalendarResponse): Array<{
  uid: string
  startAt: string
  endAt: string
  title: string
  location: string
  notes: string
  recurrenceRule: string | null
}> {
  const window = importWindow()
  const instances: Array<{
    uid: string
    startAt: string
    endAt: string
    title: string
    location: string
    notes: string
    recurrenceRule: string | null
  }> = []

  for (const [key, component] of Object.entries(parsed)) {
    if (key === 'vcalendar' || !component || typeof component !== 'object') {
      continue
    }

    if ((component as VEvent).type !== 'VEVENT') {
      continue
    }

    const event = component as VEvent
    const recurrenceRule = recurrenceRuleText(event)
    const expanded = ical.expandRecurringEvent(event, {
      from: window.from,
      to: window.to,
      includeOverrides: true,
      excludeExdates: true,
      expandOngoing: true
    })

    for (const instance of expanded) {
      const startAt = dateToIso(instance.start)
      if (!startAt) {
        continue
      }

      let endAt = dateToIso(instance.end)
      if (!endAt) {
        const end = new Date(startAt)
        end.setHours(end.getHours() + 1)
        endAt = end.toISOString()
      }

      const externalId = `${event.uid}::${startAt}`
      instances.push({
        uid: externalId,
        startAt,
        endAt,
        title: paramText(instance.summary, paramText(event.summary)),
        location: paramText(event.location, ''),
        notes: paramText(event.description, ''),
        recurrenceRule
      })
    }
  }

  return instances
}

export function importParsedIcs(
  parsed: CalendarResponse,
  label: string,
  config: Record<string, string>,
  existingSourceId?: string,
  kind: SubscribableSourceKind = 'ics_url'
): CalendarIcsImportResult {
  const sourceId = existingSourceId ?? findOrCreateSource(label, config, kind).id
  const rows = collectInstances(parsed)

  let imported = 0
  let updated = 0
  const seenExternalIds: string[] = []

  for (const row of rows) {
    seenExternalIds.push(row.uid)
    const result = upsertImportedEvent(
      sourceId,
      row.uid,
      row.title,
      row.startAt,
      row.endAt,
      row.location,
      row.notes,
      row.recurrenceRule
    )
    if (result === 'imported') {
      imported += 1
    } else if (result === 'updated') {
      updated += 1
    }
  }

  purgeMissingImportedEvents(sourceId, seenExternalIds)

  touchSource(sourceId)

  return {
    sourceId,
    label,
    imported,
    updated
  }
}

function purgeMissingImportedEvents(sourceId: string, seenExternalIds: string[]): number {
  const seen = new Set(seenExternalIds)
  const updatedAt = new Date().toISOString()
  const rows = getDb()
    .prepare(
      `
      SELECT external_id FROM calendar_events
      WHERE source_id = @sourceId AND deleted_at IS NULL AND external_id IS NOT NULL
    `
    )
    .all({ sourceId }) as Array<{ external_id: string }>

  let removed = 0
  for (const row of rows) {
    if (!seen.has(row.external_id)) {
      getDb()
        .prepare(
          `
          UPDATE calendar_events
          SET deleted_at = @updatedAt, updated_at = @updatedAt
          WHERE source_id = @sourceId AND external_id = @externalId AND deleted_at IS NULL
        `
        )
        .run({ sourceId, externalId: row.external_id, updatedAt })
      removed += 1
    }
  }
  return removed
}

function markSourceStale(sourceId: string): void {
  getDb().prepare('UPDATE calendar_sources SET stale = 1 WHERE id = ?').run(sourceId)
}

function clearSourceStale(sourceId: string): void {
  getDb().prepare('UPDATE calendar_sources SET stale = 0 WHERE id = ?').run(sourceId)
}

export async function syncIcsSource(sourceId: string): Promise<CalendarIcsImportResult> {
  const row = getDb()
    .prepare(
      'SELECT id, label, config_json FROM calendar_sources WHERE id = ? AND kind = ? AND enabled = 1'
    )
    .get(sourceId, 'ics_url') as { id: string; label: string; config_json: string } | undefined

  if (!row) {
    throw new Error('ICS calendar source not found')
  }

  const config = JSON.parse(row.config_json) as Record<string, string>
  const url = config.url?.trim()
  if (!url) {
    throw new Error('ICS source has no URL — subscribe again in Settings')
  }

  try {
    const parsed = await ical.async.fromURL(url)
    const result = importParsedIcs(parsed, row.label, config, sourceId)
    clearSourceStale(sourceId)
    return result
  } catch (err) {
    markSourceStale(sourceId)
    throw err
  }
}

export async function importIcsFromPath(
  filePath: string,
  label?: string
): Promise<CalendarIcsImportResult> {
  const parsed = await ical.async.parseFile(filePath)
  const fileLabel = label ?? filePath.split(/[/\\]/).pop() ?? 'ICS import'
  return importParsedIcs(parsed, fileLabel, { filePath })
}

export async function importIcsFromUrl(url: string, label?: string): Promise<CalendarIcsImportResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http(s) ICS URLs are supported')
  }

  const response = await ical.async.fromURL(url)
  const urlLabel = label ?? parsed.hostname
  return importParsedIcs(response, urlLabel, { url })
}

export function importIcsFromString(content: string, label: string): CalendarIcsImportResult {
  const parsed = ical.sync.parseICS(content)
  return importParsedIcs(parsed, label, { inline: label })
}
