import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { app } from 'electron'
import { parseDataRootOverride, resolveProfilesRoot } from './dataDirCore'

/**
 * D1 — the profiles tree can live outside userData. The override is a tiny
 * JSON file that stays in userData (app-level, never moved), so headless runs
 * — which redirect userData itself — never see a stray override.
 */
const DATA_ROOT_OVERRIDE_FILE = 'data-root.json'

let cachedProfilesRoot: string | null = null

export function dataRootOverridePath(): string {
  return join(app.getPath('userData'), DATA_ROOT_OVERRIDE_FILE)
}

/** Base dir of a custom data location, or null when data lives in userData. */
export function currentDataRootOverride(): string | null {
  try {
    return parseDataRootOverride(readFileSync(dataRootOverridePath(), 'utf8'))
  } catch {
    return null
  }
}

export function profilesRoot(): string {
  if (!cachedProfilesRoot) {
    cachedProfilesRoot = resolveProfilesRoot(app.getPath('userData'), currentDataRootOverride())
  }
  return cachedProfilesRoot
}

/** Call after flipping the override so the next path lookup re-resolves. */
export function invalidateProfilesRootCache(): void {
  cachedProfilesRoot = null
}

export function profileDirectory(profileId: string): string {
  return join(profilesRoot(), profileId)
}

export function profileDatabasePath(profileId: string): string {
  return join(profileDirectory(profileId), 'moss.sqlite')
}
