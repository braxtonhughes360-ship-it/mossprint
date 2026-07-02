import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'

function isAllowedExternalUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false
  }

  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function registerShellHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, (event, rawUrl: unknown) => {
    assertTrustedSender(event)

    if (!isAllowedExternalUrl(rawUrl)) {
      throw new Error('Disallowed external URL')
    }

    void shell.openExternal(rawUrl)
    return { ok: true as const }
  })
}
