import { describe, expect, it } from 'vitest'
import type { GoalWeekSnapshot } from '@shared/goals'
import type { CategoryBudgetRow, MoneyBudgetOverview, PaycheckRecord } from '@shared/money'
import type { NutritionGoals } from '@shared/nutrition'
import { computeWeeklyScore, type WeeklyScoreComputeInput } from '@shared/weeklyScore'

// Week under test: Monday 2026-06-29 … Sunday 2026-07-05, "today" = Thursday.
const WEEK_START = '2026-06-29'
const TODAY = '2026-07-02'

function emptyGoals(): GoalWeekSnapshot {
  return {
    weekStartKey: WEEK_START,
    habits: [],
    instances: [],
    scheduledCount: 0,
    completedCount: 0
  }
}

function goalsWith(instances: Array<{ dateKey: string; status: 'completed' | null }>): GoalWeekSnapshot {
  return {
    weekStartKey: WEEK_START,
    habits: [],
    instances: instances.map((row, index) => ({
      habitId: `h${index}`,
      habitTitle: 'Gym',
      dateKey: row.dateKey,
      weekday: 1,
      status: row.status,
      completionId: null
    })) as GoalWeekSnapshot['instances'],
    scheduledCount: instances.length,
    completedCount: instances.filter((row) => row.status === 'completed').length
  }
}

function envelope(assignedCents: number, spentCents: number): CategoryBudgetRow {
  return {
    category: { id: `c-${assignedCents}-${spentCents}-${Math.random()}` },
    assignedCents,
    spentCents,
    remainingCents: assignedCents - spentCents
  } as CategoryBudgetRow
}

function budgetWith(options: {
  paychecks?: number
  categories?: CategoryBudgetRow[]
}): MoneyBudgetOverview {
  return {
    periodKey: '2026-07',
    paycheckTotalCents: 0,
    assignedTotalCents: 0,
    unassignedCents: 0,
    groups: [],
    categories: options.categories ?? [],
    overspent: [],
    paychecks: Array.from(
      { length: options.paychecks ?? 0 },
      (_, index) => ({ id: `p${index}` }) as PaycheckRecord
    )
  }
}

const DEFAULT_TARGET: NutritionGoals = {
  calorieTarget: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 65,
  fiberG: null,
  updatedAt: '2026-06-01T00:00:00.000Z'
}

function nutritionDays(
  days: Array<{ dateKey: string; kcal: number }>
): WeeklyScoreComputeInput['nutritionTotalsByDay'] {
  return days.map((row) => ({
    dateKey: row.dateKey,
    consumedKcal: row.kcal,
    entryCount: row.kcal > 0 ? 3 : 0
  }))
}

function compute(overrides: Partial<WeeklyScoreComputeInput>): ReturnType<typeof computeWeeklyScore> {
  return computeWeeklyScore({
    weekStartKey: WEEK_START,
    todayKey: TODAY,
    goals: emptyGoals(),
    budget: budgetWith({}),
    nutritionGoals: DEFAULT_TARGET,
    nutritionTotalsByDay: [],
    ...overrides
  })
}

describe('computeWeeklyScore — passive two-pillar path (QA-23)', () => {
  it('is ready from money + nutrition alone: no habits, no manual setup', () => {
    const snapshot = compute({
      budget: budgetWith({
        paychecks: 1,
        categories: [envelope(50_000, 20_000), envelope(30_000, 35_000)]
      }),
      nutritionTotalsByDay: nutritionDays([
        { dateKey: '2026-06-29', kcal: 1990 }, // within ±15% of 2000
        { dateKey: '2026-06-30', kcal: 3000 } // outside the band
      ])
    })

    expect(snapshot.status).toBe('ready')
    // money: 1 of 2 active envelopes healthy = 50; nutrition: 1 of 2 near target = 50.
    expect(snapshot.score).toBe(50)
    expect(snapshot.headline).toBe('This week · 50')
    const goals = snapshot.pillars.find((p) => p.id === 'goals')!
    expect(goals.trustworthy).toBe(false)
    expect(goals.summary).toBe('No habits scheduled')
  })

  it('nutrition trusts the default calorie target — logging meals is the only gate', () => {
    const snapshot = compute({
      nutritionTotalsByDay: nutritionDays([
        { dateKey: '2026-06-29', kcal: 2000 },
        { dateKey: '2026-07-01', kcal: 2100 }
      ])
    })
    const nutrition = snapshot.pillars.find((p) => p.id === 'nutrition')!
    expect(nutrition.trustworthy).toBe(true)
    expect(nutrition.score).toBe(100)
    expect(nutrition.summary).toBe('2/2 days near target')
  })

  it('one logged day is not enough for the nutrition pillar', () => {
    const snapshot = compute({
      nutritionTotalsByDay: nutritionDays([{ dateKey: '2026-06-29', kcal: 2000 }])
    })
    const nutrition = snapshot.pillars.find((p) => p.id === 'nutrition')!
    expect(nutrition.trustworthy).toBe(false)
    expect(nutrition.score).toBeNull()
    expect(nutrition.summary).toBe('Meals logged 1 day so far')
  })
})

describe('computeWeeklyScore — empty weeks are honest (never a fake number)', () => {
  it('reports "Not enough logged this week" with a null score', () => {
    const snapshot = compute({})
    expect(snapshot.status).toBe('insufficient_data')
    expect(snapshot.score).toBeNull()
    expect(snapshot.headline).toBe('Not enough logged this week')
  })

  it('one eligible pillar is still insufficient (min 2)', () => {
    const snapshot = compute({
      budget: budgetWith({ paychecks: 1, categories: [envelope(10_000, 0)] })
    })
    expect(snapshot.status).toBe('insufficient_data')
    expect(snapshot.score).toBeNull()
  })

  it('pillar copy describes observations — it never assigns homework', () => {
    const snapshot = compute({})
    for (const pillar of snapshot.pillars) {
      // The old copy opened with imperatives ("Add a habit…", "Assign envelopes…",
      // "Set a calorie target", "Log N more days"). Observational copy must not.
      expect(pillar.summary).not.toMatch(/^(Add|Assign|Set|Log|Record|Create)\b/)
    }
    expect(snapshot.hint).toContain('nothing to set up')
  })
})

describe('computeWeeklyScore — pillar math (published formula unchanged)', () => {
  it('goals: completed over scheduled on elapsed days only', () => {
    const snapshot = compute({
      goals: goalsWith([
        { dateKey: '2026-06-29', status: 'completed' },
        { dateKey: '2026-06-30', status: null },
        { dateKey: '2026-07-01', status: 'completed' },
        { dateKey: '2026-07-04', status: null } // future — excluded
      ])
    })
    const goals = snapshot.pillars.find((p) => p.id === 'goals')!
    expect(goals.trustworthy).toBe(true)
    expect(goals.score).toBe(67)
    expect(goals.summary).toBe('2/3 check-ins kept')
  })

  it('money: paycheck with no envelope activity scores 100', () => {
    const snapshot = compute({ budget: budgetWith({ paychecks: 1 }) })
    const money = snapshot.pillars.find((p) => p.id === 'money')!
    expect(money.trustworthy).toBe(true)
    expect(money.score).toBe(100)
    expect(money.summary).toBe('No spending yet')
  })

  it('composite is the equal-weight mean of eligible pillars', () => {
    const snapshot = compute({
      goals: goalsWith([{ dateKey: '2026-06-29', status: 'completed' }]), // 100
      budget: budgetWith({
        paychecks: 1,
        categories: [envelope(10_000, 12_000)] // 0/1 healthy = 0
      }),
      nutritionTotalsByDay: nutritionDays([
        { dateKey: '2026-06-29', kcal: 2000 },
        { dateKey: '2026-06-30', kcal: 2050 }
      ]) // 100
    })
    expect(snapshot.status).toBe('ready')
    expect(snapshot.score).toBe(67) // round((100 + 0 + 100) / 3)
  })
})
