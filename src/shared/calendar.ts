export const CALENDAR_EVENT_KINDS = [
  'general',
  'class',
  'exam',
  'assignment',
  'office_hours'
] as const

export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number]

export const CALENDAR_SOURCE_KINDS = ['manual', 'ics_url', 'google', 'caldav'] as const

export type CalendarSourceKind = (typeof CALENDAR_SOURCE_KINDS)[number]

export interface CalendarSourceRecord {
  id: string
  kind: CalendarSourceKind
  label: string
  configJson: string
  syncToken: string | null
  lastSyncAt: string | null
  stale: boolean
  enabled: boolean
  createdAt: string
}

export interface CalendarEventRecord {
  id: string
  sourceId: string | null
  externalId: string | null
  title: string
  startAt: string
  endAt: string
  timezone: string
  location: string
  notes: string
  kind: CalendarEventKind
  courseId: string | null
  recurrenceRule: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CalendarEventRange {
  startAt: string
  endAt: string
}

export interface CreateCalendarEventInput {
  title: string
  startAt: string
  endAt: string
  location?: string
  notes?: string
  kind?: CalendarEventKind
}

export interface UpdateCalendarEventInput {
  title?: string
  startAt?: string
  endAt?: string
  location?: string
  notes?: string
  kind?: CalendarEventKind
}

export const CLASS_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export type ClassWeekday = (typeof CLASS_WEEKDAYS)[number]

export interface CreateClassScheduleInput {
  title: string
  location?: string
  days: ClassWeekday[]
  startTime: string
  endTime: string
  termStartKey: string
  termEndKey: string
}

export interface CreateClassScheduleResult {
  created: number
}

export interface CalendarWeekGlance {
  weekStartKey: string
  eventCount: number
  nextEvent: CalendarEventRecord | null
}

export interface CalendarMonthGlanceDay {
  dateKey: string
  count: number
  /** Has at least one academic-kind event (class/exam/assignment/office_hours). */
  hasAcademic: boolean
}

export interface CalendarMonthGlance {
  monthKey: string
  eventCount: number
  days: CalendarMonthGlanceDay[]
  nextEvent: CalendarEventRecord | null
}

export interface CalendarCaldavSubscribeInput {
  url: string
  label?: string
  username?: string
  password?: string
}

export interface CalendarDeleteEventResult {
  ok: true
  /** Whether a linked Google event was also deleted upstream. */
  remoteDeleted: boolean
  /** Why the upstream delete did not happen (e.g. needs reconnect with write scope). */
  remoteReason?: 'local-only' | 'reconnect-required' | 'sync-error' | 'no-credentials'
}

export interface CalendarIcsImportResult {
  sourceId: string
  label: string
  imported: number
  updated: number
}

export interface CalendarIcsPickResult {
  canceled: boolean
  sourceId?: string
  label?: string
  imported?: number
  updated?: number
}

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

export interface CalendarGoogleStatus {
  configured: boolean
  connected: boolean
  source: CalendarSourceRecord | null
}

/** Compact event slice for the door's today-timeline instrument. */
export interface CalendarDoorTimelineEvent {
  id: string
  title: string
  startAt: string
  endAt: string
  kind: CalendarEventKind
}

export interface CalendarDoorSnapshot {
  dateKey: string
  todayEventCount: number
  nextEvent: CalendarEventRecord | null
  nextAcademicEvent: CalendarEventRecord | null
  hasStaleSources: boolean
  /** Today's events (start-ordered, capped) for the door timeline strip. */
  todayTimeline: CalendarDoorTimelineEvent[]
}

export interface CalendarSyncAllResult {
  results: Array<{
    sourceId: string
    label: string
    kind: CalendarSourceKind
    imported: number
    updated: number
    stale: boolean
    error?: string
  }>
  staleCount: number
}

function parseDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) {
    throw new Error(`Invalid date key: ${dateKey}`)
  }
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  return new Date(year, month, day)
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function currentDateKey(): string {
  return formatDateKey(new Date())
}

/** Monday-start week containing the given local date key. */
export function startOfWeekKey(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + mondayOffset)
  return formatDateKey(date)
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + deltaDays)
  return formatDateKey(date)
}

export function shiftWeekKey(weekStartKey: string, deltaWeeks: number): string {
  const date = parseDateKey(weekStartKey)
  date.setDate(date.getDate() + deltaWeeks * 7)
  return formatDateKey(date)
}

export function weekDayKeys(weekStartKey: string): string[] {
  const start = parseDateKey(weekStartKey)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return formatDateKey(day)
  })
}

export function weekRangeIso(weekStartKey: string): CalendarEventRange {
  const start = parseDateKey(weekStartKey)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString()
  }
}

/** Month key 'YYYY-MM' for the local date key. */
export function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

export function currentMonthKey(): string {
  return monthKeyFromDateKey(currentDateKey())
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) {
    throw new Error(`Invalid month key: ${monthKey}`)
  }
  return { year: Number(match[1]), month: Number(match[2]) - 1 }
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month + deltaMonths, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** ISO range covering the whole month [first day 00:00, next month first day 00:00). */
export function monthRangeIso(monthKey: string): CalendarEventRange {
  const { year, month } = parseMonthKey(monthKey)
  return {
    startAt: new Date(year, month, 1).toISOString(),
    endAt: new Date(year, month + 1, 1).toISOString()
  }
}

/** Every local date key within the month, in order. */
export function monthDayKeys(monthKey: string): string[] {
  const { year, month } = parseMonthKey(monthKey)
  const keys: string[] = []
  const cursor = new Date(year, month, 1)
  while (cursor.getMonth() === month) {
    keys.push(formatDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

/**
 * Monday-start grid cells for a month — leading/trailing nulls pad to full weeks so the
 * 7-column month view aligns. Cells are date keys or null for padding.
 */
export function monthGridCells(monthKey: string): Array<string | null> {
  const days = monthDayKeys(monthKey)
  if (days.length === 0) return []
  const firstWeekday = ((parseDateKey(days[0]).getDay() + 6) % 7) // Monday = 0
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null)
  cells.push(...days)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey)
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1)
  )
}

export function formatWeekLabel(weekStartKey: string): string {
  const days = weekDayKeys(weekStartKey)
  const start = parseDateKey(days[0])
  const end = parseDateKey(days[6])
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

export function formatDayShortLabel(dateKey: string): string {
  const date = parseDateKey(dateKey)
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
}

export function formatDayStamp(dateKey: string): string {
  const date = parseDateKey(dateKey)
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)
}

export function formatTimeLabel(iso: string): string {
  const date = new Date(iso)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

/** Local calendar date key from an ISO timestamp. */
export function dateKeyFromIso(iso: string): string {
  const date = new Date(iso)
  return formatDateKey(date)
}

/** Prefix for door / glance: Today, Tomorrow, or short weekday date. */
export function formatEventScheduleLabel(startAtIso: string, todayKey = currentDateKey()): string {
  const eventKey = dateKeyFromIso(startAtIso)
  const time = formatTimeLabel(startAtIso)
  if (eventKey === todayKey) {
    return `Today ${time}`
  }
  const tomorrowKey = shiftDateKey(todayKey, 1)
  if (eventKey === tomorrowKey) {
    return `Tomorrow ${time}`
  }
  return `${formatDayShortLabel(eventKey)} ${time}`
}

export function isManualCalendarEvent(event: CalendarEventRecord): boolean {
  return event.sourceId === null
}

export function eventsOverlap(a: CalendarEventRecord, b: CalendarEventRecord): boolean {
  if (a.id === b.id) return false
  const aStart = new Date(a.startAt).getTime()
  const aEnd = new Date(a.endAt).getTime()
  const bStart = new Date(b.startAt).getTime()
  const bEnd = new Date(b.endAt).getTime()
  const maxTimedDurationMs = 10 * 60 * 60 * 1000
  if (aEnd - aStart > maxTimedDurationMs || bEnd - bStart > maxTimedDurationMs) {
    return false
  }
  return aStart < bEnd && bStart < aEnd
}

export function eventOnDateKey(event: CalendarEventRecord, dateKey: string): boolean {
  const dayStart = parseDateKey(dateKey)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayStart.getDate() + 1)
  const eventStart = new Date(event.startAt)
  const eventEnd = new Date(event.endAt)
  return eventStart < dayEnd && eventEnd > dayStart
}

export function formatEventKindLabel(kind: CalendarEventKind): string {
  switch (kind) {
    case 'class':
      return 'Class'
    case 'exam':
      return 'Exam'
    case 'assignment':
      return 'Assignment'
    case 'office_hours':
      return 'Office hours'
    default:
      return 'Event'
  }
}
