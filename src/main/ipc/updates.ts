import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import { checkForUpdates, getUpdateState, restartAndInstall } from '../updater'

export function registerUpdatesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.UPDATES_GET_STATE, (event) => {
    assertTrustedSender(event)
    return getUpdateState()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATES_CHECK_NOW, async (event) => {
    assertTrustedSender(event)
    await checkForUpdates()
    return getUpdateState()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATES_RESTART_AND_INSTALL, async (event) => {
    assertTrustedSender(event)
    await restartAndInstall()
    return { ok: true as const }
  })
}
