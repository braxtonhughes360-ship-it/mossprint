#!/usr/bin/env node
/**
 * Beta.5 QA2 scripted re-smoke (BETA5_HUMAN_QA_SMOKE.md §12b) — drives the
 * real renderer against a seeded QA profile in an ISOLATED userData dir.
 * Usage: npm run smoke:qa2
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeadlessEnv, cleanupIsolatedUserDataDir } from './headless-user-data.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { env, userData } = buildHeadlessEnv('MOSS_HEADLESS_QA2_SMOKE')

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
