import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { MossAppSettings } from '@shared/appSettings'
import { assertTrustedSender } from './trust'
import { getAppSettings, patchAppSettings } from '../appSettings'
import { applyKeepInMenuBarSetting } from '../appLifecycle'

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

function assertAppSettingsPatch(value: unknown): Partial<MossAppSettings> {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid app settings patch')
  }
  const row = value as Record<string, unknown>
  const patch: Partial<MossAppSettings> = {}
  if ('keepInMenuBar' in row) {
    if (typeof row.keepInMenuBar !== 'boolean') {
      throw new Error('Invalid keepInMenuBar value')
    }
    patch.keepInMenuBar = row.keepInMenuBar
  }
  return patch
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

  ipcMain.handle(IPC_CHANNELS.SHELL_GET_APP_SETTINGS, (event) => {
    assertTrustedSender(event)
    return getAppSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SHELL_SET_APP_SETTINGS, (event, patch: unknown) => {
    assertTrustedSender(event)
    const parsed = assertAppSettingsPatch(patch)
    if (typeof parsed.keepInMenuBar === 'boolean') {
      return applyKeepInMenuBarSetting(parsed.keepInMenuBar)
    }
    return patchAppSettings(parsed)
  })
}
