import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import { requireActiveProfileDatabase } from '../profiles'
import { closeDatabase, getSetting, pingDatabase, runHealthCheck, setSetting } from '../database'
import { getDataOverview, moveDataFolder, pickMoveTarget, showDataInFolder } from '../dataDir'

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

  ipcMain.handle(IPC_CHANNELS.DATA_GET_OVERVIEW, (event) => {
    assertTrustedSender(event)
    return getDataOverview()
  })

  ipcMain.handle(IPC_CHANNELS.DATA_SHOW_IN_FOLDER, (event) => {
    assertTrustedSender(event)
    showDataInFolder()
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.DATA_PICK_MOVE_TARGET, (event) => {
    assertTrustedSender(event)
    return pickMoveTarget()
  })

  ipcMain.handle(IPC_CHANNELS.DATA_MOVE_FOLDER, async (event, targetPath: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(targetPath, 'targetPath')
    const result = await moveDataFolder(targetPath)
    if (result.ok) {
      // Let the response reach the renderer, then rebind everything via a clean restart.
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 600)
    }
    return result
  })
}

export function shutdownDatabase(): void {
  closeDatabase()
}
