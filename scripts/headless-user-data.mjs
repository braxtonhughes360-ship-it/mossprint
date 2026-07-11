/**
 * Isolated userData for headless Electron verify scripts.
 * Never touches the operator's real ~/Library/Application Support/moss profiles.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createIsolatedUserDataDir(prefix = 'moss-headless-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupIsolatedUserDataDir(dir) {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

/**
 * @param {string} headlessFlag - e.g. MOSS_HEADLESS_HEALTHCHECK
 * @param {Record<string, string>} [extra]
 * @returns {{ env: NodeJS.ProcessEnv; userData: string }}
 */
export function buildHeadlessEnv(headlessFlag, extra = {}) {
  const userData = createIsolatedUserDataDir()
  const env = {
    ...process.env,
    [headlessFlag]: '1',
    MOSS_HEADLESS_USER_DATA: userData,
    ...extra
  }
  delete env.ELECTRON_RUN_AS_NODE
  return { env, userData }
}
