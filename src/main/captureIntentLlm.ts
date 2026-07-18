/**
 * Quick-capture intent routing via local Ollama (127.0.0.1:11434 only).
 *
 * Architecture (MOSS_LOCALAI_V2_5_PLAN §2): deterministic classifyCapture runs first;
 * this module is the ambiguous-text fallback. Every field is untrusted — validated
 * and clamped before routing. Envelope guesses must match an existing category ID.
 */
import { currentDateKey } from '@shared/nutrition'
import type { LocalAiSurface } from '@shared/localai'
import { listCategories } from './money'
import { isSurfaceLlmEnabled, loadModel, probeOllama, structuredChat } from './localLlm'

const CHAT_TIMEOUT_MS = 8_000
const MAX_TEXT_LENGTH = 500
const MAX_LABEL_LENGTH = 120
/** Shared with commitCaptureDraft so renderer-echoed drafts re-validate against the same cap. */
export const MAX_AMOUNT_CENTS = 1_000_000_00
const MIN_AMOUNT_CENTS = 1
const MAX_DURATION_MIN = 480
const MIN_DURATION_MIN = 15

export type CaptureIntentKind = 'money' | 'nutrition' | 'calendar' | 'note' | 'none'
export type CaptureIntentConfidence = 'high' | 'medium' | 'low'
export type MoneyDirection = 'expense' | 'income'

export interface SanitizedCaptureIntent {
  intent: Exclude<CaptureIntentKind, 'none'>
  confidence: CaptureIntentConfidence
  moneyAmountCents: number | null
  /** Anything the model sends that isn't exactly "income" sanitizes to "expense". */
  moneyDirection: MoneyDirection
  /** Validated YYYY-MM-DD when the text names a day; null means today. */
  moneyDateKey: string | null
  moneyMerchant: string | null
  moneyCategoryId: string | null
  /** Display name for moneyCategoryId — optional so test fixtures stay lean. */
  moneyCategoryName?: string | null
  eventTitle: string | null
  eventDateKey: string | null
  eventHour: number | null
  eventMinute: number | null
  eventDurationMin: number | null
  noteText: string | null
  noteIsTask: boolean
}

/**
 * Flat schema — no nesting or $defs; small local models need this shape.
 * Every field is required (values stay nullable): with only intent+confidence
 * required, llama3.2-class models omit the payload keys entirely under
 * constrained decoding (observed 2026-07-02: note_text/event_title dropped),
 * which nulls the draft and kills the route.
 */
export const CAPTURE_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['money', 'nutrition', 'calendar', 'note', 'none'] },
    money_amount: { type: ['number', 'null'] },
    money_direction: { type: ['string', 'null'] },
    money_date: { type: ['string', 'null'] },
    money_merchant: { type: ['string', 'null'] },
    money_category_guess: { type: ['string', 'null'] },
    event_title: { type: ['string', 'null'] },
    event_date: { type: ['string', 'null'] },
    event_time: { type: ['string', 'null'] },
    event_duration_min: { type: ['number', 'null'] },
    note_text: { type: ['string', 'null'] },
    note_is_task: { type: ['boolean', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
  },
  required: [
    'intent',
    'money_amount',
    'money_direction',
    'money_date',
    'money_merchant',
    'money_category_guess',
    'event_title',
    'event_date',
    'event_time',
    'event_duration_min',
    'note_text',
    'note_is_task',
    'confidence'
  ]
} as const

const SYSTEM_PROMPT = [
  'You route one line of plain English into a life-dashboard intent.',
  'Pick exactly one intent: money (expense/spend), nutrition (food/meal log),',
  'calendar (event/appointment/meeting), note (reminder/idea/todo text), or none.',
  'Fill only the fields relevant to the chosen intent; set the rest to null.',
  'money_amount is USD dollars (not cents). money_direction is "income" only when',
  'money was received (got paid, refund, sold something, deposit); spending is',
  '"expense". Getting paid is ALWAYS money, never calendar — even when the line',
  'says "today" or names an employer. Example: "I got paid 1400 today by my job',
  'TSMC" is money, income, amount 1400, merchant TSMC — not a calendar event.',
  '"lunch with the TSMC team tuesday 1pm" IS calendar — an employer name alone',
  'does not make something money. money_date is YYYY-MM-DD for when the money',
  'moved ("yesterday",',
  '"last friday") — null when the text names no day. money_category_guess must be null',
  'unless the expense clearly belongs to one of the user envelope names listed',
  'below — never force a loose match.',
  'note_text is the thing to remember, e.g. "renew my passport".',
  'event_date is YYYY-MM-DD, event_time is HH:MM (24h).',
  'Weekday phrases anchor to Monday-started weeks: "this <weekday>" is that weekday',
  'in the current Mon-Sun week; "next <weekday>" is that weekday in the following',
  'Mon-Sun week (this + 7 days); a bare "<weekday>" is the nearest upcoming one.',
  'note_is_task is true for',
  'actionable todos ("remember to…", "call mom"), false for ideas/notes.',
  'Respond ONLY with JSON matching the schema.'
].join(' ')

/** Whether capture LLM routing is allowed (feature flag + headless guard). */
export function isCaptureLlmEnabled(): boolean {
  return isSurfaceLlmEnabled('capture')
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

function sanitizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function sanitizeDateKey(value: unknown): string | null {
  const raw = sanitizeString(value, 10)
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return raw
}

function sanitizeTime(value: unknown): { hour: number; minute: number } | null {
  const raw = sanitizeString(value, 5)
  if (!raw) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** Resolve a model-supplied envelope name to an existing category, or null. */
function resolveCategoryFromGuess(guess: string | null): { id: string; name: string } | null {
  if (!guess) return null
  const normalized = guess.trim().toLowerCase()
  if (!normalized) return null
  const match = listCategories().find((row) => row.name.trim().toLowerCase() === normalized)
  return match ? { id: match.id, name: match.name } : null
}

/** Resolve a model-supplied envelope name to an existing category ID, or null. */
export function resolveCategoryIdFromGuess(guess: string | null): string | null {
  return resolveCategoryFromGuess(guess)?.id ?? null
}

/** YYYY-MM-DD for the this-week/next-week occurrence of a weekday (Mon-anchored). */
function weekdayExampleKeys(target: number): { thisWeek: string; nextWeek: string } {
  const now = new Date()
  const todayOffset = (now.getDay() + 6) % 7 // Mon=0
  const thisWeek = new Date(now)
  thisWeek.setDate(now.getDate() + (target - todayOffset))
  const nextWeek = new Date(thisWeek)
  nextWeek.setDate(thisWeek.getDate() + 7)
  const key = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { thisWeek: key(thisWeek), nextWeek: key(nextWeek) }
}

function buildSystemPrompt(): string {
  // Anchor relative dates ("tomorrow", "next thursday") — the model has no clock;
  // without this it invents dates from its training data (observed: 2024 dates).
  // The worked friday example pins the Mon-Sun week rule: small models get
  // weekday arithmetic wrong without a concrete anchor (observed on qwen3.5-4b).
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const friday = weekdayExampleKeys(4)
  const dateLine =
    ` Today is ${weekday}, ${currentDateKey()}.` +
    ` For example, "this friday" is ${friday.thisWeek} and "next friday" is ${friday.nextWeek}.`
  const envelopeNames = listCategories()
    .map((row) => row.name.trim())
    .filter(Boolean)
    .slice(0, 40)
  if (envelopeNames.length === 0) {
    return `${SYSTEM_PROMPT}${dateLine}`
  }
  // Envelope names are profile-local and never leave 127.0.0.1 — see SECURITY.md.
  return `${SYSTEM_PROMPT}${dateLine} User envelopes: ${envelopeNames.join(', ')}.`
}

export function sanitizeCaptureIntent(raw: unknown): SanitizedCaptureIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>

  const intent = row.intent
  if (
    intent !== 'money' &&
    intent !== 'nutrition' &&
    intent !== 'calendar' &&
    intent !== 'note'
  ) {
    return null
  }

  const confidence: CaptureIntentConfidence =
    row.confidence === 'high' || row.confidence === 'low' ? row.confidence : 'medium'

  const amountRaw =
    typeof row.money_amount === 'number' && Number.isFinite(row.money_amount)
      ? row.money_amount
      : null
  const moneyAmountCents =
    amountRaw !== null && amountRaw > 0
      ? clampNumber(Math.round(amountRaw * 100), MIN_AMOUNT_CENTS, MAX_AMOUNT_CENTS)
      : null

  const categoryGuess = sanitizeString(row.money_category_guess, MAX_LABEL_LENGTH)
  const category = resolveCategoryFromGuess(categoryGuess)

  const time = sanitizeTime(row.event_time)
  const duration = clampNumber(row.event_duration_min, MIN_DURATION_MIN, MAX_DURATION_MIN)

  return {
    intent,
    confidence,
    moneyAmountCents,
    moneyDirection: row.money_direction === 'income' ? 'income' : 'expense',
    moneyDateKey: sanitizeDateKey(row.money_date),
    moneyMerchant: sanitizeString(row.money_merchant, MAX_LABEL_LENGTH),
    moneyCategoryId: category?.id ?? null,
    moneyCategoryName: category?.name ?? null,
    eventTitle: sanitizeString(row.event_title, MAX_LABEL_LENGTH),
    eventDateKey: sanitizeDateKey(row.event_date),
    eventHour: time?.hour ?? null,
    eventMinute: time?.minute ?? null,
    eventDurationMin: duration !== null ? Math.round(duration) : null,
    noteText: sanitizeString(row.note_text, MAX_LABEL_LENGTH),
    noteIsTask: row.note_is_task === true
  }
}

/**
 * Classify ambiguous capture text with the local model. Returns null when
 * disabled, unreachable, timed out, or output is unusable.
 */
export async function describeCaptureIntent(
  text: string,
  surface: LocalAiSurface = 'capture'
): Promise<SanitizedCaptureIntent | null> {
  const trimmed = text.trim()
  if (!trimmed || !isSurfaceLlmEnabled(surface)) return null

  const { model } = await probeOllama()
  if (!model) return null

  const result = await structuredChat({
    schema: CAPTURE_INTENT_SCHEMA,
    system: buildSystemPrompt(),
    user: trimmed.slice(0, MAX_TEXT_LENGTH),
    timeoutMs: CHAT_TIMEOUT_MS,
    temperature: 0
  })
  if (!result) return null

  try {
    return sanitizeCaptureIntent(JSON.parse(result.content))
  } catch {
    return null
  }
}

/** Pre-warm the model when the capture window opens (load-only request, non-blocking). */
export function warmCaptureIntentLlm(): void {
  if (!isCaptureLlmEnabled()) return
  void loadModel('5m')
}
