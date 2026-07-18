import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_APP_SETTINGS,
  mergeAppSettings,
  parseAppSettings,
  type MossAppSettings
} from '@shared/appSettings'

const APP_SETTINGS_FILE = 'app-settings.json'

let cached: MossAppSettings = { ...DEFAULT_APP_SETTINGS }

function settingsPath(): string {
  return join(app.getPath('userData'), APP_SETTINGS_FILE)
}

export function loadAppSettings(): MossAppSettings {
  try {
    const path = settingsPath()
    if (!existsSync(path)) {
      cached = { ...DEFAULT_APP_SETTINGS }
      return cached
    }
    cached = parseAppSettings(readFileSync(path, 'utf8'))
    return cached
  } catch {
    cached = { ...DEFAULT_APP_SETTINGS }
    return cached
  }
}

export function getAppSettings(): MossAppSettings {
  return cached
}

export function saveAppSettings(next: MossAppSettings): MossAppSettings {
  cached = { ...next }
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), `${JSON.stringify(cached, null, 2)}\n`, 'utf8')
  return cached
}

export function patchAppSettings(patch: Partial<MossAppSettings>): MossAppSettings {
  return saveAppSettings(mergeAppSettings(cached, patch))
}

export function isKeepInMenuBarEnabled(): boolean {
  return cached.keepInMenuBar
}
