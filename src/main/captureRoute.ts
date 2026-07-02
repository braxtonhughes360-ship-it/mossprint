import type { CaptureSubmitResult } from '@shared/capture'
import { dateKey, dayKeyToIso } from '@shared/money'
import { inferMealSlotFromTime, currentDateKey, MEAL_SLOT_LABELS } from '@shared/nutrition'
import { startOfWeekKey, formatEventScheduleLabel } from '@shared/calendar'
import { resolveQuickEventInput } from '@shared/calendarEventParse'
import { CAPTURE_HELP_MESSAGE, classifyCapture } from './captureClassify'
import { createTransaction } from './money'
import { createCalendarEvent } from './calendar'
import { describeMeal } from './nutritionDescribe'

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
      return { status: 'unrouted', message: CAPTURE_HELP_MESSAGE }
  }
}
