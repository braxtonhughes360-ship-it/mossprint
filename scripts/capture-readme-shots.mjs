#!/usr/bin/env node
/**
 * Captures README screenshots (docs/screenshots/*.png) from a seeded
 * QA Tester profile in an ISOLATED userData dir — never real data,
 * never the operator's profiles. Usage: npm run shots:readme
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeadlessEnv, cleanupIsolatedUserDataDir } from './headless-user-data.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { env, userData } = buildHeadlessEnv('MOSS_HEADLESS_README_SHOTS')

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
