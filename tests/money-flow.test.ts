import { describe, expect, it } from 'vitest'
import type { CategoryBudgetRow, MoneyBudgetOverview } from '@shared/money'
import {
  DEFAULT_MONEY_FLOW_SETTINGS,
  EMPTY_LEDGER_FLOW_SNAPSHOT,
  MONTH_WRAP_MIN_LEFTOVER_CENTS,
  computeMoneyFlowGuidance,
  computeMonthWrapUp
} from '@shared/moneyFlow'
import { computeContributionGuidance } from '@shared/moneySavings'

function categoryRow(overrides: {
  id: string
  name: string
  assignedCents: number
  spentCents: number
  countsTowardSafeToSpend?: boolean
  targetCents?: number | null
}): CategoryBudgetRow {
  const remaining = overrides.assignedCents - overrides.spentCents
  return {
    category: {
      id: overrides.id,
      name: overrides.name,
      sortOrder: 0,
      groupId: null,
      targetCents: overrides.targetCents ?? null,
      countsTowardSafeToSpend: overrides.countsTowardSafeToSpend ?? true,
      rolloverEnabled: false,
      rolloverReleasedCents: 0,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    assignedCents: overrides.assignedCents,
    spentCents: overrides.spentCents,
    carryInCents: 0,
    remainingCents: remaining,
    targetCents: overrides.targetCents ?? null
  }
}

function budget(categories: CategoryBudgetRow[], periodKey = '2026-07'): MoneyBudgetOverview {
  return {
    periodKey,
    paycheckTotalCents: 200_000,
    assignedTotalCents: categories.reduce((sum, row) => sum + row.assignedCents, 0),
    unassignedCents: 0,
    groups: [],
    categories,
    overspent: categories
      .filter((row) => row.remainingCents < 0)
      .map((row) => ({
        categoryId: row.category.id,
        name: row.category.name,
        remainingCents: row.remainingCents
      })),
    paychecks: []
  }
}

describe('computeMonthWrapUp', () => {
  const dining = categoryRow({ id: 'dining', name: 'Dining', assignedCents: 50_000, spentCents: 10_000 })

  it('is not eligible mid-month even with leftover', () => {
    const readout = computeMonthWrapUp({
      budget: budget([dining]),
      isCurrentPeriod: true,
      today: '2026-07-05'
    })
    expect(readout.discretionaryLeftoverCents).toBe(40_000)
    expect(readout.eligible).toBe(false)
  })

  it('is eligible near month end with meaningful leftover', () => {
    const readout = computeMonthWrapUp({
      budget: budget([dining]),
      isCurrentPeriod: true,
      today: '2026-07-31'
    })
    expect(readout.eligible).toBe(true)
    expect(readout.suggestedSweepCents).toBe(40_000)
  })

  it('stays quiet below the minimum leftover', () => {
    const coffee = categoryRow({ id: 'coffee', name: 'Coffee', assignedCents: 2_000, spentCents: 0 })
    const readout = computeMonthWrapUp({
      budget: budget([coffee]),
      isCurrentPeriod: true,
      today: '2026-07-31'
    })
    expect(readout.discretionaryLeftoverCents).toBeLessThan(MONTH_WRAP_MIN_LEFTOVER_CENTS)
    expect(readout.eligible).toBe(false)
  })

  it('never surfaces when browsing a past month', () => {
    const readout = computeMonthWrapUp({
      budget: budget([dining], '2026-06'),
      isCurrentPeriod: false,
      today: '2026-06-30'
    })
    expect(readout.eligible).toBe(false)
  })

  it('excludes protected (bill/savings) envelopes from the sweep', () => {
    const rent = categoryRow({
      id: 'rent',
      name: 'Rent',
      assignedCents: 145_000,
      spentCents: 0,
      countsTowardSafeToSpend: false
    })
    const readout = computeMonthWrapUp({
      budget: budget([dining, rent]),
      isCurrentPeriod: true,
      today: '2026-07-31'
    })
    expect(readout.discretionaryLeftoverCents).toBe(40_000)
  })

  it('ignores overspent envelopes instead of netting them against leftover', () => {
    const over = categoryRow({ id: 'fun', name: 'Fun', assignedCents: 10_000, spentCents: 25_000 })
    const readout = computeMonthWrapUp({
      budget: budget([dining, over]),
      isCurrentPeriod: true,
      today: '2026-07-31'
    })
    expect(readout.discretionaryLeftoverCents).toBe(40_000)
  })
})

describe('computeMoneyFlowGuidance — bills paid early in the month', () => {
  // Regression for beta QA (2026-07-02): $1,561 income, car payment $275 and a
  // $140 bill assigned with matching goals, both paid in full on day 2. The old
  // pace math projected the one-time payments as a daily burn (≈$6k phantom
  // spend) and flagged both envelopes "burning fast" → month read Tight/at risk
  // with $1,100+ genuinely left over.
  function paidBillsInput() {
    const car = categoryRow({
      id: 'car',
      name: 'Car payment',
      assignedCents: 27_500,
      spentCents: 27_500,
      targetCents: 27_500
    })
    const utilities = categoryRow({
      id: 'utilities',
      name: 'Utilities',
      assignedCents: 14_000,
      spentCents: 14_000,
      targetCents: 14_000
    })
    const overview: MoneyBudgetOverview = {
      periodKey: '2026-07',
      paycheckTotalCents: 156_100,
      assignedTotalCents: 41_500,
      unassignedCents: 114_600,
      groups: [],
      categories: [car, utilities],
      overspent: [],
      paychecks: [
        {
          id: 'p1',
          label: 'Paycheck',
          amountCents: 156_100,
          receivedAt: '2026-07-01T09:00:00.000Z',
          createdAt: '2026-07-01T09:00:00.000Z'
        }
      ]
    }
    return {
      budget: overview,
      monthFlowCents: 114_600,
      ledgerNetCents: 114_600,
      ledger: EMPTY_LEDGER_FLOW_SNAPSHOT,
      schedules: [],
      expectedPaychecks: [],
      settings: DEFAULT_MONEY_FLOW_SETTINGS,
      today: '2026-07-02'
    }
  }

  it('reads on track, not tight, when funded bills are simply paid', () => {
    const guidance = computeMoneyFlowGuidance(paidBillsInput())
    expect(guidance.status).toBe('on_track')
  })

  it('does not flag fully paid goal-met envelopes as overspend risks', () => {
    const guidance = computeMoneyFlowGuidance(paidBillsInput())
    expect(guidance.overspendRisk.atRisk).toBe(false)
    expect(guidance.overspendRisk.envelopes).toHaveLength(0)
  })

  it('still warns when an everyday envelope is burning fast with money left', () => {
    const input = paidBillsInput()
    const groceries = categoryRow({
      id: 'groceries',
      name: 'Groceries',
      assignedCents: 30_000,
      spentCents: 27_000
    })
    input.budget.categories.push(groceries)
    input.budget.assignedTotalCents += 30_000
    input.budget.unassignedCents -= 30_000
    const guidance = computeMoneyFlowGuidance(input)
    expect(guidance.overspendRisk.atRisk).toBe(true)
    expect(guidance.overspendRisk.envelopes.map((e) => e.name)).toEqual(['Groceries'])
  })
})

describe('computeContributionGuidance', () => {
  // Ported from the headless flow smoke (runHeadlessFlowSmoke) so the pacing
  // math is covered without booting Electron.
  it('paces from the saved balance when nothing is saved yet', () => {
    const guidance = computeContributionGuidance({
      savedCents: 0,
      targetCents: 50_000,
      targetDate: null,
      assignedThisPeriodCents: 10_000,
      safeToSaveCents: 5000,
      unassignedCents: 5000
    })
    expect(guidance.remainingThisMonthCents).toBe(12_500)
    expect(guidance.suggestedAssignCents).toBe(5000)
  })

  it('asks for less this month once part of the goal is already saved', () => {
    const fresh = computeContributionGuidance({
      savedCents: 0,
      targetCents: 50_000,
      targetDate: null,
      assignedThisPeriodCents: 10_000,
      safeToSaveCents: 5000,
      unassignedCents: 5000
    })
    const partial = computeContributionGuidance({
      savedCents: 10_000,
      targetCents: 50_000,
      targetDate: null,
      assignedThisPeriodCents: 10_000,
      safeToSaveCents: 5000,
      unassignedCents: 5000
    })
    expect(partial.remainingThisMonthCents).toBeLessThan(fresh.remainingThisMonthCents)
  })
})
