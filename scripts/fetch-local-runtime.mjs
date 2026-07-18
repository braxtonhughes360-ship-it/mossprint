#!/usr/bin/env node
/**
 * LA7 — fetch the bundled llama.cpp `llama-server` runtime for packaging.
 *
 * Downloads a PINNED llama.cpp release binary (MIT) per platform/arch, verifies
 * its sha256, and lays `llama-server` + its shared libraries flat into
 * build/runtime/<platform>-<arch>/ where electron-builder's extraResources and
 * src/main/localRuntime.ts both expect them.
 *
 * The ~2GB model is NOT fetched here — it downloads on first run with consent
 * (see localRuntime.ts). Only the small (~11-17MB) engine binary is bundled.
 *
 * Usage:
 *   node scripts/fetch-local-runtime.mjs                 # current platform+arch
 *   node scripts/fetch-local-runtime.mjs --target=linux-x64
 *   node scripts/fetch-local-runtime.mjs --all           # every known target
 *
 * Fail-soft: a network error leaves an empty target dir (the app degrades to
 * heuristic/help parsing) so a build never breaks on a flaky download. A
 * checksum MISMATCH is fatal — we never bundle an unverified binary.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(root, 'build', 'runtime')

/** Pinned llama.cpp release — bump tag + sha256 together, never silently. */
const RELEASE = 'b9860'
const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${RELEASE}`

const TARGETS = {
  'darwin-arm64': {
    asset: `llama-${RELEASE}-bin-macos-arm64.tar.gz`,
    sha256: '35a2e8c3528adc71db5044e7ad7de8d8b96a4221e737958915e31538a005f1d9'
  },
  'darwin-x64': {
    asset: `llama-${RELEASE}-bin-macos-x64.tar.gz`,
    sha256: 'd442123d5441c82b23b412a58d91e149f60723adfc20a7cc9df04a3908cb5113'
  },
  'linux-x64': {
    asset: `llama-${RELEASE}-bin-ubuntu-x64.tar.gz`,
    sha256: 'b68e8072eb88d1cc8b8e9d6ea8237aae87b34c6d8bbffda958c870e4dc949714'
  },
  'linux-arm64': {
    asset: `llama-${RELEASE}-bin-ubuntu-arm64.tar.gz`,
    sha256: '9f5a4ba0093351a35f1de23eb12b7bc1e96c3a91c62639bdc54e8e8de63a5b1f'
  },
  'win32-x64': {
    asset: `llama-${RELEASE}-bin-win-cpu-x64.zip`,
    sha256: 'd33871623713345cd90b54e516ebada79039cab636e51b22c8c9feae72567837'
  }
}

const SERVER_NAMES = new Set(['llama-server', 'llama-server.exe'])
const LIB_PATTERN = /\.(dylib|so|dll)(\.[0-9.]+)?$/i

function parseTargets() {
  const args = process.argv.slice(2)
  if (args.includes('--all')) return Object.keys(TARGETS)
  const explicit = args.find((a) => a.startsWith('--target='))
  if (explicit) return [explicit.slice('--target='.length)]
  return [`${process.platform}-${process.arch}`]
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`)
  const chunks = []
  const hash = createHash('sha256')
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    chunks.push(Buffer.from(value))
  }
  writeFileSync(dest, Buffer.concat(chunks))
  return hash.digest('hex')
}

function extract(archive, into) {
  const isZip = archive.endsWith('.zip')
  // bsdtar (macOS/Windows) reads zip; GNU tar (Linux) does not — fall back to unzip.
  const attempts = isZip
    ? [
        ['tar', ['-xf', archive, '-C', into]],
        ['unzip', ['-q', '-o', archive, '-d', into]]
      ]
    : [['tar', ['-xzf', archive, '-C', into]]]
  let lastErr = ''
  for (const [cmd, cmdArgs] of attempts) {
    const result = spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    if (result.status === 0) return
    lastErr = result.stderr?.toString() ?? result.error?.message ?? `${cmd} exited ${result.status}`
  }
  throw new Error(`extraction failed: ${lastErr}`)
}

/** Recursively locate the server binary anywhere in the extracted tree. */
function findServer(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findServer(full)
      if (found) return found
    } else if (SERVER_NAMES.has(entry.name)) {
      return full
    }
  }
  return null
}

/**
 * Ad-hoc codesign the macOS Mach-O objects (dylibs first, then the server) so
 * AMFI will execute them and so real Developer ID signing at 1.0 has a clean,
 * already-signed base. Ad-hoc signatures are embedded in the Mach-O, so they
 * survive electron-builder's verbatim extraResources copy. Best-effort: a
 * missing `codesign` (non-Mac fetch) just skips this.
 */
function adhocSignMacRuntime(dir, serverName) {
  const entries = readdirSync(dir).filter((name) => !lstatSync(path.join(dir, name)).isSymbolicLink())
  const libs = entries.filter((name) => /\.dylib$/.test(name))
  const order = [...libs, ...(entries.includes(serverName) ? [serverName] : [])]
  let signed = 0
  for (const name of order) {
    const result = spawnSync(
      'codesign',
      ['--force', '--sign', '-', '--timestamp=none', path.join(dir, name)],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    if (result.status === 0) signed++
    else if (result.error) {
      console.warn('[fetch-local-runtime] codesign unavailable — skipping ad-hoc signing.')
      return
    }
  }
  console.log(`[fetch-local-runtime]   ad-hoc signed ${signed} Mach-O objects.`)
}

async function fetchTarget(target) {
  const spec = TARGETS[target]
  const outDir = path.join(runtimeRoot, target)
  // Always (re)create the dir so extraResources macros never hit a missing path.
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  if (!spec) {
    console.warn(`[fetch-local-runtime] Unknown target ${target} — leaving it empty.`)
    return
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'moss-runtime-'))
  try {
    const archivePath = path.join(tmp, spec.asset)
    console.log(`[fetch-local-runtime] ${target}: downloading ${spec.asset}…`)
    const digest = await download(`${BASE}/${spec.asset}`, archivePath)
    if (digest !== spec.sha256) {
      throw new Error(
        `checksum mismatch for ${spec.asset}\n  expected ${spec.sha256}\n  got      ${digest}`
      )
    }

    const extractDir = path.join(tmp, 'x')
    mkdirSync(extractDir, { recursive: true })
    extract(archivePath, extractDir)

    const server = findServer(extractDir)
    if (!server) throw new Error(`no llama-server binary inside ${spec.asset}`)

    const binDir = path.dirname(server)
    let copied = 0
    for (const entry of readdirSync(binDir, { withFileTypes: true })) {
      // Keep symlinks too — the versioned dylib/.so chain (libX.dylib →
      // libX.0.dylib → libX.0.15.3.dylib) is what the loader follows at runtime.
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      if (SERVER_NAMES.has(entry.name) || LIB_PATTERN.test(entry.name)) {
        cpSync(path.join(binDir, entry.name), path.join(outDir, entry.name), {
          dereference: false,
          verbatimSymlinks: true
        })
        copied++
      }
    }
    const serverOut = path.join(outDir, path.basename(server))
    if (!process.platform.startsWith('win') && existsSync(serverOut)) {
      spawnSync('chmod', ['+x', serverOut])
    }
    if (target.startsWith('darwin') && process.platform === 'darwin') {
      adhocSignMacRuntime(outDir, path.basename(server))
    }
    const sizeMb = (
      readdirSync(outDir).reduce((sum, f) => sum + statSync(path.join(outDir, f)).size, 0) /
      1_048_576
    ).toFixed(1)
    console.log(`[fetch-local-runtime] ${target}: ${copied} files, ${sizeMb}MB → ${path.relative(root, outDir)}`)
  } catch (err) {
    const message = err?.message ?? String(err)
    if (message.includes('checksum mismatch')) {
      console.error(`[fetch-local-runtime] FATAL: ${message}`)
      process.exit(1)
    }
    console.warn(`[fetch-local-runtime] ${target}: ${message}`)
    console.warn(`[fetch-local-runtime] ${target}: leaving empty — app falls back to heuristic parsing.`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

mkdirSync(runtimeRoot, { recursive: true })

// Every known target dir must exist so electron-builder's
// extraResources "${platform}-${arch}" macro never points at a missing path.
// Unfetched arches stay empty → that arch's build ships without the runtime and
// the app degrades to heuristic/help parsing (never broken).
for (const target of Object.keys(TARGETS)) {
  const dir = path.join(runtimeRoot, target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

for (const target of parseTargets()) {
  await fetchTarget(target)
}
