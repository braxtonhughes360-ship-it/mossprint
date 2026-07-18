import { currentDateKey, startOfWeekKey, weekDayKeys } from '@shared/calendar'
import type { WeeklyScoreSnapshot } from '@shared/weeklyScore'
import { computeWeeklyScore } from '@shared/weeklyScore'
import { getGoalWeekSnapshot } from './goals'
import { getBudgetOverview } from './money'
import { getGoals } from './nutrition'
import { getDb } from './database'

function listNutritionTotalsForWeek(weekStartKey: string): Array<{
  dateKey: string
  consumedKcal: number
  entryCount: number
}> {
  const dayKeys = weekDayKeys(weekStartKey)
  const placeholders = dayKeys.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(
      `SELECT date_key, consumed_kcal, entry_count
       FROM daily_nutrition_totals WHERE date_key IN (${placeholders})`
    )
    .all(...dayKeys) as Array<{
    date_key: string
    consumed_kcal: number
    entry_count: number
  }>

  const byKey = new Map(
    rows.map((row) => [
      row.date_key,
      {
        dateKey: row.date_key,
        consumedKcal: row.consumed_kcal,
        entryCount: row.entry_count
      }
    ])
  )

  return dayKeys.map(
    (dateKey) =>
      byKey.get(dateKey) ?? {
        dateKey,
        consumedKcal: 0,
        entryCount: 0
      }
  )
}

export function getWeeklyScore(weekStartKey?: string): WeeklyScoreSnapshot {
  const todayKey = currentDateKey()
  const startKey = weekStartKey ?? startOfWeekKey(todayKey)

  return computeWeeklyScore({
    weekStartKey: startKey,
    todayKey,
    goals: getGoalWeekSnapshot(startKey),
    budget: getBudgetOverview(),
    nutritionGoals: getGoals(),
    nutritionTotalsByDay: listNutritionTotalsForWeek(startKey)
  })
}
