#!/usr/bin/env node
/**
 * Grain parity screenshots — dark + light at 100% and 200% zoom.
 * Usage: npm run build && node scripts/capture-grain-parity.mjs --label before|after
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const label = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1] ?? 'run'
  : 'run'

const userData = join(root, '.grain-perf-userdata')
mkdirSync(userData, { recursive: true })
const outDir = join(root, 'agent_docs', 'screenshots', `grain-parity-${label}`)
mkdirSync(outDir, { recursive: true })

const mainScript = join(root, '.grain-parity-runner.cjs')
writeFileSync(
  mainScript,
  `
const { app, BrowserWindow } = require('electron')
const { join } = require('path')
const { writeFileSync } = require('fs')

const root = ${JSON.stringify(root)}
const outDir = ${JSON.stringify(outDir)}

async function capture(win, name) {
  const image = await win.webContents.capturePage()
  writeFileSync(join(outDir, name + '.png'), image.toPNG())
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#161412',
    webPreferences: {
      preload: join(root, 'out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  await win.loadFile(join(root, 'out/renderer/index.html'), { hash: '/' })
  await win.webContents.executeJavaScript(
    \`new Promise((resolve) => {
      const tick = () => {
        if (document.querySelector('.moss-grain')) return resolve(true)
        requestAnimationFrame(tick)
      }
      tick()
    })\`,
    true
  )
  await new Promise((r) => setTimeout(r, 800))

  for (const mode of ['dark', 'light']) {
    await win.webContents.executeJavaScript(
      \`document.documentElement.dataset.colorMode = '\` + mode + \`'\`,
      true
    )
    await new Promise((r) => setTimeout(r, 300))
    await capture(win, mode + '-100')
    await win.webContents.executeJavaScript(
      \`(() => {
        document.documentElement.style.zoom = '2'
        return true
      })()\`,
      true
    )
    await new Promise((r) => setTimeout(r, 400))
    await capture(win, mode + '-200')
    await win.webContents.executeJavaScript(
      \`(() => { document.documentElement.style.zoom = '1'; return true })()\`,
      true
    )
  }

  process.stdout.write(JSON.stringify({ ok: true, outDir }) + '\\n')
  app.exit(0)
}).catch((err) => {
  process.stderr.write(String(err) + '\\n')
  app.exit(1)
})
`
)

const child = spawn(electronPath, [mainScript], {
  env: {
    ...process.env,
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
})

child.on('close', (code) => {
  if (code !== 0) {
    console.error(stderr || stdout)
    process.exit(code ?? 1)
  }
  console.log(stdout.trim())
})
