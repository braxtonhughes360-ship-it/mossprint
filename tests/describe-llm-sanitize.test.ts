import { describe, expect, it, vi } from 'vitest'

// nutritionDescribeLlm reads settings for model overrides; stub the
// Electron-backed database module so the pure sanitizer runs in node.
vi.mock('../src/main/database', () => ({
  getSetting: () => null
}))

import { sanitizeItems } from '../src/main/nutritionDescribeLlm'

function validItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'grilled chicken breast',
    quantity: 1,
    unit: 'piece',
    kcal: 280,
    protein_g: 26,
    carbs_g: 0,
    fat_g: 6,
    confidence: 'high',
    ...overrides
  }
}

describe('sanitizeItems (untrusted model output)', () => {
  it('returns [] for non-object, missing, or non-array payloads', () => {
    expect(sanitizeItems(null)).toEqual([])
    expect(sanitizeItems(undefined)).toEqual([])
    expect(sanitizeItems('2 eggs and toast')).toEqual([])
    expect(sanitizeItems({})).toEqual([])
    expect(sanitizeItems({ items: 'chicken' })).toEqual([])
    expect(sanitizeItems({ items: { name: 'chicken', kcal: 200 } })).toEqual([])
  })

  it('skips entries that are not objects and keeps the valid ones', () => {
    const result = sanitizeItems({ items: [null, 42, 'salad', [], validItem()] })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('grilled chicken breast')
  })

  it('drops items with empty or non-string names', () => {
    const result = sanitizeItems({
      items: [
        validItem({ name: '' }),
        validItem({ name: '   ' }),
        validItem({ name: 42 }),
        validItem({ name: null })
      ]
    })
    expect(result).toEqual([])
  })

  it('drops items whose kcal is missing, non-numeric, or non-positive', () => {
    const result = sanitizeItems({
      items: [
        validItem({ kcal: '280' }),
        validItem({ kcal: Number.NaN }),
        validItem({ kcal: Number.POSITIVE_INFINITY }),
        validItem({ kcal: 0 }),
        validItem({ kcal: -120 }),
        validItem({ kcal: undefined })
      ]
    })
    expect(result).toEqual([])
  })

  it('clamps runaway kcal and macros instead of trusting the model', () => {
    const [item] = sanitizeItems({
      items: [validItem({ kcal: 5000, protein_g: 900, carbs_g: 2000, fat_g: -30 })]
    })
    expect(item.kcal).toBe(3000)
    expect(item.protein_g).toBe(500)
    expect(item.carbs_g).toBe(800)
    expect(item.fat_g).toBe(0)
  })

  it('caps the list at 12 items', () => {
    const items = Array.from({ length: 30 }, (_, i) => validItem({ name: `food ${i}` }))
    expect(sanitizeItems({ items })).toHaveLength(12)
  })

  it('defaults malformed quantity, unit, and confidence to safe values', () => {
    const [item] = sanitizeItems({
      items: [validItem({ quantity: 'two', unit: 7, confidence: 'certain' })]
    })
    expect(item.quantity).toBe(1)
    expect(item.unit).toBeNull()
    expect(item.confidence).toBe('medium')
  })

  it('clamps quantity into a plausible range', () => {
    const result = sanitizeItems({
      items: [validItem({ quantity: 500 }), validItem({ name: 'toast', quantity: 0 })]
    })
    expect(result[0].quantity).toBe(50)
    expect(result[1].quantity).toBe(0.1)
  })

  it('trims and truncates absurd names and units', () => {
    const [item] = sanitizeItems({
      items: [validItem({ name: `  ${'x'.repeat(300)}`, unit: '  TABLESPOONS-OF-SOMETHING-HUGE  ' })]
    })
    expect(item.name).toBe('x'.repeat(80))
    expect(item.unit).toBe('tablespoons-of-something')
  })
})
