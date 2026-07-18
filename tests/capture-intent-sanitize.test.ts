import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listCategories = vi.fn(() => [] as Array<{ id: string; name: string }>)
const getSetting = vi.fn((_key: string): { value: string } | null => null)
const probeOllama = vi.fn()
const structuredChat = vi.fn()

vi.mock('../src/main/database', () => ({
  getSetting: (key: string) => getSetting(key)
}))

vi.mock('../src/main/money', () => ({
  listCategories: (...args: unknown[]) => listCategories(...args)
}))

vi.mock('../src/main/localLlm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/localLlm')>()
  return {
    ...actual,
    probeOllama: (...args: unknown[]) => probeOllama(...args),
    structuredChat: (...args: unknown[]) => structuredChat(...args)
  }
})

import {
  CAPTURE_INTENT_SCHEMA,
  describeCaptureIntent,
  resolveCategoryIdFromGuess,
  sanitizeCaptureIntent
} from '../src/main/captureIntentLlm'

describe('CAPTURE_INTENT_SCHEMA', () => {
  it('requires every field so small models cannot omit payload keys', () => {
    expect([...CAPTURE_INTENT_SCHEMA.required].sort()).toEqual(
      Object.keys(CAPTURE_INTENT_SCHEMA.properties).sort()
    )
  })
})

function validIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: 'money',
    money_amount: 12.5,
    money_direction: null,
    money_date: null,
    money_merchant: 'chipotle',
    money_category_guess: null,
    event_title: null,
    event_date: null,
    event_time: null,
    event_duration_min: null,
    note_text: null,
    note_is_task: null,
    confidence: 'high',
    ...overrides
  }
}

describe('sanitizeCaptureIntent (untrusted model output)', () => {
  it('returns null for non-object payloads and intent none', () => {
    expect(sanitizeCaptureIntent(null)).toBeNull()
    expect(sanitizeCaptureIntent('coffee')).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ intent: 'none' }))).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ intent: 'bogus' }))).toBeNull()
  })

  it('clamps money amounts and truncates merchant text', () => {
    const result = sanitizeCaptureIntent(
      validIntent({
        money_amount: 999_999,
        money_merchant: `  ${'x'.repeat(200)}  `
      })
    )
    expect(result?.moneyAmountCents).toBe(99_999_900)
    expect(result?.moneyMerchant).toBe('x'.repeat(120))
  })

  it('accepts money_direction income only when exactly "income"', () => {
    expect(
      sanitizeCaptureIntent(validIntent({ money_direction: 'income' }))?.moneyDirection
    ).toBe('income')
    // Missing, null, wrong case, or garbage all become expense — the common case.
    expect(sanitizeCaptureIntent(validIntent())?.moneyDirection).toBe('expense')
    expect(
      sanitizeCaptureIntent(validIntent({ money_direction: 'INCOME' }))?.moneyDirection
    ).toBe('expense')
    expect(
      sanitizeCaptureIntent(validIntent({ money_direction: 'deposit all the money' }))
        ?.moneyDirection
    ).toBe('expense')
    expect(sanitizeCaptureIntent(validIntent({ money_direction: 7 }))?.moneyDirection).toBe(
      'expense'
    )
  })

  it('validates money_date like every other date field', () => {
    expect(
      sanitizeCaptureIntent(validIntent({ money_date: '2026-06-18' }))?.moneyDateKey
    ).toBe('2026-06-18')
    expect(sanitizeCaptureIntent(validIntent())?.moneyDateKey).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ money_date: '2026-13-40' }))?.moneyDateKey).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ money_date: 'yesterday' }))?.moneyDateKey).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ money_date: 20260618 }))?.moneyDateKey).toBeNull()
  })

  it('drops non-positive or non-numeric money amounts', () => {
    expect(sanitizeCaptureIntent(validIntent({ money_amount: 0 }))?.moneyAmountCents).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ money_amount: -5 }))?.moneyAmountCents).toBeNull()
    expect(sanitizeCaptureIntent(validIntent({ money_amount: '12' }))?.moneyAmountCents).toBeNull()
  })

  it('validates calendar date/time and clamps duration', () => {
    const result = sanitizeCaptureIntent(
      validIntent({
        intent: 'calendar',
        event_title: 'dentist',
        event_date: '2026-13-40',
        event_time: '25:99',
        event_duration_min: 9000
      })
    )
    expect(result?.eventTitle).toBe('dentist')
    expect(result?.eventDateKey).toBeNull()
    expect(result?.eventHour).toBeNull()
    expect(result?.eventDurationMin).toBe(480)
  })

  it('accepts valid calendar fields', () => {
    const result = sanitizeCaptureIntent(
      validIntent({
        intent: 'calendar',
        event_title: 'lunch with sam',
        event_date: '2026-07-10',
        event_time: '12:30',
        event_duration_min: 45
      })
    )
    expect(result?.eventDateKey).toBe('2026-07-10')
    expect(result?.eventHour).toBe(12)
    expect(result?.eventMinute).toBe(30)
    expect(result?.eventDurationMin).toBe(45)
  })

  it('sanitizes note fields', () => {
    const result = sanitizeCaptureIntent(
      validIntent({
        intent: 'note',
        note_text: 'renew passport',
        note_is_task: true
      })
    )
    expect(result?.noteText).toBe('renew passport')
    expect(result?.noteIsTask).toBe(true)
  })

  it('defaults malformed confidence to medium', () => {
    const result = sanitizeCaptureIntent(validIntent({ confidence: 'certain' }))
    expect(result?.confidence).toBe('medium')
  })
})

describe('describeCaptureIntent gating (mocked transport — never a real network call)', () => {
  const savedHeadless = process.env.MOSS_HEADLESS_USER_DATA

  beforeEach(() => {
    getSetting.mockReset()
    getSetting.mockReturnValue(null)
    probeOllama.mockReset()
    structuredChat.mockReset()
    listCategories.mockReturnValue([])
    delete process.env.MOSS_HEADLESS_USER_DATA
    probeOllama.mockResolvedValue({ model: 'llama3.2', error: null })
  })

  afterEach(() => {
    if (savedHeadless === undefined) delete process.env.MOSS_HEADLESS_USER_DATA
    else process.env.MOSS_HEADLESS_USER_DATA = savedHeadless
  })

  it('returns a sanitized intent for valid model JSON', async () => {
    structuredChat.mockResolvedValue({ content: JSON.stringify(validIntent()), model: 'llama3.2' })
    const result = await describeCaptureIntent('coffee 12.50')
    expect(result?.intent).toBe('money')
    expect(result?.moneyAmountCents).toBe(1250)
  })

  it('returns null on garbage (non-JSON) model output', async () => {
    structuredChat.mockResolvedValue({ content: 'not json {', model: 'llama3.2' })
    await expect(describeCaptureIntent('coffee 12.50')).resolves.toBeNull()
  })

  it('never touches the model under MOSS_HEADLESS_USER_DATA', async () => {
    process.env.MOSS_HEADLESS_USER_DATA = '/tmp/headless'
    await expect(describeCaptureIntent('coffee 12.50')).resolves.toBeNull()
    expect(probeOllama).not.toHaveBeenCalled()
    expect(structuredChat).not.toHaveBeenCalled()
  })

  it('respects localai.capture.enabled = 0', async () => {
    getSetting.mockImplementation((key: string) =>
      key === 'localai.capture.enabled' ? { value: '0' } : null
    )
    await expect(describeCaptureIntent('coffee 12.50')).resolves.toBeNull()
    expect(structuredChat).not.toHaveBeenCalled()
  })

  it('respects localai.money.enabled = 0 on the money surface', async () => {
    getSetting.mockImplementation((key: string) =>
      key === 'localai.money.enabled' ? { value: '0' } : null
    )
    await expect(describeCaptureIntent('coffee 12.50', 'money')).resolves.toBeNull()
    expect(structuredChat).not.toHaveBeenCalled()
  })

  it('returns null when the probe finds no model', async () => {
    probeOllama.mockResolvedValue({ model: null, error: null })
    await expect(describeCaptureIntent('coffee 12.50')).resolves.toBeNull()
    expect(structuredChat).not.toHaveBeenCalled()
  })
})

describe('resolveCategoryIdFromGuess', () => {
  it('returns null when no envelope name matches', () => {
    listCategories.mockReturnValue([{ id: 'cat-rent', name: 'Rent' }])
    expect(resolveCategoryIdFromGuess('Eating out')).toBeNull()
    expect(resolveCategoryIdFromGuess('')).toBeNull()
  })

  it('resolves an exact envelope name case-insensitively', () => {
    listCategories.mockReturnValue([
      { id: 'cat-rent', name: 'Rent' },
      { id: 'cat-dining', name: 'Eating out' }
    ])
    expect(resolveCategoryIdFromGuess('rent')).toBe('cat-rent')
    expect(resolveCategoryIdFromGuess('Eating out')).toBe('cat-dining')
  })

  it('carries the envelope display name through sanitize for the preview', () => {
    listCategories.mockReturnValue([{ id: 'cat-rent', name: 'Rent' }])
    const result = sanitizeCaptureIntent(validIntent({ money_category_guess: 'rent' }))
    expect(result?.moneyCategoryId).toBe('cat-rent')
    expect(result?.moneyCategoryName).toBe('Rent')
  })

  it('never invents a category id for partial guesses', () => {
    listCategories.mockReturnValue([{ id: 'cat-rent', name: 'Rent' }])
    expect(resolveCategoryIdFromGuess('rent payment')).toBeNull()
  })
})
