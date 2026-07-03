/**
 * Module-context parsing for the money Describe field (LocalAI plan §LA2 C).
 *
 * The shared intent schema is deliberately flat and carries no money date
 * field (LA2 adds only money_direction), so relative dates resolve
 * deterministically here — in a register, "yesterday" / "last friday" point
 * backwards, the opposite bias of the calendar parser. The trailing-amount
 * parse is the module's offline fallback: in the money field, "coffee 4.50"
 * is a purchase even though capture's food lexicon would call it a meal.
 */
import { parseMoneyInput } from './money'

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

const WEEKDAY_PATTERN =
  'monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun'

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

/** Most recent past occurrence of a weekday. `strict` skips today ("last friday" on a Friday = 7 days back). */
function resolvePastWeekday(todayKey: string, weekday: string, strict: boolean): string | null {
  const targetOffset = WEEKDAY_OFFSET[weekday.toLowerCase()]
  if (targetOffset === undefined) return null
  const todayOffset = weekdayOffsetFromDate(parseDateKey(todayKey))
  let delta = (todayOffset - targetOffset + 7) % 7
  if (strict && delta === 0) delta = 7
  return shiftDateKey(todayKey, -delta)
}

export interface ExtractedMoneyDate {
  remainder: string
  /** Null when the line names no day — the caller decides the fallback (LLM date, then today). */
  dateKey: string | null
}

/** Pull a backwards-looking date phrase out of a money line. */
export function extractMoneyDate(text: string, todayKey: string): ExtractedMoneyDate {
  let remainder = text
  let dateKey: string | null = null

  if (/\btoday\b/i.test(remainder)) {
    dateKey = todayKey
    remainder = remainder.replace(/\btoday\b/i, ' ')
  } else if (/\byesterday\b/i.test(remainder)) {
    dateKey = shiftDateKey(todayKey, -1)
    remainder = remainder.replace(/\byesterday\b/i, ' ')
  }

  const lastWeekdayMatch = remainder.match(new RegExp(`\\blast\\s+(${WEEKDAY_PATTERN})\\b`, 'i'))
  if (!dateKey && lastWeekdayMatch) {
    dateKey = resolvePastWeekday(todayKey, lastWeekdayMatch[1], true)
    remainder = remainder.replace(lastWeekdayMatch[0], ' ')
  }

  const weekdayMatch = remainder.match(new RegExp(`\\b(?:on\\s+)?(${WEEKDAY_PATTERN})\\b`, 'i'))
  if (!dateKey && weekdayMatch) {
    dateKey = resolvePastWeekday(todayKey, weekdayMatch[1], false)
    remainder = remainder.replace(weekdayMatch[0], ' ')
  }

  return {
    remainder: remainder.replace(/\s+/g, ' ').trim(),
    dateKey
  }
}

/** "got paid", "refund", "sold my desk" — deterministic income hints for the offline fallback. */
const INCOME_HINT_PATTERN =
  /\b(?:got\s+paid|get\s+paid|paid\s+me|paycheck|payday|refund(?:ed)?|reimburse(?:d|ment)?|sold|income|deposit(?:ed)?|cash\s?back)\b/i

/** "<payee> <amount>" with the amount trailing — "coffee 4.50", "got paid 2400". */
const TRAILING_AMOUNT_PATTERN = /^(.*\S)\s+\$?(\d+(?:\.\d{1,2})?)$/

export interface ParsedMoneyDescribeLine {
  amountCents: number
  merchant: string
  direction: 'expense' | 'income'
}

/**
 * Offline/deterministic fallback for the money field: a line ending in an
 * amount is a money entry in this context. Leading-amount shapes
 * ("$12 chipotle") are already money via the shared classifier.
 */
export function parseMoneyDescribeLine(text: string): ParsedMoneyDescribeLine | null {
  const match = TRAILING_AMOUNT_PATTERN.exec(text.trim())
  if (!match) return null

  const amountCents = parseMoneyInput(match[2])
  if (!amountCents || amountCents <= 0) return null

  return {
    amountCents,
    merchant: match[1].trim(),
    direction: INCOME_HINT_PATTERN.test(text) ? 'income' : 'expense'
  }
}
