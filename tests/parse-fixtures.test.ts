import { describe, expect, it } from 'vitest'
import { runCalendarParseFixtures } from '../src/shared/calendarEventParse'
import { runDescribeParseFixtures } from '../src/main/nutritionDescribeParse'
import {
  runEstimateKcalAnchorRegressions,
  runEstimateLabelRegressions
} from '../src/main/nutritionEstimates'

// These fixture runners used to be reachable only through headless Electron
// (verify:calendar-parse / verify:describe-parse) — minutes per run. They are
// pure TypeScript, so they run here in milliseconds.

describe('calendar natural-language parse fixtures', () => {
  it('passes the built-in fixture suite', () => {
    const result = runCalendarParseFixtures()
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('nutrition describe parse fixtures (heuristic fallback path)', () => {
  it('passes the built-in fixture suite', () => {
    const result = runDescribeParseFixtures()
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('passes estimate label regressions', () => {
    const result = runEstimateLabelRegressions()
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('passes estimate kcal anchor regressions', () => {
    const result = runEstimateKcalAnchorRegressions()
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
  })
})
