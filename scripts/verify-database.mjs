#!/usr/bin/env node
/**
 * Verifies SQLite read/write in dev build output and packaged app.
 * Uses an isolated temp userData dir — never touches real operator profiles.
 * Usage: node scripts/verify-database.mjs [path-to-MOSS.app/Contents/MacOS/MOSS]
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeadlessEnv, cleanupIsolatedUserDataDir } from './headless-user-data.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function run(command, args, options = {}) {
  const { env: headlessEnv, userData } = buildHeadlessEnv('MOSS_HEADLESS_HEALTHCHECK')
  const { args: extraArgs = [], timeoutMs = 120_000, ...spawnOptions } = options
  return new Promise((resolvePromise, reject) => {
    const env = { ...headlessEnv, ...options.env }

    const child = spawn(command, [...extraArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      ...spawnOptions
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
          }, timeoutMs)
        : null

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      cleanupIsolatedUserDataDir(userData)
      if (timer) clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`Health check timed out after ${timeoutMs}ms.\nstderr: ${stderr}`))
        return
      }
      resolvePromise({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', (err) => {
      cleanupIsolatedUserDataDir(userData)
      reject(err)
    })
  })
}

function parseHealth(stdout) {
  const line = stdout
    .trim()
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('{') && entry.endsWith('}'))

  if (!line) {
    throw new Error(`No JSON health payload in output:\n${stdout}`)
  }

  return JSON.parse(line)
}

async function verify(label, executable, options = {}) {
  if (!existsSync(executable)) {
    throw new Error(`${label} executable not found: ${executable}`)
  }

  const { code, stdout, stderr } = await run(executable, [], options)
  const health = parseHealth(stdout)

  if (code !== 0 || !health.ok) {
    throw new Error(
      `${label} health check failed (exit ${code}).\nstdout: ${stdout}\nstderr: ${stderr}`
    )
  }

  console.log(`✓ ${label}: ${health.message}`)
  console.log(`  database: ${health.databasePath}`)
  console.log(`  (isolated headless run — your profiles were not modified)`)
}

const packagedArg = process.argv[2]

await verify('Dev build', electronBinary, {
  cwd: root,
  args: ['.']
})

if (packagedArg) {
  await verify('Packaged app', packagedArg)
} else {
  const packagedDefault = join(
    root,
    'release',
    'mac-arm64',
    'MOSS.app',
    'Contents',
    'MacOS',
    'MOSS'
  )

  if (existsSync(packagedDefault)) {
    await verify('Packaged app', packagedDefault)
  } else {
    console.log('ℹ Packaged app not found yet; run npm run package:mac to verify packaging.')
  }
}
