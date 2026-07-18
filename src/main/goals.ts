import { randomUUID } from 'node:crypto'
import type {
  CreateGoalHabitInput,
  GoalCompletionRecord,
  GoalCompletionStatus,
  GoalHabitRecord,
  GoalWeekInstance,
  GoalWeekSnapshot,
  GoalWeekday,
  UpdateGoalHabitInput
} from '@shared/goals'
import { parseGoalWeekdays, serializeGoalWeekdays } from '@shared/goals'
import { currentDateKey, startOfWeekKey, weekDayKeys } from '@shared/calendar'
import { getDb } from './database'

type HabitRow = {
  id: string
  title: string
  weekdays: string
  time_hint: string | null
  created_at: string
  archived_at: string | null
}

type CompletionRow = {
  id: string
  habit_id: string
  date_key: string
  status: string
  updated_at: string
}

function rowToHabit(row: HabitRow): GoalHabitRecord {
  return {
    id: row.id,
    title: row.title,
    weekdays: parseGoalWeekdays(row.weekdays),
    timeHint: row.time_hint,
    createdAt: row.created_at,
    archivedAt: row.archived_at
  }
}

function rowToCompletion(row: CompletionRow): GoalCompletionRecord {
  return {
    id: row.id,
    habitId: row.habit_id,
    dateKey: row.date_key,
    status: row.status as GoalCompletionStatus,
    updatedAt: row.updated_at
  }
}

function weekdayFromDateKey(dateKey: string): GoalWeekday {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() as GoalWeekday
}

export function listGoalHabits(includeArchived = false): GoalHabitRecord[] {
  const rows = includeArchived
    ? (getDb()
        .prepare(
          `SELECT id, title, weekdays, time_hint, created_at, archived_at
           FROM goal_habits ORDER BY created_at ASC`
        )
        .all() as HabitRow[])
    : (getDb()
        .prepare(
          `SELECT id, title, weekdays, time_hint, created_at, archived_at
           FROM goal_habits WHERE archived_at IS NULL ORDER BY created_at ASC`
        )
        .all() as HabitRow[])

  return rows.map(rowToHabit)
}

export function createGoalHabit(input: CreateGoalHabitInput): GoalHabitRecord {
  const title = input.title.trim()
  if (!title) throw new Error('Habit title is required')
  if (!input.weekdays.length) throw new Error('Pick at least one weekday')

  const id = randomUUID()
  const now = new Date().toISOString()
  const weekdays = serializeGoalWeekdays(input.weekdays)
  const timeHint = input.timeHint?.trim() || null

  getDb()
    .prepare(
      `INSERT INTO goal_habits (id, title, weekdays, time_hint, created_at, archived_at)
       VALUES (@id, @title, @weekdays, @timeHint, @now, NULL)`
    )
    .run({ id, title, weekdays, timeHint, now })

  return rowToHabit(
    getDb()
      .prepare(
        `SELECT id, title, weekdays, time_hint, created_at, archived_at
         FROM goal_habits WHERE id = ?`
      )
      .get(id) as HabitRow
  )
}

export function updateGoalHabit(id: string, patch: UpdateGoalHabitInput): GoalHabitRecord {
  const existing = getDb()
    .prepare(
      `SELECT id, title, weekdays, time_hint, created_at, archived_at
       FROM goal_habits WHERE id = ?`
    )
    .get(id) as HabitRow | undefined

  if (!existing) throw new Error('Habit not found')

  const title = patch.title !== undefined ? patch.title.trim() : existing.title
  if (!title) throw new Error('Habit title is required')

  const weekdays =
    patch.weekdays !== undefined
      ? serializeGoalWeekdays(patch.weekdays)
      : existing.weekdays
  if (patch.weekdays !== undefined && patch.weekdays.length === 0) {
    throw new Error('Pick at least one weekday')
  }

  const timeHint =
    patch.timeHint !== undefined ? patch.timeHint?.trim() || null : existing.time_hint

  getDb()
    .prepare(
      `UPDATE goal_habits SET title = @title, weekdays = @weekdays, time_hint = @timeHint
       WHERE id = @id`
    )
    .run({ id, title, weekdays, timeHint })

  return rowToHabit(
    getDb()
      .prepare(
        `SELECT id, title, weekdays, time_hint, created_at, archived_at
         FROM goal_habits WHERE id = ?`
      )
      .get(id) as HabitRow
  )
}

export function archiveGoalHabit(id: string): { ok: true } {
  const now = new Date().toISOString()
  const result = getDb()
    .prepare('UPDATE goal_habits SET archived_at = @now WHERE id = @id AND archived_at IS NULL')
    .run({ id, now })

  if (result.changes === 0) throw new Error('Habit not found')
  return { ok: true }
}

export function deleteGoalHabit(id: string): { ok: true } {
  const result = getDb().prepare('DELETE FROM goal_habits WHERE id = ?').run(id)
  if (result.changes === 0) throw new Error('Habit not found')
  return { ok: true }
}

function completionsForWeek(weekStartKey: string): Map<string, GoalCompletionRecord> {
  const dayKeys = weekDayKeys(weekStartKey)
  const placeholders = dayKeys.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(
      `SELECT id, habit_id, date_key, status, updated_at
       FROM goal_completions WHERE date_key IN (${placeholders})`
    )
    .all(...dayKeys) as CompletionRow[]

  const map = new Map<string, GoalCompletionRecord>()
  for (const row of rows) {
    map.set(`${row.habit_id}:${row.date_key}`, rowToCompletion(row))
  }
  return map
}

function buildWeekInstances(
  habits: GoalHabitRecord[],
  weekStartKey: string,
  completionMap: Map<string, GoalCompletionRecord>
): GoalWeekInstance[] {
  const instances: GoalWeekInstance[] = []
  const dayKeys = weekDayKeys(weekStartKey)

  for (const habit of habits) {
    const weekdaySet = new Set(habit.weekdays)
    for (const dateKey of dayKeys) {
      const weekday = weekdayFromDateKey(dateKey)
      if (!weekdaySet.has(weekday)) continue
      const completion = completionMap.get(`${habit.id}:${dateKey}`)
      instances.push({
        habitId: habit.id,
        habitTitle: habit.title,
        dateKey,
        weekday,
        status: completion?.status ?? null,
        completionId: completion?.id ?? null
      })
    }
  }

  return instances
}

export function getGoalWeekSnapshot(weekStartKey?: string): GoalWeekSnapshot {
  const startKey = weekStartKey ?? startOfWeekKey(currentDateKey())
  const habits = listGoalHabits()
  const completionMap = completionsForWeek(startKey)
  const instances = buildWeekInstances(habits, startKey, completionMap)
  const scheduledCount = instances.length
  const completedCount = instances.filter((row) => row.status === 'completed').length

  return {
    weekStartKey: startKey,
    habits,
    instances,
    scheduledCount,
    completedCount
  }
}

export function setGoalCompletion(
  habitId: string,
  dateKey: string,
  status: GoalCompletionStatus | null
): GoalWeekSnapshot {
  const habit = getDb().prepare('SELECT id FROM goal_habits WHERE id = ?').get(habitId)
  if (!habit) throw new Error('Habit not found')

  const weekStart = startOfWeekKey(dateKey)
  const now = new Date().toISOString()

  if (status === null) {
    getDb()
      .prepare('DELETE FROM goal_completions WHERE habit_id = ? AND date_key = ?')
      .run(habitId, dateKey)
  } else {
    const existing = getDb()
      .prepare(
        `SELECT id FROM goal_completions WHERE habit_id = ? AND date_key = ?`
      )
      .get(habitId, dateKey) as { id: string } | undefined

    if (existing) {
      getDb()
        .prepare(
          `UPDATE goal_completions SET status = @status, updated_at = @now WHERE id = @id`
        )
        .run({ id: existing.id, status, now })
    } else {
      getDb()
        .prepare(
          `INSERT INTO goal_completions (id, habit_id, date_key, status, updated_at)
           VALUES (@id, @habitId, @dateKey, @status, @now)`
        )
        .run({ id: randomUUID(), habitId, dateKey, status, now })
    }
  }

  return getGoalWeekSnapshot(weekStart)
}

export function toggleGoalCompletion(habitId: string, dateKey: string): GoalWeekSnapshot {
  const existing = getDb()
    .prepare(
      `SELECT status FROM goal_completions WHERE habit_id = ? AND date_key = ?`
    )
    .get(habitId, dateKey) as { status: string } | undefined

  const next: GoalCompletionStatus | null =
    existing?.status === 'completed' ? null : 'completed'

  return setGoalCompletion(habitId, dateKey, next)
}
