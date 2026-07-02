import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import { requireActiveProfileDatabase } from '../profiles'
import { closeDatabase, getSetting, pingDatabase, runHealthCheck, setSetting } from '../database'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function assertActiveDatabase(event: Electron.IpcMainInvokeEvent): void {
  assertTrustedSender(event)
  requireActiveProfileDatabase()
}

export function registerDatabaseHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DB_RUN_HEALTH_CHECK, (event) => {
    assertActiveDatabase(event)
    return runHealthCheck()
  })

  ipcMain.handle(IPC_CHANNELS.DB_GET_SETTING, (event, key: unknown) => {
    assertActiveDatabase(event)
    assertNonEmptyString(key, 'key')
    return getSetting(key)
  })

  ipcMain.handle(IPC_CHANNELS.DB_SET_SETTING, (event, key: unknown, value: unknown) => {
    assertActiveDatabase(event)
    assertNonEmptyString(key, 'key')
    assertNonEmptyString(value, 'value')
    return setSetting(key, value)
  })

  ipcMain.handle(IPC_CHANNELS.DB_PING, (event) => {
    assertActiveDatabase(event)
    return pingDatabase()
  })
}

export function shutdownDatabase(): void {
  closeDatabase()
}
