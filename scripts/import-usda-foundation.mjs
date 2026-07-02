#!/usr/bin/env node
/**
 * One-time USDA Foundation Foods import into the local Moss SQLite catalog.
 * No API key — downloads the official CC0 JSON bundle (~340 foods).
 *
 * Usage:
 *   npm run build && node scripts/import-usda-foundation.mjs
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const mainEntry = join(root, 'out/main/index.js')

function runImport() {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env, MOSS_HEADLESS_USDA_IMPORT: '1' }
    delete env.ELECTRON_RUN_AS_NODE

    const child = spawn(electronBinary, [mainEntry], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Import exited with code ${code}`))
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        resolvePromise(result)
      } catch {
        reject(new Error(`Unexpected import output: ${stdout}`))
      }
    })
  })
}

console.log('Downloading USDA Foundation Foods (CC0, no API key)…')
runImport()
  .then((result) => {
    console.log(
      `Done: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped (${result.total} in bundle).`
    )
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
