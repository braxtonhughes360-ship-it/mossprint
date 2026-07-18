import type { MoneyBudgetOverview } from '@shared/money'
import type { NutritionGoals } from '@shared/nutrition'
import type { GoalWeekSnapshot } from './goals'

export const WEEKLY_SCORE_MIN_PILLARS = 2

export const NUTRITION_CALORIE_BAND_RATIO = 0.15

export const NUTRITION_MIN_LOGGED_DAYS = 2

export const MONEY_MIN_ASSIGNED_ENVELOPES = 3

export type WeeklyScorePillarId = 'goals' | 'money' | 'nutrition'

export type WeeklyScoreStatus = 'ready' | 'insufficient_data'

export interface WeeklyScorePillar {
  id: WeeklyScorePillarId
  label: string
  trustworthy: boolean
  score: number | null
  summary: string
  detail: string
}

export interface WeeklyScoreSnapshot {
  weekStartKey: string
  weekEndKey: string
  todayKey: string
  status: WeeklyScoreStatus
  score: number | null
  pillars: WeeklyScorePillar[]
  headline: string
  hint: string
}

export interface WeeklyScoreComputeInput {
  weekStartKey: string
  todayKey: string
  goals: GoalWeekSnapshot
  budget: MoneyBudgetOverview
  nutritionGoals: NutritionGoals
  nutritionTotalsByDay: Array<{ dateKey: string; consumedKcal: number; entryCount: number }>
}

function elapsedWeekDayKeys(weekStartKey: string, todayKey: string): string[] {
  const keys: string[] = []
  let cursor = weekStartKey
  while (cursor <= todayKey) {
    keys.push(cursor)
    if (cursor === todayKey) break
    const [y, m, d] = cursor.split('-').map(Number)
    const next = new Date(y, m - 1, d + 1)
    const year = next.getFullYear()
    const month = String(next.getMonth() + 1).padStart(2, '0')
    const day = String(next.getDate()).padStart(2, '0')
    cursor = `${year}-${month}-${day}`
    if (keys.length > 7) break
  }
  return keys
}

function computeGoalsPillar(goals: GoalWeekSnapshot, todayKey: string): WeeklyScorePillar {
  const elapsedKeys = new Set(elapsedWeekDayKeys(goals.weekStartKey, todayKey))
  const scheduled = goals.instances.filter((row) => elapsedKeys.has(row.dateKey))
  const completed = scheduled.filter((row) => row.status === 'completed')

  const trustworthy = scheduled.length > 0
  const score =
    trustworthy && scheduled.length > 0
      ? Math.round((100 * completed.length) / scheduled.length)
      : null

  // Copy rule (QA-23): pillars describe what MOSS observed — they never
  // instruct the user to input anything. Absent pillars are optional, not owed.
  return {
    id: 'goals',
    label: 'Habits',
    trustworthy,
    score,
    summary: trustworthy
      ? `${completed.length}/${scheduled.length} check-ins kept`
      : 'No habits scheduled',
    detail: trustworthy
      ? `${completed.length} of ${scheduled.length} scheduled habit check-ins kept this week.`
      : 'Habits are optional — schedule some in Calendar → Goals and they join the score.'
  }
}

function computeMoneyPillar(budget: MoneyBudgetOverview): WeeklyScorePillar {
  const hasPaycheck = budget.paychecks.length > 0
  const assignedEnvelopes = budget.categories.filter((row) => row.assignedCents > 0)
  const active = budget.categories.filter(
    (row) => row.assignedCents > 0 || row.spentCents > 0
  )
  const healthy = active.filter((row) => row.remainingCents >= 0)

  const trustworthy = hasPaycheck || assignedEnvelopes.length >= MONEY_MIN_ASSIGNED_ENVELOPES
  const score =
    trustworthy && active.length > 0
      ? Math.round((100 * healthy.length) / active.length)
      : trustworthy
        ? 100
        : null

  return {
    id: 'money',
    label: 'Budget',
    trustworthy,
    score,
    summary: trustworthy
      ? active.length > 0
        ? `${healthy.length}/${active.length} envelopes healthy`
        : 'No spending yet'
      : 'No budget activity yet',
    detail: trustworthy
      ? active.length > 0
        ? `${healthy.length} of ${active.length} envelopes with activity are not overspent.`
        : 'Budget is set up — no envelope activity yet this period.'
      : 'Budget joins the score once money moves — a paycheck lands or an envelope sees spending.'
  }
}

function computeNutritionPillar(
  nutritionGoals: NutritionGoals,
  nutritionTotalsByDay: Array<{ dateKey: string; consumedKcal: number; entryCount: number }>,
  weekStartKey: string,
  todayKey: string
): WeeklyScorePillar {
  const elapsed = new Set(elapsedWeekDayKeys(weekStartKey, todayKey))
  const logged = nutritionTotalsByDay.filter(
    (row) => elapsed.has(row.dateKey) && row.entryCount > 0
  )
  const target = nutritionGoals.calorieTarget
  const onTarget = logged.filter((row) => {
    if (target <= 0) return false
    const delta = Math.abs(row.consumedKcal - target) / target
    return delta <= NUTRITION_CALORIE_BAND_RATIO
  })

  const trustworthy =
    target > 0 && logged.length >= NUTRITION_MIN_LOGGED_DAYS
  const score =
    trustworthy && logged.length > 0
      ? Math.round((100 * onTarget.length) / logged.length)
      : null

  return {
    id: 'nutrition',
    label: 'Nutrition',
    trustworthy,
    score,
    summary: trustworthy
      ? `${onTarget.length}/${logged.length} days near target`
      : target <= 0
        ? 'No calorie target set'
        : logged.length === 0
          ? 'No meals logged yet'
          : `Meals logged ${logged.length} day${logged.length === 1 ? '' : 's'} so far`,
    detail: trustworthy
      ? `${onTarget.length} of ${logged.length} logged days within ±${Math.round(NUTRITION_CALORIE_BAND_RATIO * 100)}% of ${target.toLocaleString()} kcal.`
      : target <= 0
        ? 'Nutrition joins the score when a calorie target exists in Nutrition → Goals.'
        : `Nutrition joins the score once meals are logged on ${NUTRITION_MIN_LOGGED_DAYS} days in a week.`
  }
}

export function computeWeeklyScore(input: WeeklyScoreComputeInput): WeeklyScoreSnapshot {
  const pillars: WeeklyScorePillar[] = [
    computeGoalsPillar(input.goals, input.todayKey),
    computeMoneyPillar(input.budget),
    computeNutritionPillar(
      input.nutritionGoals,
      input.nutritionTotalsByDay,
      input.weekStartKey,
      input.todayKey
    )
  ]

  const eligible = pillars.filter((pillar) => pillar.trustworthy && pillar.score !== null)
  const status: WeeklyScoreStatus =
    eligible.length >= WEEKLY_SCORE_MIN_PILLARS ? 'ready' : 'insufficient_data'
  const score =
    status === 'ready'
      ? Math.round(
          eligible.reduce((sum, pillar) => sum + (pillar.score ?? 0), 0) / eligible.length
        )
      : null

  const weekEndKey = (() => {
    const [y, m, d] = input.weekStartKey.split('-').map(Number)
    const end = new Date(y, m - 1, d + 6)
    const year = end.getFullYear()
    const month = String(end.getMonth() + 1).padStart(2, '0')
    const day = String(end.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })()

  // Never a fake number: empty weeks state plainly that not enough was logged.
  // The hint never assigns homework — the score fills in from normal use.
  let headline = 'Not enough logged this week'
  let hint = 'The score fills in on its own as you log money, meals, or habits — nothing to set up.'

  if (status === 'ready' && score !== null) {
    headline = `This week · ${score}`
    hint = `Equal parts ${eligible.map((p) => p.label.toLowerCase()).join(', ')} — from what you already log.`
  }

  return {
    weekStartKey: input.weekStartKey,
    weekEndKey,
    todayKey: input.todayKey,
    status,
    score,
    pillars,
    headline,
    hint
  }
}
