import { mkdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

/** Env flags that launch Electron without a window for automated checks. */
const HEADLESS_FLAGS = [
  'MOSS_HEADLESS_HEALTHCHECK',
  'MOSS_HEADLESS_LEDGER_SMOKE',
  'MOSS_HEADLESS_FLOW_SMOKE',
  'MOSS_HEADLESS_REPORTS_SMOKE',
  'MOSS_HEADLESS_USDA_IMPORT',
  'MOSS_HEADLESS_CALENDAR_PARSE',
  'MOSS_HEADLESS_NEWS_OFFLINE',
  'MOSS_HEADLESS_NEWS_WIDGET_SHOT',
  'MOSS_HEADLESS_README_SHOTS',
  'MOSS_HEADLESS_DESCRIBE_PARSE',
  'MOSS_HEADLESS_CAPTURE_ROUTING',
  'MOSS_HEADLESS_DESCRIBE',
  'MOSS_HEADLESS_ESTIMATE_LABELS',
  'MOSS_HEADLESS_SEED'
] as const

export function isHeadlessProcess(): boolean {
  return HEADLESS_FLAGS.some((flag) => process.env[flag] === '1')
}

/** Headless runs must never read or write ~/Library/Application Support/moss. */
export function usesIsolatedUserData(): boolean {
  return isHeadlessProcess() || Boolean(process.env.MOSS_HEADLESS_USER_DATA)
}

/**
 * Redirect userData to an isolated directory before app.ready.
 * verify:* scripts pass MOSS_HEADLESS_USER_DATA; direct electron invocations get a temp dir.
 */
export function applyHeadlessUserDataIsolation(): void {
  if (!isHeadlessProcess() && !process.env.MOSS_HEADLESS_USER_DATA) {
    return
  }

  let base = process.env.MOSS_HEADLESS_USER_DATA
  if (!base) {
    base = mkdtempSync(join(tmpdir(), 'moss-headless-'))
    process.env.MOSS_HEADLESS_USER_DATA = base
    process.env.MOSS_HEADLESS_TEMP_CREATED = '1'
  }

  mkdirSync(base, { recursive: true })
  app.setPath('userData', base)
}

/** Isolated/CI runs use plain key files — no macOS Keychain dependency. */
export function usesPlainDbKeyStorage(): boolean {
  return usesIsolatedUserData() || process.env.MOSS_PLAIN_DB_KEY === '1'
}
