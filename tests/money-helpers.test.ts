import { describe, expect, it } from 'vitest'
import {
  advanceScheduleDate,
  computeLedgerNetCents,
  computeMonthFlowCents,
  currentPeriodKey,
  dayKeyToIso,
  formatMoneyUserError,
  isoToDayKey,
  parseMoneyInput,
  parseTags,
  serializeTags,
  shiftPeriodKey
} from '@shared/money'

describe('parseMoneyInput', () => {
  it('parses plain dollar strings to cents', () => {
    expect(parseMoneyInput('12.34')).toBe(1234)
    expect(parseMoneyInput('$1,200.50')).toBe(120050)
    expect(parseMoneyInput('-45')).toBe(-4500)
  })

  it('rejects empty and non-numeric input', () => {
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
  })

  it('rounds fractional cents', () => {
    expect(parseMoneyInput('0.005')).toBe(1)
    expect(parseMoneyInput('10.999')).toBe(1100)
  })
})

describe('period keys', () => {
  it('formats YYYY-MM', () => {
    expect(currentPeriodKey(new Date(2026, 6, 15))).toBe('2026-07')
  })

  it('shifts across year boundaries', () => {
    expect(shiftPeriodKey('2026-01', -1)).toBe('2025-12')
    expect(shiftPeriodKey('2026-12', 1)).toBe('2027-01')
    expect(shiftPeriodKey('2026-07', -7)).toBe('2025-12')
  })
})

describe('day keys', () => {
  it('round-trips a local date through noon-anchored ISO', () => {
    expect(isoToDayKey(dayKeyToIso('2026-07-01'))).toBe('2026-07-01')
    expect(isoToDayKey(dayKeyToIso('2026-12-31'))).toBe('2026-12-31')
    expect(isoToDayKey(dayKeyToIso('2026-01-01'))).toBe('2026-01-01')
  })

  it('keeps month-boundary dates inside their month', () => {
    // The budget engine depends on this invariant: a row dated the 1st or the
    // 31st must land in that month regardless of the machine timezone.
    expect(isoToDayKey(dayKeyToIso('2026-02-28'))).toBe('2026-02-28')
    expect(isoToDayKey(dayKeyToIso('2026-08-31'))).toBe('2026-08-31')
  })
})

describe('advanceScheduleDate', () => {
  it('advances weekly and biweekly', () => {
    expect(advanceScheduleDate('2026-07-01', 'weekly')).toBe('2026-07-08')
    expect(advanceScheduleDate('2026-07-01', 'biweekly')).toBe('2026-07-15')
  })

  it('clamps monthly day-of-month overflow', () => {
    expect(advanceScheduleDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(advanceScheduleDate('2024-01-31', 'monthly')).toBe('2024-02-29')
    expect(advanceScheduleDate('2026-12-15', 'monthly')).toBe('2027-01-15')
  })
})

describe('net flow', () => {
  it('excludes transfers from ledger net', () => {
    const net = computeLedgerNetCents([
      { amountCents: -5000, type: 'expense' },
      { amountCents: 120000, type: 'income' },
      { amountCents: -10000, type: 'transfer' },
      { amountCents: 10000, type: 'transfer' }
    ])
    expect(net).toBe(115000)
  })

  it('guards non-finite inputs in month flow', () => {
    expect(computeMonthFlowCents(Number.NaN, 500)).toBe(500)
    expect(computeMonthFlowCents(1000, Number.POSITIVE_INFINITY)).toBe(1000)
  })
})

describe('tags', () => {
  it('round-trips and normalizes tags', () => {
    const serialized = serializeTags(['Coffee', ' work ', 'Coffee'])
    expect(parseTags(serialized)).toEqual(['coffee', 'work'])
    expect(parseTags('')).toEqual([])
    expect(serializeTags([])).toBe('')
  })
})

describe('formatMoneyUserError', () => {
  it('strips the Electron IPC wrapper', () => {
    const wrapped = new Error(
      "Error invoking remote method 'money:create-transaction': Error: Amount cannot be zero"
    )
    expect(formatMoneyUserError(wrapped)).toBe('Amount cannot be zero')
  })

  it('falls back to a friendly default', () => {
    expect(formatMoneyUserError(new Error(''))).toBe('Something went wrong — try again.')
  })
})
