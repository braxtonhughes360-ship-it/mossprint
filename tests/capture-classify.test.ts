import { describe, expect, it } from 'vitest'
import { classifyCapture, looksLikeFood } from '../src/main/captureClassify'

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
