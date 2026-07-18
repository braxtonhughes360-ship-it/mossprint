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

describe('computeMoneyFlowGuidance — hero signals reconcile (beta.4 A2)', () => {
  // Regression for the shipped contradiction (2026-07-02): the Financials hero
  // showed "$2,619 to assign / $2,819 safe to spend / Tight / Rent covered"
  // AND "Rent at risk" at once. Seed: rent envelope 90% spent early in the
  // month (pacing-flagged), not fully funded in-envelope, but thousands
  // unassigned. Three signals used three different definitions.
  function contradictionInput() {
    const rent = categoryRow({
      id: 'rent',
      name: 'Rent',
      assignedCents: 150_000,
      spentCents: 135_000,
      targetCents: 150_000
    })
    const groceries = categoryRow({
      id: 'groceries',
      name: 'Groceries',
      assignedCents: 20_000,
      spentCents: 5_000
    })
    const overview: MoneyBudgetOverview = {
      periodKey: '2026-07',
      paycheckTotalCents: 431_900,
      assignedTotalCents: 170_000,
      unassignedCents: 261_900,
      groups: [],
      categories: [rent, groceries],
      overspent: [],
      paychecks: [
        {
          id: 'p1',
          label: 'Paycheck',
          amountCents: 431_900,
          receivedAt: '2026-07-01T09:00:00.000Z',
          createdAt: '2026-07-01T09:00:00.000Z'
        }
      ]
    }
    return {
      budget: overview,
      monthFlowCents: 261_900,
      ledgerNetCents: 261_900,
      ledger: EMPTY_LEDGER_FLOW_SNAPSHOT,
      schedules: [],
      expectedPaychecks: [],
      settings: DEFAULT_MONEY_FLOW_SETTINGS,
      today: '2026-07-10'
    }
  }

  it('never says covered and at-risk about the same housing envelope', () => {
    const guidance = computeMoneyFlowGuidance(contradictionInput())
    const rentInRiskList = guidance.overspendRisk.envelopes.some((e) => e.categoryId === 'rent')
    // Invariant 1: covered XOR at-risk. Here the glance owns the story, so the
    // pacing list must not name the housing envelope at all.
    expect(guidance.rentGlance.covered && rentInRiskList).toBe(false)
    expect(rentInRiskList).toBe(false)
  })

  it('does not call unassigned-fundable rent "covered" — it is the softer assign nudge', () => {
    const guidance = computeMoneyFlowGuidance(contradictionInput())
    // Invariant 2: covered means money in the envelope. $150 in-envelope vs a
    // $1,500 target is NOT covered; $2,619 unassigned makes it fundable.
    expect(guidance.rentGlance.covered).toBe(false)
    expect(guidance.rentGlance.state).toBe('assign')
    expect(guidance.rentGlance.pillLabel).toBe('Assign to Rent')
    expect(guidance.rentGlance.why).toContain('assign')
  })

  it('does not read Tight next to thousands available and no visible overspend', () => {
    const guidance = computeMoneyFlowGuidance(contradictionInput())
    // Invariant 3: the status label must be supported by the shown numbers.
    expect(guidance.status).toBe('on_track')
    // The pressure still surfaces as a nudge, not a red month.
    expect(guidance.statusWhy).toContain('Rent')
  })

  it('still goes red on a genuine housing shortfall', () => {
    const input = contradictionInput()
    input.budget.unassignedCents = 10_000 // cannot make the $1,350 gap
    input.monthFlowCents = 10_000
    const guidance = computeMoneyFlowGuidance(input)
    // Invariant 4: no papering over a real shortfall.
    expect(guidance.rentGlance.state).toBe('at_risk')
    expect(guidance.rentGlance.covered).toBe(false)
    expect(guidance.status).toBe('over')
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
