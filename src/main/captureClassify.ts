/**
 * Quick-capture shape classifier (V2 I3) — pure, no Electron/DB imports so it
 * runs under vitest like the other parsers. Routing rules:
 * 1. Leading $/decimal amount (+ merchant) -> money expense.
 * 2. Food words with no explicit date -> nutrition describe.
 * 3. Date/time phrase -> calendar event.
 */
import { DESCRIBE_UNIT_GRAMS } from '@shared/nutrition'
import { startOfWeekKey } from '@shared/calendar'
import { parseQuickEventText } from '@shared/calendarEventParse'
import { BRAND_HINTS, PACKAGED_FOOD_HINTS } from './nutritionDescribeLexicon'

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

/** "$12 chipotle" / "12.50 coffee shop" — dollar sign or decimal marks money intent. */
const MONEY_LEAD_PATTERN = /^(\$\s*\d+(?:\.\d{1,2})?|\d+\.\d{1,2})\s*(.*)$/
/** "15 uber" — bare integer lead only counts as money when the rest isn't food. */
const BARE_NUMBER_LEAD_PATTERN = /^(\d+)\s+(\S.*)$/

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
    const cents = Number.parseInt(bare[1], 10) * 100
    if (Number.isFinite(cents) && cents > 0) {
      return { amountCents: cents, merchant: bare[2].trim() }
    }
  }

  return null
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
