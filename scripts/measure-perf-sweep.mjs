#!/usr/bin/env node
/**
 * QA-09 perf sweep runner (beta.5 V2). Launches the built app in
 * MOSS_HEADLESS_PERF_SWEEP mode against an isolated temp userData dir and
 * writes agent_docs/screenshots/perf-sweep-<label>.json for before/after diffs.
 *
 * Usage: npm run build && node scripts/measure-perf-sweep.mjs [--label before|after]
 *        MOSS_PERF_IDLE_SECONDS=60 node scripts/measure-perf-sweep.mjs --label soak
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const label = process.argv.includes('--label')
  ? (process.argv[process.argv.indexOf('--label') + 1] ?? 'run')
  : 'run'

const userData = mkdtempSync(join(tmpdir(), 'moss-perf-sweep-'))

const child = spawn(electronPath, [join(root, 'out/main/index.js')], {
  env: {
    ...process.env,
    MOSS_HEADLESS_PERF_SWEEP: '1',
    MOSS_HEADLESS_USER_DATA: userData,
    ELECTRON_RUN_AS_NODE: undefined
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => {
  stdout += d
})
child.stderr.on('data', (d) => {
  stderr += d
  // Progress markers stream through so a hung step is visible live.
  process.stderr.write(d)
})

child.on('close', (code) => {
  if (code !== 0) {
    console.error(stderr || stdout)
    process.exit(code ?? 1)
  }
  const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '{}'
  const outDir = join(root, 'agent_docs', 'screenshots')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `perf-sweep-${label}.json`)
  writeFileSync(outPath, JSON.stringify(JSON.parse(line), null, 2))
  console.log(`wrote ${outPath}`)
  console.log(line)
})
