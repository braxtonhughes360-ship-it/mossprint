import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender, assertNonEmptyString } from './trust'
import { requireActiveProfileDatabase } from '../profiles'
import { routeCaptureText } from '../captureRoute'
import { hideCaptureWindow } from '../captureWindow'
import { resetIdleLockOnActivate } from '../idleLock'

export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CAPTURE_SUBMIT, async (event, text: unknown) => {
    assertTrustedSender(event)
    // Capture writes into the open profile database — locked/no profile means no capture.
    requireActiveProfileDatabase()
    assertNonEmptyString(text, 'text')
    const result = await routeCaptureText(text)
    // A successful capture is user activity — keep the idle lock honest.
    resetIdleLockOnActivate()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURE_HIDE, (event) => {
    assertTrustedSender(event)
    hideCaptureWindow()
    return { ok: true as const }
  })
}
