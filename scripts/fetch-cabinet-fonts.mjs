#!/usr/bin/env node
/**
 * Download Cabinet Grotesk woff2 files from Fontshare for local bundling.
 *
 * Fontshare's EULA does not permit redistributing the font files, so they are
 * NOT committed to git — this script runs on postinstall to fetch them.
 * It fails soft: if the network is unavailable the app still boots using the
 * system-ui fallback declared in index.css (--font-display / --font-body).
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'src/renderer/public/fonts')

const weights = ['400', '500', '700', '800']
const cssUrl =
  'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,600,700,800&display=swap'

const allPresent = await Promise.all(
  weights.map((w) =>
    access(path.join(outDir, `cabinet-grotesk-${w}.woff2`)).then(
      () => true,
      () => false
    )
  )
).then((results) => results.every(Boolean))

if (allPresent) {
  console.log('Cabinet Grotesk fonts already present — skipping fetch.')
  process.exit(0)
}

try {
  const css = await fetch(cssUrl).then((r) => {
    if (!r.ok) throw new Error(`Fontshare CSS request failed: ${r.status}`)
    return r.text()
  })
  await mkdir(outDir, { recursive: true })

  const blocks = [...css.matchAll(/@font-face\s*\{([^}]+)\}/gs)]
  let written = 0
  for (const [, block] of blocks) {
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1]
    const woff2 = block.match(/url\('(\/\/[^']+woff2)/)?.[1]
    if (!weight || !woff2 || !weights.includes(weight)) continue
    const url = `https:${woff2}`
    const dest = path.join(outDir, `cabinet-grotesk-${weight}.woff2`)
    const buf = Buffer.from(
      await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Font download failed: ${r.status} ${url}`)
        return r.arrayBuffer()
      })
    )
    await writeFile(dest, buf)
    written++
    console.log('wrote', path.relative(root, dest))
  }

  if (written === 0) throw new Error('No font faces parsed from Fontshare CSS')
  console.log('Cabinet Grotesk fonts ready in src/renderer/public/fonts/')
} catch (err) {
  console.warn(
    `[fetch-cabinet-fonts] Could not download Cabinet Grotesk (${err?.message ?? err}).`
  )
  console.warn(
    '[fetch-cabinet-fonts] Skipping — the app will fall back to system fonts.'
  )
  console.warn(
    '[fetch-cabinet-fonts] Re-run later with: npm run fonts:fetch'
  )
  process.exit(0)
}
