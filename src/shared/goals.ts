export const GOAL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

export type GoalWeekday = (typeof GOAL_WEEKDAYS)[number]

export const GOAL_WEEKDAY_LABELS: Record<GoalWeekday, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat'
}

export type GoalCompletionStatus = 'completed' | 'skipped'

export interface GoalHabitRecord {
  id: string
  title: string
  weekdays: GoalWeekday[]
  timeHint: string | null
  createdAt: string
  archivedAt: string | null
}

export interface GoalCompletionRecord {
  id: string
  habitId: string
  dateKey: string
  status: GoalCompletionStatus
  updatedAt: string
}

export interface GoalWeekInstance {
  habitId: string
  habitTitle: string
  dateKey: string
  weekday: GoalWeekday
  status: GoalCompletionStatus | null
  completionId: string | null
}

export interface GoalWeekSnapshot {
  weekStartKey: string
  habits: GoalHabitRecord[]
  instances: GoalWeekInstance[]
  scheduledCount: number
  completedCount: number
}

export interface CreateGoalHabitInput {
  title: string
  weekdays: GoalWeekday[]
  timeHint?: string | null
}

export interface UpdateGoalHabitInput {
  title?: string
  weekdays?: GoalWeekday[]
  timeHint?: string | null
}

export function parseGoalWeekdays(raw: string): GoalWeekday[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is GoalWeekday =>
        typeof entry === 'number' && entry >= 0 && entry <= 6 && Number.isInteger(entry)
    )
  } catch {
    return []
  }
}

export function serializeGoalWeekdays(weekdays: GoalWeekday[]): string {
  const unique = Array.from(new Set(weekdays)).sort((a, b) => a - b)
  return JSON.stringify(unique)
}

export function formatGoalWeekdays(weekdays: GoalWeekday[]): string {
  if (weekdays.length === 0) return 'No days'
  if (weekdays.length === 7) return 'Every day'
  const sorted = [...weekdays].sort((a, b) => a - b)
  return sorted.map((day) => GOAL_WEEKDAY_LABELS[day]).join(' · ')
}
