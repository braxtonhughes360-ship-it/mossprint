import type {
  CaptureCommitInput,
  CaptureLoggedResult,
  CaptureSubmitResult
} from '@shared/capture'
import { dateKey, dayKeyToIso } from '@shared/money'
import { inferMealSlotFromTime, currentDateKey, MEAL_SLOT_LABELS } from '@shared/nutrition'
import { startOfWeekKey, formatEventScheduleLabel } from '@shared/calendar'
import { buildEventIsoRange, resolveQuickEventInput } from '@shared/calendarEventParse'
import { noteDisplayTitle } from '@shared/notes'
import type { LocalAiSurface } from '@shared/localai'
import { CAPTURE_HELP_MESSAGE, classifyCapture } from '@shared/captureClassify'
import {
  describeCaptureIntent,
  MAX_AMOUNT_CENTS,
  type SanitizedCaptureIntent
} from './captureIntentLlm'
import { createTransaction } from './money'
import { createCalendarEvent } from './calendar'
import { describeMeal } from './nutritionDescribe'
import { createNote, createNoteTask, ensureDefaultNoteFolder } from './notes'

/** "today" / "yesterday" / the explicit day — the date is always visible in previews. */
function formatCaptureDayLabel(dateKey: string | null, todayKey: string): string {
  if (!dateKey || dateKey === todayKey) return 'today'
  const [year, month, day] = todayKey.split('-').map(Number)
  const yesterday = new Date(year, month - 1, day - 1)
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  return dateKey === yesterdayKey ? 'yesterday' : dateKey
}

function formatCaptureAmount(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(cents / 100)
}

function logMoneyExpense(amountCents: number, merchant: string): CaptureSubmitResult {
  const record = createTransaction({
    amountCents: -Math.abs(amountCents),
    type: 'expense',
    status: 'cleared',
    categoryId: null,
    payeeName: merchant || undefined,
    memo: merchant || 'Quick capture',
    occurredAt: dayKeyToIso(dateKey())
  })

  const label = record.payeeName ?? merchant
  const envelope = record.categoryId ? '' : ' \u00b7 unfiled'
  return {
    status: 'logged',
    kind: 'money',
    message: `Logged ${formatCaptureAmount(amountCents)}${label ? ` \u2014 ${label}` : ''} \u00b7 today${envelope}`
  }
}

function logCalendarEvent(text: string): CaptureSubmitResult {
  const todayKey = currentDateKey()
  const resolved = resolveQuickEventInput({
    text,
    dateKey: todayKey,
    startTime: '09:00',
    durationMinutes: 60,
    kind: 'general',
    weekStartKey: startOfWeekKey(todayKey),
    todayKey
  })
  if (!resolved) {
    return { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
  }

  const record = createCalendarEvent({
    title: resolved.title,
    startAt: resolved.startAt,
    endAt: resolved.endAt,
    kind: resolved.kind
  })

  return {
    status: 'logged',
    kind: 'calendar',
    message: `Added ${record.title} \u2014 ${formatEventScheduleLabel(record.startAt, todayKey)}`
  }
}

async function draftNutritionPlate(text: string): Promise<CaptureSubmitResult> {
  const mealSlot = inferMealSlotFromTime()
  const dateKeyToday = currentDateKey()
  const result = await describeMeal({ text, dateKey: dateKeyToday, mealSlot })

  const items = result.items.filter((item) => item.snapshotKcal > 0 || item.foodItemId)
  if (items.length === 0) {
    return { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
  }

  const totalKcal = Math.round(items.reduce((sum, item) => sum + item.snapshotKcal, 0))
  const labels = items.map((item) => item.label).join(', ')

  return {
    status: 'confirm',
    kind: 'nutrition',
    message: `${MEAL_SLOT_LABELS[mealSlot]} \u2014 ${labels} \u00b7 ~${totalKcal} kcal`,
    plate: {
      dateKey: dateKeyToday,
      mealSlot,
      items: items.map((item) => ({
        foodItemId: item.foodItemId,
        servingId: item.servingId,
        label: item.label,
        quantity: item.quantity,
        kcal: item.snapshotKcal,
        proteinG: item.snapshotProteinG,
        carbsG: item.snapshotCarbsG,
        fatG: item.snapshotFatG
      }))
    }
  }
}

function draftMoneyConfirm(intent: SanitizedCaptureIntent): CaptureSubmitResult | null {
  const amountCents = intent.moneyAmountCents
  if (amountCents === null || amountCents <= 0) return null

  const direction = intent.moneyDirection === 'income' ? 'income' : 'expense'
  const merchant = intent.moneyMerchant ?? ''
  // Name the guessed envelope in the preview \u2014 a wrong guess the user can't
  // see is worse than no guess (observed: "Car Payment" for "paid rent").
  const envelopeSuffix = intent.moneyCategoryId
    ? intent.moneyCategoryName
      ? ` \u00b7 ${intent.moneyCategoryName}`
      : ''
    : ' \u00b7 unfiled'
  const merchantSuffix = merchant ? ` \u2014 ${merchant}` : ''

  // Direction and day are always visible \u2014 a wrong guess must be one glance
  // away from correction, never a silent misfile (plan \u00a72).
  const dayLabel = formatCaptureDayLabel(intent.moneyDateKey, currentDateKey())
  return {
    status: 'confirm',
    kind: 'money',
    message: `${formatCaptureAmount(amountCents)} ${direction === 'income' ? 'in' : 'out'}${merchantSuffix} \u00b7 ${dayLabel}${envelopeSuffix}`,
    money: {
      amountCents,
      direction,
      dateKey: intent.moneyDateKey,
      merchant,
      categoryId: intent.moneyCategoryId
    }
  }
}

function draftCalendarConfirm(intent: SanitizedCaptureIntent): CaptureSubmitResult | null {
  const title = intent.eventTitle
  if (!title) return null

  const todayKey = currentDateKey()
  const dateKeyValue = intent.eventDateKey ?? todayKey
  const hour = intent.eventHour ?? 9
  const minute = intent.eventMinute ?? 0
  const durationMinutes = intent.eventDurationMin ?? 60
  const { startAt, endAt } = buildEventIsoRange(dateKeyValue, hour, minute, durationMinutes)

  return {
    status: 'confirm',
    kind: 'calendar',
    message: `${title} \u2014 ${formatEventScheduleLabel(startAt, todayKey)}`,
    calendar: {
      title,
      startAt,
      endAt,
      kind: 'general'
    }
  }
}

function draftNoteConfirm(intent: SanitizedCaptureIntent, rawText: string): CaptureSubmitResult | null {
  // The typed line IS the note — fall back to it when the model routes to
  // note but omits/nulls note_text, instead of dropping to the help message.
  const text = intent.noteText ?? rawText.trim().slice(0, 120)
  if (!text) return null

  const label = intent.noteIsTask ? 'Task' : 'Note'
  return {
    status: 'confirm',
    kind: 'note',
    message: `${label} \u2014 ${text}`,
    note: {
      text,
      isTask: intent.noteIsTask
    }
  }
}

/**
 * Route an already-sanitized LLM intent (or null). Split from the transport so
 * verify:capture-routing can drive this path with mocked model payloads.
 */
export async function routeSanitizedCaptureIntent(
  intent: SanitizedCaptureIntent | null,
  text: string
): Promise<CaptureSubmitResult> {
  if (!intent) {
    return { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
  }

  switch (intent.intent) {
    case 'nutrition':
      return draftNutritionPlate(text)
    case 'money': {
      const draft = draftMoneyConfirm(intent)
      return draft ?? { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
    }
    case 'calendar': {
      const draft = draftCalendarConfirm(intent)
      return draft ?? { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
    }
    case 'note': {
      const draft = draftNoteConfirm(intent, text)
      return draft ?? { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
    }
    default:
      return { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
  }
}

async function routeCaptureWithLlm(
  text: string,
  surface: LocalAiSurface = 'capture'
): Promise<CaptureSubmitResult> {
  return routeSanitizedCaptureIntent(await describeCaptureIntent(text, surface), text)
}

/**
 * Parse-only preview for module describe fields (plan §LA2 part B): same brain
 * as routeCaptureText — deterministic classifier first, LLM on miss — but the
 * deterministic money/calendar hits return confirm drafts instead of writing.
 * Module fields must never call capture:submit (it routes AND writes; a
 * deterministic line would instant-write from a form context and could
 * double-log). Nothing in this function touches the database.
 */
export async function previewCaptureText(
  rawText: string,
  surface: LocalAiSurface = 'capture'
): Promise<CaptureSubmitResult> {
  const text = rawText.trim()
  const classified = classifyCapture(text, currentDateKey())

  switch (classified.kind) {
    case 'money':
      return (
        draftMoneyConfirm({
          intent: 'money',
          confidence: 'high',
          moneyAmountCents: classified.amountCents,
          moneyDirection: 'expense',
          moneyDateKey: null,
          moneyMerchant: classified.merchant || null,
          moneyCategoryId: null,
          moneyCategoryName: null,
          eventTitle: null,
          eventDateKey: null,
          eventHour: null,
          eventMinute: null,
          eventDurationMin: null,
          noteText: null,
          noteIsTask: false
        }) ?? { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
      )
    case 'nutrition':
      return draftNutritionPlate(text)
    case 'calendar': {
      const todayKey = currentDateKey()
      const resolved = resolveQuickEventInput({
        text,
        dateKey: todayKey,
        startTime: '09:00',
        durationMinutes: 60,
        kind: 'general',
        weekStartKey: startOfWeekKey(todayKey),
        todayKey
      })
      if (!resolved) {
        return { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
      }
      return {
        status: 'confirm',
        kind: 'calendar',
        message: `${resolved.title} — ${formatEventScheduleLabel(resolved.startAt, todayKey)}`,
        calendar: {
          title: resolved.title,
          startAt: resolved.startAt,
          endAt: resolved.endAt,
          kind: resolved.kind
        }
      }
    }
    default:
      return routeCaptureWithLlm(text, surface)
  }
}

/** Route one capture line by shape (master plan I3) and write it into the open profile. */
export async function routeCaptureText(rawText: string): Promise<CaptureSubmitResult> {
  const text = rawText.trim()
  const classified = classifyCapture(text, currentDateKey())

  switch (classified.kind) {
    case 'money':
      return logMoneyExpense(classified.amountCents, classified.merchant)
    case 'nutrition':
      return draftNutritionPlate(text)
    case 'calendar':
      return logCalendarEvent(text)
    default:
      return routeCaptureWithLlm(text)
  }
}

/** Commit an LLM-routed money/calendar/note draft after explicit user confirm. */
export function commitCaptureDraft(input: CaptureCommitInput): CaptureLoggedResult {
  switch (input.kind) {
    case 'money': {
      const { amountCents, merchant, categoryId } = input.money
      // Drafts are renderer-echoed — re-validate against the same cap the
      // router sanitizer applied, instead of trusting the round trip.
      if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
        throw new Error('Invalid capture amount')
      }
      const direction = input.money.direction === 'income' ? 'income' : 'expense'
      const sign = direction === 'income' ? 1 : -1
      // Re-validate the renderer-echoed day like every other draft field.
      const draftDateKey =
        typeof input.money.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.money.dateKey)
          ? input.money.dateKey
          : null
      const safeMerchant = merchant.trim().slice(0, 120)
      const record = createTransaction({
        amountCents: sign * Math.abs(Math.round(amountCents)),
        type: direction,
        status: 'cleared',
        categoryId: categoryId ?? null,
        payeeName: safeMerchant || undefined,
        memo: safeMerchant || 'Quick capture',
        occurredAt: dayKeyToIso(draftDateKey ?? dateKey())
      })
      const label = record.payeeName ?? safeMerchant
      const envelope = record.categoryId ? '' : ' \u00b7 unfiled'
      const dayLabel = formatCaptureDayLabel(draftDateKey, currentDateKey())
      return {
        status: 'logged',
        kind: 'money',
        message: `Logged ${formatCaptureAmount(amountCents)} ${direction === 'income' ? 'in' : 'out'}${label ? ` \u2014 ${label}` : ''} \u00b7 ${dayLabel}${envelope}`
      }
    }
    case 'calendar': {
      const { title, startAt, endAt, kind } = input.calendar
      const safeTitle = title.trim().slice(0, 120)
      if (!safeTitle) {
        throw new Error('Event title is required')
      }
      const start = new Date(startAt)
      const end = new Date(endAt)
      if (
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        end.getTime() <= start.getTime()
      ) {
        throw new Error('Invalid event time')
      }
      const record = createCalendarEvent({
        title: safeTitle,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        kind
      })
      return {
        status: 'logged',
        kind: 'calendar',
        message: `Added ${record.title} \u2014 ${formatEventScheduleLabel(record.startAt, currentDateKey())}`
      }
    }
    case 'note': {
      const safeText = input.note.text.trim().slice(0, 120)
      if (!safeText) {
        throw new Error('Note text is required')
      }
      ensureDefaultNoteFolder()
      if (input.note.isTask) {
        const note = createNote({
          title: noteDisplayTitle(safeText),
          body: '',
          isChecklistMode: true
        })
        createNoteTask({ noteId: note.id, label: safeText })
        return {
          status: 'logged',
          kind: 'note',
          message: `Added task \u2014 ${safeText}`
        }
      }
      createNote({
        title: noteDisplayTitle(safeText),
        body: ''
      })
      return {
        status: 'logged',
        kind: 'note',
        message: `Added note \u2014 ${safeText}`
      }
    }
  }
}
