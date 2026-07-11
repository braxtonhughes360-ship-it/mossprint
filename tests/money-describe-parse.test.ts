import { describe, expect, it } from 'vitest'
import { extractMoneyDate, parseMoneyDescribeLine } from '../src/shared/moneyDescribeParse'
import { availableEntryKinds } from '../src/shared/money'

// Friday — same fixed anchor as the capture suites, so weekday math is deterministic.
const TODAY = '2026-06-19'

describe('extractMoneyDate (module-context relative dates, register bias = backwards)', () => {
  it('returns null when no date phrase is present (caller falls back to LLM date, then today)', () => {
    expect(extractMoneyDate('coffee 4.50', TODAY)).toEqual({
      remainder: 'coffee 4.50',
      dateKey: null
    })
  })

  it('resolves "yesterday"', () => {
    expect(extractMoneyDate('coffee 4.50 yesterday', TODAY)).toEqual({
      remainder: 'coffee 4.50',
      dateKey: '2026-06-18'
    })
  })

  it('resolves "today" explicitly', () => {
    expect(extractMoneyDate('lunch 12 today', TODAY).dateKey).toBe(TODAY)
  })

  it('resolves "last friday" to a full week back when today is friday', () => {
    expect(extractMoneyDate('gas 40 last friday', TODAY)).toEqual({
      remainder: 'gas 40',
      dateKey: '2026-06-12'
    })
  })

  it('resolves "last monday" within the current week', () => {
    expect(extractMoneyDate('parking 8 last monday', TODAY).dateKey).toBe('2026-06-15')
  })

  it('resolves a bare weekday to the most recent past occurrence', () => {
    expect(extractMoneyDate('dinner 32 on tuesday', TODAY)).toEqual({
      remainder: 'dinner 32',
      dateKey: '2026-06-16'
    })
    // Same weekday as today = today, not a week back.
    expect(extractMoneyDate('lunch 12 friday', TODAY).dateKey).toBe(TODAY)
  })

  it('strips the date phrase from the middle of a line', () => {
    expect(extractMoneyDate('got paid yesterday 2400', TODAY)).toEqual({
      remainder: 'got paid 2400',
      dateKey: '2026-06-18'
    })
  })
})

describe('parseMoneyDescribeLine (offline trailing-amount fallback)', () => {
  it('parses trailing amounts with thousands separators ("got paid 1,400")', () => {
    expect(parseMoneyDescribeLine('got paid 1,400')).toEqual({
      amountCents: 140000,
      merchant: 'got paid',
      direction: 'income'
    })
    expect(parseMoneyDescribeLine('rent 1,200.50')).toEqual({
      amountCents: 120050,
      merchant: 'rent',
      direction: 'expense'
    })
  })

  it('parses "<payee> <amount>" shapes', () => {
    expect(parseMoneyDescribeLine('coffee 4.50')).toEqual({
      amountCents: 450,
      merchant: 'coffee',
      direction: 'expense'
    })
    expect(parseMoneyDescribeLine('gas 40')).toEqual({
      amountCents: 4000,
      merchant: 'gas',
      direction: 'expense'
    })
    expect(parseMoneyDescribeLine('parking $4.50')).toEqual({
      amountCents: 450,
      merchant: 'parking',
      direction: 'expense'
    })
  })

  it('marks deterministic income hints as income', () => {
    expect(parseMoneyDescribeLine('got paid 2400')).toEqual({
      amountCents: 240_000,
      merchant: 'got paid',
      direction: 'income'
    })
    expect(parseMoneyDescribeLine('sold my desk 75')?.direction).toBe('income')
    expect(parseMoneyDescribeLine('venmo refund 30')?.direction).toBe('income')
  })

  it('returns null for lines without a trailing amount', () => {
    expect(parseMoneyDescribeLine('remember to renew my passport')).toBeNull()
    expect(parseMoneyDescribeLine('$12 chipotle')).toBeNull()
    expect(parseMoneyDescribeLine('coffee 0')).toBeNull()
    expect(parseMoneyDescribeLine('4.50')).toBeNull()
  })
})

describe('availableEntryKinds (Manual entry keeps every ledger operation reachable)', () => {
  it('keeps Transfer and Adjust reachable with two accounts', () => {
    const values = availableEntryKinds(2).map((kind) => kind.value)
    expect(values).toEqual(['expense', 'income', 'transfer', 'adjustment'])
  })

  it('drops only Transfer when fewer than two accounts exist', () => {
    const values = availableEntryKinds(1).map((kind) => kind.value)
    expect(values).toEqual(['expense', 'income', 'adjustment'])
    expect(availableEntryKinds(0).some((kind) => kind.value === 'adjustment')).toBe(true)
  })
})
