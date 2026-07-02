import type { CalendarEventKind } from './calendar'
import { startOfWeekKey } from './calendar'

export interface ParsedQuickEvent {
  title: string
  dateKey: string | null
  hour: number | null
  minute: number
  durationMinutes: number
  kind: CalendarEventKind | null
}

const WEEKDAY_OFFSET: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  thurs: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6
}

const KIND_HINTS: Array<{ pattern: RegExp; kind: CalendarEventKind }> = [
  { pattern: /\bexam\b/i, kind: 'exam' },
  { pattern: /\b(?:office hours|office-hours)\b/i, kind: 'office_hours' },
  { pattern: /\b(?:assignment|homework|due)\b/i, kind: 'assignment' },
  { pattern: /\b(?:class|lecture|lab|section)\b/i, kind: 'class' }
]

function parseDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) {
    throw new Error(`Invalid date key: ${dateKey}`)
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + deltaDays)
  return formatDateKey(date)
}

function weekdayOffsetFromDate(date: Date): number {
  const jsDay = date.getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

/** Next occurrence of weekday from today (Mon=0). Same weekday = today. */
function resolveMonthDay(todayKey: string, monthToken: string, day: number): string | null {
  const monthMap: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  }
  const month = monthMap[monthToken.toLowerCase()]
  if (month === undefined || day < 1 || day > 31) {
    return null
  }

  const today = parseDateKey(todayKey)
  let year = today.getFullYear()
  const candidate = new Date(year, month, day)
  if (candidate < today) {
    year += 1
  }
  return formatDateKey(new Date(year, month, day))
}

function resolveWeekdayDateKey(
  todayKey: string,
  weekday: string,
  modifier: 'next' | 'this' | null
): string | null {
  const targetOffset = WEEKDAY_OFFSET[weekday.toLowerCase()]
  if (targetOffset === undefined) {
    return null
  }

  const todayOffset = weekdayOffsetFromDate(parseDateKey(todayKey))
  let delta = (targetOffset - todayOffset + 7) % 7

  if (modifier === 'next') {
    if (delta === 0) {
      delta = 7
    }
  }

  return shiftDateKey(todayKey, delta)
}

function parseClockToken(rawHour: string, rawMinute: string | undefined, meridiem?: string): {
  hour: number
  minute: number
} | null {
  let hour = Number(rawHour)
  const minute = rawMinute ? Number(rawMinute) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null
  }

  const mer = meridiem?.toLowerCase()
  if (mer === 'am' || mer === 'pm') {
    if (hour < 1 || hour > 12) return null
    if (mer === 'am') {
      hour = hour === 12 ? 0 : hour
    } else {
      hour = hour === 12 ? 12 : hour + 12
    }
  } else if (hour > 23) {
    return null
  }

  return { hour, minute }
}

function extractTime(text: string): {
  remainder: string
  hour: number | null
  minute: number
} {
  let remainder = text
  let hour: number | null = null
  let minute = 0

  const bareHourPattern = /\b(?:at|@)\s*(\d{1,2})\b(?!\s*(?:am|pm|:|\d))/i
  const patterns = [
    /\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\b(?:at|@)\s*(\d{1,2}):(\d{2})\b/i,
    bareHourPattern,
    /\b(\d{1,2}):(\d{2})\b/
  ]

  for (const pattern of patterns) {
    const match = remainder.match(pattern)
    if (!match) continue

    const isBareHour = pattern.source === bareHourPattern.source
    let parsed = isBareHour
      ? parseClockToken(match[1], undefined, Number(match[1]) === 12 ? 'pm' : 'pm')
      : parseClockToken(match[1], match[2], match[3])
    if (!parsed) continue
    hour = parsed.hour
    minute = parsed.minute
    remainder = remainder.replace(match[0], ' ')
    break
  }

  return { remainder, hour, minute }
}

function extractDateKey(text: string, todayKey: string): { remainder: string; dateKey: string | null } {
  let remainder = text
  let dateKey: string | null = null
  const WORD_WEEKS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 }

  if (/\btoday\b/i.test(remainder)) {
    dateKey = todayKey
    remainder = remainder.replace(/\btoday\b/i, ' ')
  } else if (/\btomorrow\b/i.test(remainder)) {
    dateKey = shiftDateKey(todayKey, 1)
    remainder = remainder.replace(/\btomorrow\b/i, ' ')
  }

  const inDaysMatch = remainder.match(/\bin\s+(\d+)\s+days?\b/i)
  if (!dateKey && inDaysMatch) {
    dateKey = shiftDateKey(todayKey, Number(inDaysMatch[1]))
    remainder = remainder.replace(inDaysMatch[0], ' ')
  }

  const inWeeksMatch = remainder.match(
    /\bin\s+(\d+|one|two|three|four)\s+weeks?\b(?:\s+from\s+now)?/i
  )
  if (!dateKey && inWeeksMatch) {
    const raw = inWeeksMatch[1].toLowerCase()
    const weeks = WORD_WEEKS[raw] ?? Number(raw)
    if (Number.isFinite(weeks) && weeks > 0) {
      dateKey = shiftDateKey(todayKey, weeks * 7)
      remainder = remainder.replace(inWeeksMatch[0], ' ')
    }
  }

  const nextWeekMatch = remainder.match(/\bnext\s+week\b/i)
  if (!dateKey && nextWeekMatch) {
    dateKey = shiftDateKey(todayKey, 7)
    remainder = remainder.replace(nextWeekMatch[0], ' ')
  }

  const monthDayMatch = remainder.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  )
  if (!dateKey && monthDayMatch) {
    dateKey = resolveMonthDay(todayKey, monthDayMatch[1], Number(monthDayMatch[2]))
    remainder = remainder.replace(monthDayMatch[0], ' ')
  }

  const nextWeekdayMatch = remainder.match(
    /\bnext\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i
  )
  if (!dateKey && nextWeekdayMatch) {
    dateKey = resolveWeekdayDateKey(todayKey, nextWeekdayMatch[1], 'next')
    remainder = remainder.replace(nextWeekdayMatch[0], ' ')
  }

  const thisWeekdayMatch = remainder.match(
    /\bthis\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i
  )
  if (!dateKey && thisWeekdayMatch) {
    dateKey = resolveWeekdayDateKey(todayKey, thisWeekdayMatch[1], 'this')
    remainder = remainder.replace(thisWeekdayMatch[0], ' ')
  }

  const weekdayMatch = remainder.match(
    /\b(?:on\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i
  )
  if (weekdayMatch) {
    const weekday = weekdayMatch[1]
    if (dateKey) {
      const weekStart = startOfWeekKey(dateKey)
      dateKey = resolveWeekdayDateKey(weekStart, weekday, 'this')
    } else {
      dateKey = resolveWeekdayDateKey(todayKey, weekday, null)
    }
    remainder = remainder.replace(weekdayMatch[0], ' ')
  }

  return { remainder, dateKey }
}

function extractDuration(text: string): { remainder: string; durationMinutes: number } {
  let remainder = text
  let durationMinutes = 60

  const hourMatch = remainder.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i)
  if (hourMatch) {
    durationMinutes = Math.round(Number(hourMatch[1]) * 60)
    remainder = remainder.replace(hourMatch[0], ' ')
  }

  const minuteMatch = remainder.match(/\bfor\s+(\d+)\s*(?:minutes?|mins?|m)\b/i)
  if (minuteMatch) {
    durationMinutes = Number(minuteMatch[1])
    remainder = remainder.replace(minuteMatch[0], ' ')
  }

  return { remainder, durationMinutes }
}

function extractKind(text: string): { remainder: string; kind: CalendarEventKind | null } {
  let remainder = text
  let kind: CalendarEventKind | null = null

  for (const hint of KIND_HINTS) {
    if (hint.pattern.test(remainder)) {
      kind = hint.kind
      remainder = remainder.replace(hint.pattern, ' ')
      break
    }
  }

  return { remainder, kind }
}

function cleanTitle(text: string): string {
  return text
    .replace(/\b(?:at|on|@)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim()
}

export function parseQuickEventText(
  text: string,
  options: {
    weekStartKey: string
    fallbackDateKey: string
    todayKey: string
  }
): ParsedQuickEvent {
  void options.weekStartKey

  const normalized = text.trim()
  if (!normalized) {
    return {
      title: '',
      dateKey: null,
      hour: null,
      minute: 0,
      durationMinutes: 60,
      kind: null
    }
  }

  let working = normalized
  const duration = extractDuration(working)
  working = duration.remainder

  const time = extractTime(working)
  working = time.remainder

  const date = extractDateKey(working, options.todayKey)
  working = date.remainder

  const kind = extractKind(working)
  working = kind.remainder

  const title = cleanTitle(working) || cleanTitle(normalized)

  return {
    title,
    dateKey: date.dateKey,
    hour: time.hour,
    minute: time.minute,
    durationMinutes: duration.durationMinutes,
    kind: kind.kind
  }
}

export function buildEventIsoRange(
  dateKey: string,
  hour: number,
  minute: number,
  durationMinutes: number
): { startAt: string; endAt: string } {
  const start = parseDateKey(dateKey)
  start.setHours(hour, minute, 0, 0)
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + durationMinutes)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

export function parseTimeInputValue(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function resolveQuickEventInput(input: {
  text: string
  dateKey: string
  startTime: string
  durationMinutes: number
  kind: CalendarEventKind
  weekStartKey: string
  todayKey: string
}): {
  title: string
  dateKey: string
  startAt: string
  endAt: string
  kind: CalendarEventKind
} | null {
  const parsed = parseQuickEventText(input.text, {
    weekStartKey: input.weekStartKey,
    fallbackDateKey: input.dateKey,
    todayKey: input.todayKey
  })

  const title = parsed.title || input.text.trim()
  if (!title) return null

  const dateKey = parsed.dateKey ?? input.dateKey
  const manualTime = parseTimeInputValue(input.startTime)
  const hour = parsed.hour ?? manualTime?.hour ?? 9
  const minute = parsed.hour !== null ? parsed.minute : (manualTime?.minute ?? 0)
  const durationMinutes = parsed.durationMinutes || input.durationMinutes
  const kind = parsed.kind ?? input.kind

  const { startAt, endAt } = buildEventIsoRange(dateKey, hour, minute, durationMinutes)
  return { title, dateKey, startAt, endAt, kind }
}

export const CALENDAR_PARSE_FIXTURES: Array<{
  input: string
  weekStartKey: string
  todayKey: string
  expect: {
    title: string
    dateKey: string
    hour: number
    minute: number
  }
}> = [
  {
    input: 'lunch at 5pm on friday',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-19',
    expect: { title: 'lunch', dateKey: '2026-06-19', hour: 17, minute: 0 }
  },
  {
    input: 'Chem exam at 2:30pm Tuesday',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-19',
    expect: { title: 'Chem', dateKey: '2026-06-23', hour: 14, minute: 30 }
  },
  {
    input: 'team sync tomorrow at 9am',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-19',
    expect: { title: 'team sync', dateKey: '2026-06-20', hour: 9, minute: 0 }
  },
  {
    input: 'going to beach next saturday at 6pm with lizzie',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-19',
    expect: { title: 'going to beach with lizzie', dateKey: '2026-06-20', hour: 18, minute: 0 }
  },
  {
    input: 'dentist in 3 days at 2pm',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-19',
    expect: { title: 'dentist', dateKey: '2026-06-22', hour: 14, minute: 0 }
  },
  {
    input: 'party July 4 at 8pm',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-19',
    expect: { title: 'party', dateKey: '2026-07-04', hour: 20, minute: 0 }
  },
  {
    input: 'dentist in two weeks on tuesday at 5pm',
    weekStartKey: '2026-06-15',
    todayKey: '2026-06-20',
    expect: { title: 'dentist', dateKey: '2026-06-30', hour: 17, minute: 0 }
  }
]

export function runCalendarParseFixtures(): { ok: boolean; failures: string[] } {
  const failures: string[] = []

  for (const row of CALENDAR_PARSE_FIXTURES) {
    const parsed = parseQuickEventText(row.input, {
      weekStartKey: row.weekStartKey,
      fallbackDateKey: row.todayKey,
      todayKey: row.todayKey
    })

    if (parsed.title.toLowerCase() !== row.expect.title.toLowerCase()) {
      failures.push(`${row.input}: title "${parsed.title}" expected "${row.expect.title}"`)
    }
    if (parsed.dateKey !== row.expect.dateKey) {
      failures.push(`${row.input}: date "${parsed.dateKey}" expected "${row.expect.dateKey}"`)
    }
    if (parsed.hour !== row.expect.hour || parsed.minute !== row.expect.minute) {
      failures.push(
        `${row.input}: time ${parsed.hour}:${parsed.minute} expected ${row.expect.hour}:${row.expect.minute}`
      )
    }
  }

  return { ok: failures.length === 0, failures }
}
