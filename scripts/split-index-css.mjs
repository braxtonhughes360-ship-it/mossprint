#!/usr/bin/env node
/**
 * Mechanical split of index.css into per-route CSS chunks.
 * Classifies top-level rule blocks inside @layer sections by selector prefix.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = path.join(root, 'src/renderer/src/index.css')
const srcDir = path.join(root, 'src/renderer/src')

/** @type {Record<string, string>} */
const PREFIX_TO_FILE = {
  money: 'MoneyPage.css',
  mail: 'InboxPage.css',
  inbox: 'InboxPage.css',
  calendar: 'CalendarPage.css',
  nutrition: 'NutritionPage.css',
  notes: 'NotesPage.css',
  settings: 'SettingsPage.css',
  'moss-settings': 'SettingsPage.css',
  'settings-arrival': 'SettingsPage.css',
  'news-reader': 'SettingsPage.css',
  'news-sources': 'SettingsPage.css',
  'moss-setup': 'SetupWizard.css',
  capture: 'CapturePage.css',
  'local-ai': 'SettingsPage.css',
  'localai': 'SettingsPage.css'
}

/** Selectors that must stay in core (boot / shell / dashboard). */
const CORE_PATTERNS = [
  /^@tailwind/,
  /^@font-face/,
  /^:root/,
  /^html/,
  /^body/,
  /^\*/,
  /^\.moss-(nav|boot|hero|door|threshold|render|profile|arrival(?!-(calendar|inbox|money|nutrition|notes))|env|route|modal|confirm|label|glance|elevated|section|atrium|dashboard|capture-bar|weekly)/,
  /^\.dashboard-/,
  /^\.module-door/,
  /^\.moss-module-door/,
  /^\.moss-nav/,
  /^\.moss-boot/,
  /^\.moss-hero/,
  /^\.moss-door/,
  /^\.moss-profile/,
  /^\.moss-threshold/,
  /^\.moss-render/,
  /^\.moss-env/,
  /^\.moss-route/,
  /^\.moss-modal/,
  /^\.moss-confirm/,
  /^\.moss-capture-bar/,
  /^\.moss-weekly/,
  /^\.moss-flip/,
  /^\.moss-solar/,
  /^\.moss-select(?!-)/, // MossSelect core — also used cross-module; keep in index
  /^\.moss-arrival(?!-(calendar|inbox|money|nutrition|notes))/,
  /^\.module-arrival/,
  /^\.module-workspace(?!-(money|calendar|inbox|nutrition|notes))/,
  /^\.display-/,
  /^\.btn-/,
  /^\.segmented-/,
  /^\.climate-/,
  /^\.scale-/,
  /^\.memory-/,
  /^\.mono-data/,
  /^\.moss-dev-perf/,
  /^\.moss-settings-route/,
  /^\.moss-module-route/,
  /^\.nutrition-mono$/, // shared mono utility used everywhere
  /^\.money-nav-glyph/,
  /^\.nutrition-nav-glyph/,
  /^\.calendar-nav/,
  /^\.inbox-nav/,
  /^\.settings-nav/,
  /^\.money-door/,
  /^\.nutrition-door/,
  /^\.calendar-door/,
  /^\.inbox-door/,
  /^\.notes-door/,
  /^\.news-door/,
  /^\.money-flow-door/,
  /^\.nutrition-macro-door/,
]

/**
 * @param {string} selector
 * @returns {string | null}
 */
function classifySelector(selector) {
  const s = selector.trim()
  if (!s || s.startsWith('@')) return null

  for (const pat of CORE_PATTERNS) {
    if (pat.test(s)) return 'core'
  }

  for (const [prefix, file] of Object.entries(PREFIX_TO_FILE)) {
    const re = new RegExp(`\\.${prefix.replace(/-/g, '\\-')}`)
    if (re.test(s)) return file
  }

  // moss-arrival-{module}
  const arrival = s.match(/\.moss-arrival-(calendar|inbox|money|nutrition|notes)/)
  if (arrival) {
    const map = {
      calendar: 'CalendarPage.css',
      inbox: 'InboxPage.css',
      money: 'MoneyPage.css',
      nutrition: 'NutritionPage.css',
      notes: 'NotesPage.css'
    }
    return map[arrival[1]]
  }

  // module-workspace-{module}
  const ws = s.match(/\.module-workspace-(money|calendar|inbox|nutrition|notes)/)
  if (ws) {
    const map = {
      calendar: 'CalendarPage.css',
      inbox: 'InboxPage.css',
      money: 'MoneyPage.css',
      nutrition: 'NutritionPage.css',
      notes: 'NotesPage.css'
    }
    return map[ws[1]]
  }

  // data-module selectors
  if (/\[data-module=['"]money['"]\]/.test(s)) return 'MoneyPage.css'
  if (/\[data-module=['"]calendar['"]\]/.test(s)) return 'CalendarPage.css'
  if (/\[data-module=['"]inbox['"]\]/.test(s)) return 'InboxPage.css'
  if (/\[data-module=['"]nutrition['"]\]/.test(s)) return 'NutritionPage.css'
  if (/\[data-module=['"]notes['"]\]/.test(s)) return 'NotesPage.css'

  return 'core'
}

/**
 * @param {string} header - rule header before `{`
 * @returns {Set<string>}
 */
function classifyBlock(header) {
  const selectors = header
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const targets = new Set()
  for (const sel of selectors) {
    targets.add(classifySelector(sel) ?? 'core')
  }
  return targets
}

/**
 * Split a multi-target block into per-file versions.
 * @param {string} block
 * @param {Set<string>} targets
 * @returns {Map<string, string>}
 */
function splitBlock(block, targets) {
  if (targets.size === 1) {
    const file = [...targets][0]
    return new Map([[file, block]])
  }

  const match = block.match(/^(\s*)(.+?)\s*\{([\s\S]*)\}\s*$/m)
  if (!match) {
    // @media / @supports — route to all targets
    const out = new Map()
    for (const t of targets) out.set(t, block)
    return out
  }

  const [, indent, header, body] = match
  const selectors = header
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  /** @type {Map<string, string[]>} */
  const byFile = new Map()
  for (const sel of selectors) {
    const file = classifySelector(sel) ?? 'core'
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(sel)
  }

  const out = new Map()
  for (const [file, sels] of byFile) {
    out.set(file, `${indent}${sels.join(',\n' + indent)} {\n${body}}\n`)
  }
  return out
}

/**
 * Parse file into preamble + layer sections.
 */
function parseLayers(content) {
  const layerRe = /@layer\s+(base|components|utilities)\s*\{/g
  const layers = []
  let preamble = ''
  let lastEnd = 0
  let m
  while ((m = layerRe.exec(content)) !== null) {
    if (layers.length === 0) preamble = content.slice(0, m.index)
    const name = m[1]
    const start = m.index + m[0].length
    let depth = 1
    let i = start
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++
      else if (content[i] === '}') depth--
      i++
    }
    const body = content.slice(start, i - 1)
    layers.push({ name, body, openLine: content.slice(0, m.index) })
    lastEnd = i
  }
  const postamble = content.slice(lastEnd)
  return { preamble, layers, postamble }
}

/**
 * Split layer body into top-level blocks (rules + at-rules).
 * @param {string} body
 */
function splitIntoBlocks(body) {
  const lines = body.split('\n')
  const blocks = []
  let i = 0
  let pendingComment = ''

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      pendingComment = line + '\n'
      i++
      while (i < lines.length && !lines[i].includes('*/')) {
        pendingComment += lines[i] + '\n'
        i++
      }
      if (i < lines.length) {
        pendingComment += lines[i] + '\n'
        i++
      }
      continue
    }

    if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) {
      pendingComment = line + '\n'
      i++
      continue
    }

    // Start of a block
    const start = i
    let block = pendingComment
    pendingComment = ''
    let depth = 0
    let started = false

    while (i < lines.length) {
      const l = lines[i]
      block += (i === start ? '' : '\n') + l
      for (const ch of l) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') depth--
      }
      i++
      if (started && depth === 0) break
    }

    blocks.push(block)
  }

  return blocks
}

/**
 * @param {string} block
 */
function getBlockHeader(block) {
  const idx = block.indexOf('{')
  if (idx === -1) return block.trim()
  return block.slice(0, idx).trim()
}

function main() {
  const content = readFileSync(cssPath, 'utf8')
  const { preamble, layers } = parseLayers(content)

  /** @type {Map<string, { components: string[], utilities: string[] }>} */
  const chunks = new Map()
  const ensure = (file) => {
    if (!chunks.has(file)) chunks.set(file, { base: [], components: [], utilities: [] })
    return chunks.get(file)
  }
  ensure('core')

  for (const layer of layers) {
    const blocks = splitIntoBlocks(layer.body)
    for (const block of blocks) {
      const header = getBlockHeader(block)
      if (header.startsWith('@')) {
        // Keep @keyframes etc in core unless clearly module-specific
        const targets = classifyBlock(header.replace(/@media[^{]*/, ''))
        if (targets.size === 0 || targets.has('core')) {
          ensure('core')[layer.name].push(block)
        } else {
          for (const t of targets) ensure(t)[layer.name].push(block)
        }
        continue
      }

      const targets = classifyBlock(header)
      const split = splitBlock(block, targets)
      for (const [file, b] of split) {
        ensure(file)[layer.name].push(b)
      }
    }
  }

  // Write core index.css
  let coreCss = preamble.trimEnd() + '\n\n'
  const core = chunks.get('core')
  for (const layerName of ['base', 'components', 'utilities']) {
    const layer = layers.find((l) => l.name === layerName)
    if (!layer) continue
    const blocks = core[layerName]
    if (blocks.length === 0 && layerName !== 'base') continue
    if (layerName === 'base') {
      coreCss += `@layer base {\n${blocks.join('\n\n')}\n}\n\n`
    } else if (blocks.length > 0) {
      coreCss += `@layer ${layerName} {\n${blocks.join('\n\n')}\n}\n\n`
    }
  }

  writeFileSync(cssPath, coreCss.trimEnd() + '\n')

  const fileToPage = {
    'MoneyPage.css': 'pages/MoneyPage.tsx',
    'InboxPage.css': 'pages/InboxPage.tsx',
    'CalendarPage.css': 'pages/CalendarPage.tsx',
    'NutritionPage.css': 'pages/NutritionPage.tsx',
    'NotesPage.css': 'pages/NotesPage.tsx',
    'SettingsPage.css': 'pages/SettingsPage.tsx',
    'SetupWizard.css': 'pages/SetupWizard.tsx',
    'CapturePage.css': 'pages/CapturePage.tsx'
  }

  for (const [file, parts] of chunks) {
    if (file === 'core') continue
    let css = ''
    for (const layerName of ['components', 'utilities']) {
      if (parts[layerName].length === 0) continue
      css += `@layer ${layerName} {\n${parts[layerName].join('\n\n')}\n}\n\n`
    }
    if (!css.trim()) continue
    const outPath = path.join(srcDir, file)
    writeFileSync(outPath, css.trimEnd() + '\n')
    console.log(`Wrote ${file}: ${parts.components.length} component blocks, ${parts.utilities.length} utility blocks`)
  }

  // Stats
  const coreSize = Buffer.byteLength(coreCss, 'utf8')
  console.log(`\nCore index.css: ${(coreSize / 1024).toFixed(1)} KB (source)`)
  let extracted = 0
  for (const [file, parts] of chunks) {
    if (file === 'core') continue
    const size = Buffer.byteLength(
      ['components', 'utilities']
        .map((l) => parts[l].join(''))
        .join(''),
      'utf8'
    )
    extracted += size
    console.log(`  ${file}: ${(size / 1024).toFixed(1)} KB`)
  }
  console.log(`Total extracted: ${(extracted / 1024).toFixed(1)} KB`)
  console.log('\nAdd imports to page files:', Object.values(fileToPage).join(', '))
}

main()
