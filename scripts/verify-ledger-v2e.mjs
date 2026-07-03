#!/usr/bin/env node
/**
 * Exercises the V2e ledger lifecycle end-to-end through the real SQLCipher stack.
 * Uses isolated userData — never touches operator profiles.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeadlessEnv, cleanupIsolatedUserDataDir } from './headless-user-data.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { env, userData } = buildHeadlessEnv('MOSS_HEADLESS_LEDGER_SMOKE')

try {
  const result = spawnSync(electronBinary, ['.'], {
    cwd: root,
    env,
    stdio: 'inherit'
  })
  process.exit(result.status ?? 1)
} finally {
  cleanupIsolatedUserDataDir(userData)
}
