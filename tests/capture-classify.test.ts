import { describe, expect, it } from 'vitest'
import { classifyCapture, looksLikeFood } from '../src/shared/captureClassify'

// Fixed Friday so weekday phrases resolve deterministically.
const TODAY = '2026-06-19'

describe('quick capture shape classifier', () => {
  it('routes leading $ amounts to money', () => {
    const result = classifyCapture('$12.50 chipotle', TODAY)
    expect(result).toEqual({ kind: 'money', amountCents: 1250, merchant: 'chipotle' })
  })

  it('routes leading decimal amounts to money even for food merchants', () => {
    const result = classifyCapture('8.75 starbucks', TODAY)
    expect(result).toEqual({ kind: 'money', amountCents: 875, merchant: 'starbucks' })
  })

  it('routes bare integer + non-food merchant to money', () => {
    const result = classifyCapture('15 uber', TODAY)
    expect(result).toEqual({ kind: 'money', amountCents: 1500, merchant: 'uber' })
  })

  it('consumes thousands separators in the amount ("$1,200 rent" must never log as $1)', () => {
    expect(classifyCapture('$1,200 rent', TODAY)).toEqual({
      kind: 'money',
      amountCents: 120000,
      merchant: 'rent'
    })
    expect(classifyCapture('$12,345.67 tuition', TODAY)).toEqual({
      kind: 'money',
      amountCents: 1234567,
      merchant: 'tuition'
    })
    expect(classifyCapture('1,400.50 rent', TODAY)).toEqual({
      kind: 'money',
      amountCents: 140050,
      merchant: 'rent'
    })
    expect(classifyCapture('1,400 rent', TODAY)).toEqual({
      kind: 'money',
      amountCents: 140000,
      merchant: 'rent'
    })
    // Plain amounts keep working exactly as before.
    expect(classifyCapture('$1400 rent', TODAY)).toEqual({
      kind: 'money',
      amountCents: 140000,
      merchant: 'rent'
    })
  })

  it('routes bare integer + food words to nutrition, not money', () => {
    expect(classifyCapture('2 eggs and toast', TODAY)).toEqual({ kind: 'nutrition' })
  })

  it('routes food words with a bare time to nutrition (a log, not a plan)', () => {
    expect(classifyCapture('2 eggs at 9am', TODAY)).toEqual({ kind: 'nutrition' })
  })

  it('routes food words with an explicit date to calendar (a plan, not a log)', () => {
    expect(classifyCapture('coffee with alex tomorrow 3pm', TODAY)).toEqual({ kind: 'calendar' })
  })

  it('routes date/time phrases to calendar', () => {
    expect(classifyCapture('dentist tuesday 2pm', TODAY)).toEqual({ kind: 'calendar' })
    expect(classifyCapture('team sync tomorrow at 9am', TODAY)).toEqual({ kind: 'calendar' })
  })

  it('returns none for text with no recognizable shape', () => {
    expect(classifyCapture('remember to be kind', TODAY)).toEqual({ kind: 'none' })
    expect(classifyCapture('', TODAY)).toEqual({ kind: 'none' })
  })

  it('detects food via lexicon brands, units-with-counts, and log verbs', () => {
    expect(looksLikeFood('little caesars slice')).toBe(true)
    expect(looksLikeFood('2 scoops whey')).toBe(true)
    expect(looksLikeFood('ate leftovers')).toBe(true)
    expect(looksLikeFood('quarterly planning meeting')).toBe(false)
  })
})

describe('income mentions outrank calendar cues (QA2-14)', () => {
  it('routes the operator line — income + "today" + employer — to money, not calendar', () => {
    expect(classifyCapture('I got paid 1400 today by my job TSMC', TODAY)).toEqual({
      kind: 'money',
      amountCents: 140000,
      merchant: 'TSMC'
    })
  })

  it('routes bare "got paid <amount>" to money with no merchant', () => {
    expect(classifyCapture('got paid 2400', TODAY)).toEqual({
      kind: 'money',
      amountCents: 240000,
      merchant: ''
    })
  })

  it('strips date words from the payer', () => {
    expect(classifyCapture('deposited 300 from venmo yesterday', TODAY)).toEqual({
      kind: 'money',
      amountCents: 30000,
      merchant: 'venmo'
    })
  })

  it('never reads a time as dollars', () => {
    // "5" is a time, not an amount — no deterministic guess, and crucially
    // NOT an instant calendar write either.
    expect(classifyCapture('got paid by my job friday at 5', TODAY)).toEqual({ kind: 'none' })
    expect(classifyCapture('got paid at 5pm', TODAY)).toEqual({ kind: 'none' })
  })

  it('leaves calendar lines without income wording alone', () => {
    expect(classifyCapture('dentist tuesday 2pm', TODAY)).toEqual({ kind: 'calendar' })
    expect(classifyCapture('lunch with the TSMC team next thursday 1pm', TODAY)).toEqual({
      kind: 'calendar'
    })
  })
})
