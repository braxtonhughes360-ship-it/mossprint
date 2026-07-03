import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type {
  CalendarEventRange,
  CreateCalendarEventInput,
  CreateClassScheduleInput,
  UpdateCalendarEventInput
} from '@shared/calendar'
import { CALENDAR_EVENT_KINDS, CLASS_WEEKDAYS } from '@shared/calendar'
import type { CalendarDeleteEventResult } from '@shared/calendar'
import {
  createCalendarEvent,
  createClassSchedule,
  deleteCalendarEvent,
  getCalendarEventById,
  getCalendarMonthGlance,
  getCalendarSourceById,
  getCalendarWeekGlance,
  getCurrentWeekGlance,
  getCalendarDoorSnapshot,
  listCalendarEvents,
  listCalendarSources,
  setCalendarSourceEnabled,
  updateCalendarEvent
} from '../calendar'
import { importIcsFromPath, importIcsFromUrl } from '../calendarIcs'
import { subscribeCaldav } from '../calendarCaldav'
import {
  connectGoogleCalendar,
  deleteGoogleRemoteEvent,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  storeGoogleOAuthClientConfig,
  syncCalendarSource
} from '../calendarGoogle'
import { syncAllCalendarSources } from '../calendarSync'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function assertEventRange(value: unknown): CalendarEventRange {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid event range')
  }
  const payload = value as CalendarEventRange
  assertNonEmptyString(payload.startAt, 'startAt')
  assertNonEmptyString(payload.endAt, 'endAt')
  return payload
}

function assertCreateInput(value: unknown): CreateCalendarEventInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid event input')
  }
  const payload = value as CreateCalendarEventInput
  assertNonEmptyString(payload.title, 'title')
  assertNonEmptyString(payload.startAt, 'startAt')
  assertNonEmptyString(payload.endAt, 'endAt')
  if (payload.kind !== undefined && !CALENDAR_EVENT_KINDS.includes(payload.kind)) {
    throw new Error('Invalid event kind')
  }
  return payload
}

function assertUpdateInput(value: unknown): UpdateCalendarEventInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid event patch')
  }
  const payload = value as UpdateCalendarEventInput
  if (payload.title !== undefined) {
    assertNonEmptyString(payload.title, 'title')
  }
  if (payload.startAt !== undefined) {
    assertNonEmptyString(payload.startAt, 'startAt')
  }
  if (payload.endAt !== undefined) {
    assertNonEmptyString(payload.endAt, 'endAt')
  }
  if (payload.kind !== undefined && !CALENDAR_EVENT_KINDS.includes(payload.kind)) {
    throw new Error('Invalid event kind')
  }
  return payload
}

function assertClassScheduleInput(value: unknown): CreateClassScheduleInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid class schedule input')
  }
  const payload = value as CreateClassScheduleInput
  assertNonEmptyString(payload.title, 'title')
  assertNonEmptyString(payload.startTime, 'startTime')
  assertNonEmptyString(payload.endTime, 'endTime')
  assertNonEmptyString(payload.termStartKey, 'termStartKey')
  assertNonEmptyString(payload.termEndKey, 'termEndKey')
  if (!Array.isArray(payload.days) || payload.days.length === 0) {
    throw new Error('days must include at least one weekday')
  }
  for (const day of payload.days) {
    if (!CLASS_WEEKDAYS.includes(day)) {
      throw new Error(`Invalid weekday: ${String(day)}`)
    }
  }
  return payload
}

export function registerCalendarHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CALENDAR_LIST_EVENTS, (event, range: unknown) => {
    assertTrustedSender(event)
    return listCalendarEvents(assertEventRange(range))
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_LIST_SOURCES, (event) => {
    assertTrustedSender(event)
    return listCalendarSources()
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_GET_WEEK_GLANCE, (event, weekStartKey?: unknown) => {
    assertTrustedSender(event)
    if (weekStartKey !== undefined) {
      assertNonEmptyString(weekStartKey, 'weekStartKey')
      return getCalendarWeekGlance(weekStartKey)
    }
    return getCurrentWeekGlance()
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_CREATE_EVENT, (event, input: unknown) => {
    assertTrustedSender(event)
    return createCalendarEvent(assertCreateInput(input))
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_UPDATE_EVENT, (event, id: unknown, patch: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return updateCalendarEvent(id, assertUpdateInput(patch))
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_DELETE_EVENT, async (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')

    // Two-way delete: if the event mirrors a Google event, delete it upstream too. The local
    // soft-delete always proceeds (local-first), even if the upstream call can't be made.
    const existing = getCalendarEventById(id)
    let remoteDeleted = false
    let remoteReason: CalendarDeleteEventResult['remoteReason'] = 'local-only'
    if (existing?.sourceId && existing.externalId) {
      const source = getCalendarSourceById(existing.sourceId)
      if (source?.kind === 'google') {
        const remote = await deleteGoogleRemoteEvent(existing.sourceId, existing.externalId)
        remoteDeleted = remote.deleted
        remoteReason = remote.deleted ? undefined : (remote.reason ?? 'sync-error')
      }
    }

    deleteCalendarEvent(id)
    return { ok: true as const, remoteDeleted, remoteReason }
  })

  ipcMain.handle(
    IPC_CHANNELS.CALENDAR_SET_SOURCE_ENABLED,
    (event, sourceId: unknown, enabled: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(sourceId, 'sourceId')
      if (typeof enabled !== 'boolean') {
        throw new Error('enabled must be a boolean')
      }
      return setCalendarSourceEnabled(sourceId, enabled)
    }
  )

  ipcMain.handle(IPC_CHANNELS.CALENDAR_SUBSCRIBE_CALDAV, async (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid CalDAV input')
    }
    const payload = input as {
      url?: unknown
      label?: unknown
      username?: unknown
      password?: unknown
    }
    assertNonEmptyString(payload.url, 'url')
    return subscribeCaldav({
      url: payload.url,
      label: typeof payload.label === 'string' ? payload.label : undefined,
      username: typeof payload.username === 'string' ? payload.username : undefined,
      password: typeof payload.password === 'string' ? payload.password : undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_GET_MONTH_GLANCE, (event, monthKey: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(monthKey, 'monthKey')
    return getCalendarMonthGlance(monthKey)
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_IMPORT_ICS_FILE, async (event) => {
    assertTrustedSender(event)

    const result = await dialog.showOpenDialog({
      title: 'Import calendar (.ics)',
      properties: ['openFile'],
      filters: [{ name: 'iCalendar', extensions: ['ics', 'ical'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const }
    }

    const importResult = await importIcsFromPath(result.filePaths[0])
    return {
      canceled: false as const,
      ...importResult
    }
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_IMPORT_ICS_URL, async (event, rawUrl: unknown, label?: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(rawUrl, 'url')
    const resolvedLabel =
      label !== undefined && typeof label === 'string' && label.trim().length > 0
        ? label.trim()
        : undefined
    return importIcsFromUrl(rawUrl.trim(), resolvedLabel)
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_GET_GOOGLE_STATUS, (event) => {
    assertTrustedSender(event)
    return getGoogleCalendarStatus()
  })

  ipcMain.handle(
    IPC_CHANNELS.CALENDAR_SET_GOOGLE_OAUTH,
    (event, clientId: unknown, clientSecret: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(clientId, 'clientId')
      assertNonEmptyString(clientSecret, 'clientSecret')
      storeGoogleOAuthClientConfig(clientId, clientSecret)
      return { ok: true as const }
    }
  )

  ipcMain.handle(IPC_CHANNELS.CALENDAR_CREATE_CLASS_SCHEDULE, (event, input: unknown) => {
    assertTrustedSender(event)
    return createClassSchedule(assertClassScheduleInput(input))
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_CONNECT_GOOGLE, async (event, label?: unknown) => {
    assertTrustedSender(event)
    const resolvedLabel =
      label !== undefined && typeof label === 'string' && label.trim().length > 0
        ? label.trim()
        : undefined
    // Connect now runs through the system-browser loopback flow — no parent window needed.
    return connectGoogleCalendar(resolvedLabel)
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_SYNC_SOURCE, async (event, sourceId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(sourceId, 'sourceId')
    return syncCalendarSource(sourceId)
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_DISCONNECT_GOOGLE, (event, sourceId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(sourceId, 'sourceId')
    return disconnectGoogleCalendar(sourceId)
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_SYNC_ALL, async (event) => {
    assertTrustedSender(event)
    return syncAllCalendarSources()
  })

  ipcMain.handle(IPC_CHANNELS.CALENDAR_GET_DOOR_SNAPSHOT, (event) => {
    assertTrustedSender(event)
    return getCalendarDoorSnapshot()
  })
}
