#!/usr/bin/env node
/**
 * Seeds the "QA Tester" profile into real ~/Library/Application Support/moss.
 * Usage: npm run seed:qa
 *
 * Set MOSS_QA_SEED_FORCE=1 to replace an existing QA Tester profile.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const force = process.env.MOSS_QA_SEED_FORCE === '1' ? '1' : '1'

const env = {
  ...process.env,
  MOSS_QA_SEED: '1',
  MOSS_QA_SEED_FORCE: force
}
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(electronBinary, ['.'], {
  cwd: root,
  env,
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
