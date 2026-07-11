#!/usr/bin/env node
/**
 * Idle dashboard perf sample for .moss-grain before/after comparison.
 * Uses Electron + CDP Performance.getMetrics (same family as DevTools Performance Monitor).
 *
 * Usage: npm run build && node scripts/measure-grain-perf.mjs [--label before|after]
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

const mainScript = join(root, '.grain-perf-runner.cjs')
writeFileSync(
  mainScript,
  `
const { app, BrowserWindow } = require('electron')
const { join } = require('path')
const { mkdirSync, writeFileSync } = require('fs')

const root = ${JSON.stringify(root)}
const label = ${JSON.stringify(label)}
const outPath = join(root, 'agent_docs', 'screenshots', \`grain-perf-\${label}.json\`)

async function sampleMetrics(wc) {
  wc.debugger.attach('1.3')
  await wc.debugger.sendCommand('Performance.enable')
  const start = await wc.debugger.sendCommand('Performance.getMetrics')
  await new Promise((r) => setTimeout(r, 10000))
  const end = await wc.debugger.sendCommand('Performance.getMetrics')
  let layerCount = null
  try {
    await wc.debugger.sendCommand('LayerTree.enable')
    const snap = await wc.debugger.sendCommand('LayerTree.layerTreeSnapshot')
    layerCount = snap?.layers?.length ?? null
  } catch {
    /* LayerTree unavailable in some builds */
  }
  const grainStyle = await wc.executeJavaScript(\`
    (() => {
      const el = document.querySelector('.moss-grain')
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        filter: cs.filter,
        backgroundImage: cs.backgroundImage.slice(0, 48),
        mixBlendMode: cs.mixBlendMode,
        opacity: cs.opacity
      }
    })()
  \`)
  wc.debugger.detach()
  const toMap = (metrics) => Object.fromEntries(metrics.map((m) => [m.name, m.value]))
  const a = toMap(start.metrics)
  const b = toMap(end.metrics)
  const delta = (key) => (b[key] ?? 0) - (a[key] ?? 0)
  return {
    idleSeconds: 10,
    taskDurationSec: delta('TaskDuration'),
    scriptDurationSec: delta('ScriptDuration'),
    layoutDurationSec: delta('LayoutDuration'),
    recalcStyleDurationSec: delta('RecalcStyleDuration'),
    layoutCount: delta('LayoutCount'),
    recalcStyleCount: delta('RecalcStyleCount'),
    jsHeapUsedMb: (b.JSHeapUsedSize ?? 0) / 1048576,
    nodes: b.Nodes,
    documents: b.Documents,
    frames: b.Frames,
    layerCount,
    grainStyle
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
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

  const result = await sampleMetrics(win.webContents)
  mkdirSync(join(root, 'agent_docs', 'screenshots'), { recursive: true })
  writeFileSync(outPath, JSON.stringify(result, null, 2))
  process.stdout.write(JSON.stringify({ ok: true, label, outPath, result }) + '\\n')
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
