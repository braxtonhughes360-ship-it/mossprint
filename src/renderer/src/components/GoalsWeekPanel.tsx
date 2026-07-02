import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GoalHabitRecord, GoalWeekday, GoalWeekSnapshot } from '@shared/goals'
import { GOAL_WEEKDAY_LABELS, formatGoalWeekdays } from '@shared/goals'
import {
  currentDateKey,
  formatDayShortLabel,
  shiftWeekKey,
  startOfWeekKey,
  weekDayKeys
} from '@shared/calendar'
import { MossConfirmDialog } from './MossConfirmDialog'

interface GoalsWeekPanelProps {
  weekStartKey: string
  onWeekChange: (weekStartKey: string) => void
  /** Fired after any habit mutation so an owner (e.g. the weekly score) can refresh. */
  onMutate?: () => void
}

const DEFAULT_WEEKDAYS: GoalWeekday[] = [1, 3, 5]

export function GoalsWeekPanel({
  weekStartKey,
  onWeekChange,
  onMutate
}: GoalsWeekPanelProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GoalWeekSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newWeekdays, setNewWeekdays] = useState<GoalWeekday[]>(DEFAULT_WEEKDAYS)
  const [archiveTarget, setArchiveTarget] = useState<GoalHabitRecord | null>(null)

  const todayKey = currentDateKey()
  const dayKeys = useMemo(() => weekDayKeys(weekStartKey), [weekStartKey])
  const isCurrentWeek = weekStartKey === startOfWeekKey(todayKey)

  const load = useCallback(async () => {
    if (!window.moss?.goals) {
      setError('Goals storage unavailable')
      return
    }
    try {
      const next = await window.moss.goals.getWeek(weekStartKey)
      setSnapshot(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goals')
    }
  }, [weekStartKey])

  useEffect(() => {
    void load()
  }, [load])

  async function runMutation(task: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await task()
      await load()
      onMutate?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const instanceMap = useMemo(() => {
    const map = new Map<string, GoalWeekSnapshot['instances'][number]>()
    for (const row of snapshot?.instances ?? []) {
      map.set(`${row.habitId}:${row.dateKey}`, row)
    }
    return map
  }, [snapshot])

  async function handleCreateHabit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!newTitle.trim() || newWeekdays.length === 0) return
    await runMutation(async () => {
      await window.moss.goals.createHabit({
        title: newTitle.trim(),
        weekdays: newWeekdays
      })
      setNewTitle('')
    })
  }

  function toggleWeekday(day: GoalWeekday): void {
    setNewWeekdays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day]
    )
  }

  async function handleToggle(habitId: string, dateKey: string): Promise<void> {
    if (dateKey > todayKey) return
    await runMutation(async () => {
      await window.moss.goals.toggleCompletion(habitId, dateKey)
    })
  }

  async function handleArchiveConfirmed(habit: GoalHabitRecord): Promise<void> {
    setArchiveTarget(null)
    await runMutation(async () => {
      await window.moss.goals.archiveHabit(habit.id)
    })
  }

  const habits = snapshot?.habits ?? []

  return (
    <div className="goals-week-panel">
      {error && (
        <div className="error-banner">
          <p className="text-sm text-signal-error-text">{error}</p>
        </div>
      )}

      <div className="goals-week-toolbar">
        <p className="goals-week-copy">
          Habits stay here — separate from synced work and personal calendars.
        </p>
        <div className="calendar-week-nav">
          <button
            type="button"
            className="calendar-week-nav-button"
            aria-label="Previous week"
            onClick={() => onWeekChange(shiftWeekKey(weekStartKey, -1))}
          >
            ←
          </button>
          {!isCurrentWeek && (
            <button
              type="button"
              className="money-button money-button--ghost money-button--compact"
              onClick={() => onWeekChange(startOfWeekKey(todayKey))}
            >
              This week
            </button>
          )}
          <button
            type="button"
            className="calendar-week-nav-button"
            aria-label="Next week"
            onClick={() => onWeekChange(shiftWeekKey(weekStartKey, 1))}
          >
            →
          </button>
        </div>
      </div>

      <form className="goals-add-form" onSubmit={(event) => void handleCreateHabit(event)}>
        <input
          className="preference-input goals-add-title"
          value={newTitle}
          placeholder="New habit — e.g. Gym, Meal prep"
          aria-label="Habit title"
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <div className="goals-weekday-picker" role="group" aria-label="Repeat on">
          {([1, 2, 3, 4, 5, 6, 0] as GoalWeekday[]).map((day) => (
            <button
              key={day}
              type="button"
              className={[
                'goals-weekday-btn',
                newWeekdays.includes(day) ? 'goals-weekday-btn--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={newWeekdays.includes(day)}
              onClick={() => toggleWeekday(day)}
            >
              {GOAL_WEEKDAY_LABELS[day]}
            </button>
          ))}
        </div>
        <button
          type="submit"
          className="money-button money-button--compact"
          disabled={busy || !newTitle.trim() || newWeekdays.length === 0}
        >
          Add habit
        </button>
      </form>

      {habits.length === 0 ? (
        <div className="goals-week-empty">
          <p>No habits yet. Add one above — they feed your weekly score.</p>
        </div>
      ) : (
        <div className="goals-week-grid-wrap">
          <table className="goals-week-grid" aria-label="Habits this week">
            <thead>
              <tr>
                <th scope="col" className="goals-week-grid-habit-col">
                  Habit
                </th>
                {dayKeys.map((dateKey) => (
                  <th
                    key={dateKey}
                    scope="col"
                    className={[
                      'goals-week-grid-day-col',
                      dateKey === todayKey ? 'goals-week-grid-day-col--today' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="goals-week-grid-day-label">{formatDayShortLabel(dateKey)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {habits.map((habit) => (
                <tr key={habit.id}>
                  <th scope="row" className="goals-week-grid-habit">
                    <span className="goals-week-grid-habit-title">{habit.title}</span>
                    <span className="goals-week-grid-habit-meta nutrition-mono">
                      {formatGoalWeekdays(habit.weekdays)}
                    </span>
                    <button
                      type="button"
                      className="goals-week-archive-btn"
                      disabled={busy}
                      onClick={() => setArchiveTarget(habit)}
                    >
                      Archive
                    </button>
                  </th>
                  {dayKeys.map((dateKey) => {
                    const instance = instanceMap.get(`${habit.id}:${dateKey}`)
                    const scheduled = Boolean(instance)
                    const completed = instance?.status === 'completed'
                    const future = dateKey > todayKey
                    return (
                      <td
                        key={dateKey}
                        className={[
                          'goals-week-grid-cell',
                          dateKey === todayKey ? 'goals-week-grid-cell--today' : '',
                          !scheduled ? 'goals-week-grid-cell--off' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {scheduled ? (
                          <button
                            type="button"
                            className={[
                              'goals-week-check',
                              completed ? 'goals-week-check--done' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            disabled={busy || future}
                            aria-label={
                              completed
                                ? `Mark ${habit.title} incomplete on ${dateKey}`
                                : `Mark ${habit.title} done on ${dateKey}`
                            }
                            aria-pressed={completed}
                            onClick={() => void handleToggle(habit.id, dateKey)}
                          >
                            {completed ? '✓' : ''}
                          </button>
                        ) : (
                          <span className="goals-week-off" aria-hidden>
                            ·
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archiveTarget && (
        <MossConfirmDialog
          title={`Archive “${archiveTarget.title}”?`}
          body="It stops appearing this week and no longer counts toward your weekly score. Past check-ins are kept."
          confirmLabel="Archive habit"
          tone="danger"
          busy={busy}
          onConfirm={() => void handleArchiveConfirmed(archiveTarget)}
          onClose={() => setArchiveTarget(null)}
        />
      )}
    </div>
  )
}
