/**
 * Quick-capture shape classifier (V2 I3) — pure, no Electron/DB imports so it
 * runs under vitest like the other parsers. Routing rules:
 * 1. Leading $/decimal amount (+ merchant) -> money expense.
 * 2. Food words with no explicit date -> nutrition describe.
 * 3. Date/time phrase -> calendar event.
 */
import { DESCRIBE_UNIT_GRAMS } from './nutrition'
import { startOfWeekKey } from './calendar'
import { parseQuickEventText } from './calendarEventParse'
import { BRAND_HINTS, PACKAGED_FOOD_HINTS } from './nutritionDescribeLexicon'
import { hasMoneyIncomeHint } from './moneyDescribeParse'

export const CAPTURE_HELP_MESSAGE =
  'Couldn\u2019t tell what this is \u2014 try \u201c$12 chipotle\u201d, \u201c2 eggs and toast\u201d, or \u201cdentist tuesday 2pm\u201d.'

export type CaptureClassification =
  | { kind: 'money'; amountCents: number; merchant: string }
  | { kind: 'nutrition' }
  | { kind: 'calendar' }
  | { kind: 'none' }

/** Common whole foods the Describe lexicon doesn't list (it focuses on brands/packaged). */
const COMMON_FOOD_WORDS = [
  'egg',
  'eggs',
  'toast',
  'bread',
  'rice',
  'pasta',
  'chicken',
  'beef',
  'steak',
  'pork',
  'bacon',
  'fish',
  'salmon',
  'tuna',
  'shrimp',
  'salad',
  'soup',
  'oatmeal',
  'oats',
  'banana',
  'apple',
  'orange',
  'berries',
  'strawberry',
  'strawberries',
  'blueberries',
  'grapes',
  'avocado',
  'cheese',
  'milk',
  'butter',
  'peanut butter',
  'coffee',
  'tea',
  'juice',
  'smoothie',
  'protein',
  'tofu',
  'beans',
  'lentils',
  'quinoa',
  'potato',
  'potatoes',
  'broccoli',
  'spinach',
  'carrots',
  'hummus',
  'crackers',
  'almonds',
  'nuts',
  'ice cream',
  'chocolate',
  'pancake',
  'pancakes',
  'waffle',
  'waffles',
  'omelet',
  'omelette',
  'sushi',
  'curry',
  'stir fry',
  'meatball',
  'meatballs',
  'hot dog',
  'quesadilla',
  'nachos',
  'popcorn',
  'pretzel',
  'muffin',
  'bagel',
  'croissant',
  'donut',
  'brownie',
  'cake',
  'pie'
]

/** Verbs that mark a line as a food log even without a known food noun. */
const FOOD_VERB_PATTERN = /\b(?:ate|had|drank|eating|snacked)\b/i

/** Unit words like "slices"/"bowl" only count next to a number ("2 slices ..."). */
const FOOD_UNIT_WORDS = Object.keys(DESCRIBE_UNIT_GRAMS).filter((unit) => unit.length > 1)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function looksLikeFood(text: string): boolean {
  for (const list of [COMMON_FOOD_WORDS, BRAND_HINTS, PACKAGED_FOOD_HINTS]) {
    for (const word of list) {
      if (new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text)) {
        return true
      }
    }
  }

  if (FOOD_VERB_PATTERN.test(text)) {
    return true
  }

  for (const unit of FOOD_UNIT_WORDS) {
    if (new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*${escapeRegExp(unit)}\\b`, 'i').test(text)) {
      return true
    }
  }

  return false
}

/**
 * "$12 chipotle" / "12.50 coffee shop" — dollar sign or decimal marks money intent.
 * Thousands separators must be consumed by the amount, or "$1,200 rent" silently
 * logs as $1.00 with merchant ",200 rent" (beta.4 audit). The comma alternative
 * comes FIRST in each group so it wins over a bare \d+ prefix match.
 */
const MONEY_LEAD_PATTERN =
  /^(\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2})\s*(.*)$/
/** "15 uber" / "1,400 rent" — bare number lead only counts as money when the rest isn't food. */
const BARE_NUMBER_LEAD_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)\s+(\S.*)$/

function parseMoneyLead(text: string): { amountCents: number; merchant: string } | null {
  const explicit = MONEY_LEAD_PATTERN.exec(text)
  if (explicit) {
    const cents = Math.round(Number.parseFloat(explicit[1].replace(/[^0-9.]/g, '')) * 100)
    if (Number.isFinite(cents) && cents > 0) {
      return { amountCents: cents, merchant: explicit[2].trim() }
    }
    return null
  }

  const bare = BARE_NUMBER_LEAD_PATTERN.exec(text)
  if (bare && !looksLikeFood(bare[2])) {
    const cents = Number.parseInt(bare[1].replace(/,/g, ''), 10) * 100
    if (Number.isFinite(cents) && cents > 0) {
      return { amountCents: cents, merchant: bare[2].trim() }
    }
  }

  return null
}

/** Number tokens that are times, not dollars — "at 5", "5pm", "5:30". */
const AMOUNT_TOKEN_PATTERN = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g
const TIME_TAIL_PATTERN = /^\s*(?:am|pm|:\d|o'?clock)/i

/** "by my job TSMC" / "from venmo" — the payer, minus filler and date words. */
const INCOME_SOURCE_PATTERN =
  /\b(?:by|from)\s+(?:my\s+(?:job|work|company|boss)\s*(?:at|,)?\s*)?(.+)$/i
const DATE_WORD_PATTERN =
  /\b(?:today|yesterday|tomorrow|last\s+\w+|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/gi

/**
 * "I got paid 1400 today by my job TSMC" — an income hint plus an amount
 * anywhere in the line is money, and must outrank calendar cues: employer
 * names and "today" read like an event to the date parser, which misfiled
 * paychecks as calendar entries (QA2-14). Routing always confirms income,
 * so a wrong guess here is one glance from correction — never a silent write.
 */
export function parseIncomeMention(text: string): { amountCents: number; merchant: string } | null {
  if (!hasMoneyIncomeHint(text)) return null

  let amountCents: number | null = null
  const tokenPattern = new RegExp(AMOUNT_TOKEN_PATTERN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text)) !== null) {
    const tail = text.slice(match.index + match[0].length)
    const preceding = text.slice(0, match.index)
    if (TIME_TAIL_PATTERN.test(tail) || /\bat\s*$/i.test(preceding)) continue
    const value = Number.parseFloat(`${match[1].replace(/,/g, '')}${match[2] ?? ''}`)
    if (Number.isFinite(value) && value > 0) {
      amountCents = Math.round(value * 100)
      break
    }
  }
  if (amountCents === null) return null

  const source = INCOME_SOURCE_PATTERN.exec(text)?.[1] ?? ''
  const merchant = source
    .replace(DATE_WORD_PATTERN, ' ')
    .replace(/[.,;!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

  return { amountCents, merchant }
}

export function classifyCapture(rawText: string, todayKey: string): CaptureClassification {
  const text = rawText.trim()
  if (!text) {
    return { kind: 'none' }
  }

  const money = parseMoneyLead(text)
  if (money) {
    return { kind: 'money', ...money }
  }

  // Income wording with an amount outranks food and calendar cues (QA2-14).
  const income = parseIncomeMention(text)
  if (income) {
    return { kind: 'money', ...income }
  }
  // Income wording with NO amount is still not a calendar event — hand it to
  // the LLM (which confirms) instead of instant-writing "got paid friday" as
  // an event. Without a model it degrades to the help message, honestly.
  if (hasMoneyIncomeHint(text)) {
    return { kind: 'none' }
  }

  const parsedEvent = parseQuickEventText(text, {
    weekStartKey: startOfWeekKey(todayKey),
    fallbackDateKey: todayKey,
    todayKey
  })
  const hasExplicitDate = parsedEvent.dateKey !== null
  const hasTime = parsedEvent.hour !== null
  const foody = looksLikeFood(text)

  // "2 eggs at 9am" logs food; "lunch with sam tomorrow 1pm" schedules — an
  // explicit date signals planning, a bare time on food words signals a log.
  if (foody && !hasExplicitDate) {
    return { kind: 'nutrition' }
  }

  if (hasExplicitDate || hasTime) {
    return { kind: 'calendar' }
  }

  if (foody) {
    return { kind: 'nutrition' }
  }

  return { kind: 'none' }
}
