import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type { CreateGoalHabitInput, GoalCompletionStatus, UpdateGoalHabitInput } from '@shared/goals'
import {
  archiveGoalHabit,
  createGoalHabit,
  deleteGoalHabit,
  getGoalWeekSnapshot,
  listGoalHabits,
  setGoalCompletion,
  toggleGoalCompletion,
  updateGoalHabit
} from '../goals'
import { getWeeklyScore } from '../weeklyScore'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

export function registerGoalsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GOALS_LIST_HABITS, (event) => {
    assertTrustedSender(event)
    return listGoalHabits()
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_CREATE_HABIT, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid habit input')
    return createGoalHabit(input as CreateGoalHabitInput)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_UPDATE_HABIT, (event, id: unknown, patch: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    if (!patch || typeof patch !== 'object') throw new Error('Invalid habit patch')
    return updateGoalHabit(id, patch as UpdateGoalHabitInput)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_ARCHIVE_HABIT, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return archiveGoalHabit(id)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_DELETE_HABIT, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return deleteGoalHabit(id)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_GET_WEEK, (event, weekStartKey?: unknown) => {
    assertTrustedSender(event)
    if (weekStartKey !== undefined && typeof weekStartKey !== 'string') {
      throw new Error('weekStartKey must be a string')
    }
    return getGoalWeekSnapshot(weekStartKey)
  })

  ipcMain.handle(
    IPC_CHANNELS.GOALS_SET_COMPLETION,
    (event, habitId: unknown, dateKey: unknown, status: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(habitId, 'habitId')
      assertNonEmptyString(dateKey, 'dateKey')
      if (status !== null && status !== 'completed' && status !== 'skipped') {
        throw new Error('status must be completed, skipped, or null')
      }
      return setGoalCompletion(habitId, dateKey, status as GoalCompletionStatus | null)
    }
  )

  ipcMain.handle(IPC_CHANNELS.GOALS_TOGGLE_COMPLETION, (event, habitId: unknown, dateKey: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(habitId, 'habitId')
    assertNonEmptyString(dateKey, 'dateKey')
    return toggleGoalCompletion(habitId, dateKey)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_GET_WEEKLY_SCORE, (event, weekStartKey?: unknown) => {
    assertTrustedSender(event)
    if (weekStartKey !== undefined && typeof weekStartKey !== 'string') {
      throw new Error('weekStartKey must be a string')
    }
    return getWeeklyScore(weekStartKey)
  })
}
