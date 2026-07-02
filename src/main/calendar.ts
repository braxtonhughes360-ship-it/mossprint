import { randomUUID } from 'node:crypto'
import type {
  CalendarDoorSnapshot,
  CalendarEventKind,
  CalendarEventRecord,
  CalendarEventRange,
  CalendarMonthGlance,
  CalendarMonthGlanceDay,
  CalendarSourceRecord,
  CalendarWeekGlance,
  ClassWeekday,
  CreateCalendarEventInput,
  CreateClassScheduleInput,
  CreateClassScheduleResult,
  UpdateCalendarEventInput
} from '@shared/calendar'
import {
  CALENDAR_EVENT_KINDS,
  currentDateKey,
  eventOnDateKey,
  monthDayKeys,
  monthRangeIso,
  startOfWeekKey,
  weekRangeIso
} from '@shared/calendar'
import { getDb } from './database'

const EVENT_KIND_SET = new Set<string>(CALENDAR_EVENT_KINDS)

function assertEventKind(value: string): CalendarEventKind {
  if (!EVENT_KIND_SET.has(value)) {
    throw new Error(`Invalid event kind: ${value}`)
  }
  return value as CalendarEventKind
}

function rowToEvent(row: {
  id: string
  source_id: string | null
  external_id: string | null
  title: string
  start_at: string
  end_at: string
  timezone: string
  location: string
  notes: string
  kind: string
  course_id: string | null
  recurrence_rule: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}): CalendarEventRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalId: row.external_id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    location: row.location,
    notes: row.notes,
    kind: assertEventKind(row.kind),
    courseId: row.course_id,
    recurrenceRule: row.recurrence_rule,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
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

export function listCalendarEvents(range: CalendarEventRange): CalendarEventRecord[] {
  const rows = getDb()
    .prepare(
      `
      SELECT
        e.id, e.source_id, e.external_id, e.title, e.start_at, e.end_at, e.timezone,
        e.location, e.notes, e.kind, e.course_id, e.recurrence_rule, e.deleted_at,
        e.created_at, e.updated_at
      FROM calendar_events e
      LEFT JOIN calendar_sources s ON s.id = e.source_id
      WHERE e.deleted_at IS NULL
        AND (e.source_id IS NULL OR s.enabled = 1)
        AND e.start_at < @endAt
        AND e.end_at > @startAt
      ORDER BY e.start_at ASC, e.title ASC
    `
    )
    .all(range) as Array<{
    id: string
    source_id: string | null
    external_id: string | null
    title: string
    start_at: string
    end_at: string
    timezone: string
    location: string
    notes: string
    kind: string
    course_id: string | null
    recurrence_rule: string | null
    deleted_at: string | null
    created_at: string
    updated_at: string
  }>

  return rows.map(rowToEvent)
}

export function listCalendarSources(): CalendarSourceRecord[] {
  const rows = getDb()
    .prepare(
      `
      SELECT id, kind, label, config_json, sync_token, last_sync_at, stale, enabled, created_at
      FROM calendar_sources
      ORDER BY label ASC
    `
    )
    .all() as Array<{
    id: string
    kind: string
    label: string
    config_json: string
    sync_token: string | null
    last_sync_at: string | null
    stale: number
    enabled: number
    created_at: string
  }>

  return rows.map(rowToSource)
}

export function hasStaleCalendarSources(): boolean {
  return listCalendarSources().some((source) => source.enabled && source.stale)
}

export function getCalendarSourceById(sourceId: string): CalendarSourceRecord | null {
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

export function getCalendarWeekGlance(weekStartKey: string): CalendarWeekGlance {
  const range = weekRangeIso(weekStartKey)
  const events = listCalendarEvents(range)
  const now = new Date().toISOString()
  const nextEvent = events.find((event) => event.endAt >= now) ?? null

  return {
    weekStartKey,
    eventCount: events.length,
    nextEvent
  }
}

export function getCalendarMonthGlance(monthKey: string): CalendarMonthGlance {
  const range = monthRangeIso(monthKey)
  const events = listCalendarEvents(range)
  const now = new Date().toISOString()
  const nextEvent = events.find((event) => event.endAt >= now) ?? null

  const days: CalendarMonthGlanceDay[] = monthDayKeys(monthKey).map((dateKey) => {
    const dayEvents = events.filter((event) => eventOnDateKey(event, dateKey))
    return {
      dateKey,
      count: dayEvents.length,
      hasAcademic: dayEvents.some((event) => ACADEMIC_KINDS.has(event.kind))
    }
  })

  return {
    monthKey,
    eventCount: events.length,
    days,
    nextEvent
  }
}

export function getCalendarEventById(id: string): CalendarEventRecord | null {
  const row = getDb()
    .prepare(
      `
      SELECT
        id, source_id, external_id, title, start_at, end_at, timezone,
        location, notes, kind, course_id, recurrence_rule, deleted_at,
        created_at, updated_at
      FROM calendar_events
      WHERE id = ?
    `
    )
    .get(id) as Parameters<typeof rowToEvent>[0] | undefined

  return row ? rowToEvent(row) : null
}

export function setCalendarSourceEnabled(sourceId: string, enabled: boolean): { ok: true } {
  const result = getDb()
    .prepare('UPDATE calendar_sources SET enabled = @enabled WHERE id = @sourceId')
    .run({ sourceId, enabled: enabled ? 1 : 0 })
  if (result.changes === 0) {
    throw new Error('Calendar source not found')
  }
  return { ok: true }
}

export function createCalendarEvent(input: CreateCalendarEventInput): CalendarEventRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const updatedAt = createdAt
  const kind = input.kind ? assertEventKind(input.kind) : 'general'

  getDb()
    .prepare(
      `
      INSERT INTO calendar_events (
        id, source_id, external_id, title, start_at, end_at, timezone,
        location, notes, kind, course_id, recurrence_rule, deleted_at,
        created_at, updated_at
      ) VALUES (
        @id, NULL, NULL, @title, @startAt, @endAt, 'local',
        @location, @notes, @kind, NULL, NULL, NULL,
        @createdAt, @updatedAt
      )
    `
    )
    .run({
      id,
      title: input.title.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      kind,
      createdAt,
      updatedAt
    })

  const row = getDb()
    .prepare(
      `
      SELECT
        id, source_id, external_id, title, start_at, end_at, timezone,
        location, notes, kind, course_id, recurrence_rule, deleted_at,
        created_at, updated_at
      FROM calendar_events
      WHERE id = ?
    `
    )
    .get(id) as {
    id: string
    source_id: string | null
    external_id: string | null
    title: string
    start_at: string
    end_at: string
    timezone: string
    location: string
    notes: string
    kind: string
    course_id: string | null
    recurrence_rule: string | null
    deleted_at: string | null
    created_at: string
    updated_at: string
  }

  return rowToEvent(row)
}

export function updateCalendarEvent(id: string, patch: UpdateCalendarEventInput): CalendarEventRecord {
  const existing = getDb()
    .prepare('SELECT id FROM calendar_events WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { id: string } | undefined

  if (!existing) {
    throw new Error('Event not found')
  }

  const updatedAt = new Date().toISOString()

  getDb()
    .prepare(
      `
      UPDATE calendar_events SET
        title = COALESCE(@title, title),
        start_at = COALESCE(@startAt, start_at),
        end_at = COALESCE(@endAt, end_at),
        location = COALESCE(@location, location),
        notes = COALESCE(@notes, notes),
        kind = COALESCE(@kind, kind),
        updated_at = @updatedAt
      WHERE id = @id
    `
    )
    .run({
      id,
      title: patch.title?.trim(),
      startAt: patch.startAt,
      endAt: patch.endAt,
      location: patch.location?.trim(),
      notes: patch.notes?.trim(),
      kind: patch.kind ? assertEventKind(patch.kind) : undefined,
      updatedAt
    })

  const row = getDb()
    .prepare(
      `
      SELECT
        id, source_id, external_id, title, start_at, end_at, timezone,
        location, notes, kind, course_id, recurrence_rule, deleted_at,
        created_at, updated_at
      FROM calendar_events
      WHERE id = ?
    `
    )
    .get(id) as {
    id: string
    source_id: string | null
    external_id: string | null
    title: string
    start_at: string
    end_at: string
    timezone: string
    location: string
    notes: string
    kind: string
    course_id: string | null
    recurrence_rule: string | null
    deleted_at: string | null
    created_at: string
    updated_at: string
  }

  return rowToEvent(row)
}

const CLASS_DAY_OFFSET: Record<ClassWeekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6
}

function parseDateKeyLocal(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) {
    throw new Error(`Invalid date key: ${dateKey}`)
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatDateKeyLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function weekdayOffsetLocal(date: Date): number {
  const jsDay = date.getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

function parseClock(value: string, field: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    throw new Error(`${field} must be HH:MM`)
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new Error(`${field} is out of range`)
  }
  return { hour, minute }
}

function buildLocalIso(dateKey: string, hour: number, minute: number): string {
  const date = parseDateKeyLocal(dateKey)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

export function createClassSchedule(input: CreateClassScheduleInput): CreateClassScheduleResult {
  const title = input.title.trim()
  if (!title) {
    throw new Error('Class title is required')
  }

  if (!input.days.length) {
    throw new Error('Select at least one weekday')
  }

  const startClock = parseClock(input.startTime, 'startTime')
  const endClock = parseClock(input.endTime, 'endTime')
  const startMinutes = startClock.hour * 60 + startClock.minute
  const endMinutes = endClock.hour * 60 + endClock.minute
  if (endMinutes <= startMinutes) {
    throw new Error('End time must be after start time')
  }

  const termStart = parseDateKeyLocal(input.termStartKey)
  const termEnd = parseDateKeyLocal(input.termEndKey)
  if (termEnd < termStart) {
    throw new Error('Semester end must be on or after semester start')
  }

  const wantedOffsets = new Set(input.days.map((day) => CLASS_DAY_OFFSET[day]))
  const cursor = new Date(termStart)
  let created = 0

  while (cursor <= termEnd) {
    if (wantedOffsets.has(weekdayOffsetLocal(cursor))) {
      const dateKey = formatDateKeyLocal(cursor)
      createCalendarEvent({
        title,
        startAt: buildLocalIso(dateKey, startClock.hour, startClock.minute),
        endAt: buildLocalIso(dateKey, endClock.hour, endClock.minute),
        location: input.location?.trim(),
        kind: 'class'
      })
      created += 1
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  if (created === 0) {
    throw new Error('No class meetings created — check start date and weekdays')
  }

  return { created }
}

export function deleteCalendarEvent(id: string): { ok: true } {
  const updatedAt = new Date().toISOString()
  const result = getDb()
    .prepare(
      `
      UPDATE calendar_events
      SET deleted_at = @updatedAt, updated_at = @updatedAt
      WHERE id = @id AND deleted_at IS NULL
    `
    )
    .run({ id, updatedAt })

  if (result.changes === 0) {
    throw new Error('Event not found')
  }

  return { ok: true }
}

export function getCurrentWeekGlance(): CalendarWeekGlance {
  return getCalendarWeekGlance(startOfWeekKey(currentDateKey()))
}

const ACADEMIC_KINDS = new Set(['class', 'exam', 'assignment', 'office_hours'])

export function getCalendarDoorSnapshot(): CalendarDoorSnapshot {
  const dateKey = currentDateKey()
  const now = new Date()
  const dayStart = new Date(`${dateKey}T00:00:00`)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + 14)

  const todayEvents = listCalendarEvents({
    startAt: dayStart.toISOString(),
    endAt: dayEnd.toISOString()
  })

  const upcoming = listCalendarEvents({
    startAt: now.toISOString(),
    endAt: horizon.toISOString()
  })

  const nextEvent =
    upcoming.find((event) => new Date(event.endAt) >= now) ??
    listCalendarEvents({
      startAt: dayStart.toISOString(),
      endAt: horizon.toISOString()
    }).find((event) => new Date(event.endAt) >= now) ??
    null

  const nextAcademicEvent =
    upcoming.find((event) => ACADEMIC_KINDS.has(event.kind) && new Date(event.endAt) >= now) ??
    null

  const todayTimeline = todayEvents.slice(0, 16).map((event) => ({
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    kind: event.kind
  }))

  return {
    dateKey,
    todayEventCount: todayEvents.length,
    nextEvent,
    nextAcademicEvent,
    hasStaleSources: hasStaleCalendarSources(),
    todayTimeline
  }
}
