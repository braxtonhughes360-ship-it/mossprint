/**
 * LA7 — bundled local runtime: managed llama.cpp sidecar + one-time model download.
 *
 * Privacy contract (SECURITY.md): the sidecar binds 127.0.0.1 on a MOSS-owned
 * port and is killed with the app; the model comes from ONE pinned URL and is
 * checksum-verified before use. Nothing else leaves the machine.
 *
 * RAM contract: llama-server holds the model resident (~2.9GB), so the sidecar
 * starts lazily on first use and stops after an idle window — a cold boot of
 * MOSS costs zero until a smart-parsing surface actually warms up.
 */
import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import type { LocalAiDownloadState, LocalAiRuntimeState } from '@shared/localai'
import { getAppSettings, patchAppSettings } from './appSettings'

/** Pinned model — one URL, one checksum. Bump deliberately, never silently. */
export const BUNDLED_MODEL = {
  /** Tag reported through the existing model plumbing; label formats to "qwen3.5". */
  tag: 'qwen3.5:built-in',
  file: 'Qwen3.5-4B-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
  sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
  totalBytes: 2_740_937_888
} as const

const MODEL_DIR_NAME = 'local-ai'
const MODEL_MARKER_FILE = 'model.json'
const HEALTH_POLL_MS = 250
const START_TIMEOUT_MS = 60_000
/** How long a routing call waits for a cold sidecar before falling back. */
const START_SHORT_BUDGET_MS = 1500
const IDLE_STOP_MS = 10 * 60 * 1000
const KILL_GRACE_MS = 3000
const PROGRESS_BROADCAST_MS = 250

function isHeadless(): boolean {
  return Boolean(process.env.MOSS_HEADLESS_USER_DATA)
}

// --- paths ---------------------------------------------------------------

function runtimeDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'llama-runtime')
  return join(app.getAppPath(), 'build', 'runtime', `${process.platform}-${process.arch}`)
}

function runtimeBinaryPath(): string {
  const binary = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(runtimeDir(), binary)
}

/** True when this install carries the bundled runtime (packaged, or dev after runtime:fetch). */
export function isBundledRuntimeAvailable(): boolean {
  try {
    return existsSync(runtimeBinaryPath())
  } catch {
    return false
  }
}

function modelDir(): string {
  return join(app.getPath('userData'), MODEL_DIR_NAME)
}

function modelPath(): string {
  return join(modelDir(), BUNDLED_MODEL.file)
}

function partialPath(): string {
  return `${modelPath()}.partial`
}

function markerPath(): string {
  return join(modelDir(), MODEL_MARKER_FILE)
}

/**
 * Model ready = file present at the pinned size AND the verification marker
 * matches the pinned checksum. The 2GB hash runs once at download time, not
 * on every boot — the marker records that it passed.
 */
export function isBundledModelReady(): boolean {
  try {
    const stat = statSync(modelPath())
    if (stat.size !== BUNDLED_MODEL.totalBytes) return false
    const marker = JSON.parse(readFileSync(markerPath(), 'utf8')) as { sha256?: string }
    return marker.sha256 === BUNDLED_MODEL.sha256
  } catch {
    return false
  }
}

// --- download ------------------------------------------------------------

let download: {
  state: LocalAiDownloadState
  abort: AbortController | null
} = { state: { status: 'idle', receivedBytes: 0, totalBytes: BUNDLED_MODEL.totalBytes, error: null }, abort: null }

type ProgressListener = (state: LocalAiDownloadState) => void
const progressListeners = new Set<ProgressListener>()

export function onModelDownloadProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

function setDownloadState(next: Partial<LocalAiDownloadState>): void {
  download.state = { ...download.state, ...next }
  progressListeners.forEach((listener) => listener(download.state))
}

function hashExistingPartial(path: string, hash: ReturnType<typeof createHash>): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    let bytes = 0
    stream.on('data', (chunk) => {
      hash.update(chunk)
      bytes += chunk.length
    })
    stream.on('end', () => resolve(bytes))
    stream.on('error', reject)
  })
}

/**
 * Download the pinned model with HTTP-Range resume and a running sha256 that
 * covers the resumed portion too. Verification failure deletes the file —
 * a model that doesn't match the pin never gets served.
 */
export async function startModelDownload(): Promise<void> {
  if (isHeadless()) return
  if (download.state.status === 'downloading' || download.state.status === 'verifying') return
  if (isBundledModelReady()) {
    setDownloadState({ status: 'ready', receivedBytes: BUNDLED_MODEL.totalBytes, error: null })
    return
  }

  mkdirSync(modelDir(), { recursive: true })
  const partial = partialPath()
  const hash = createHash('sha256')
  let received = 0

  try {
    if (existsSync(partial)) {
      // Hash what we already have so the final digest covers the whole file.
      received = await hashExistingPartial(partial, hash)
    }
  } catch {
    rmSync(partial, { force: true })
    received = 0
  }

  const abort = new AbortController()
  download.abort = abort
  setDownloadState({ status: 'downloading', receivedBytes: received, error: null })

  try {
    const headers: Record<string, string> = {}
    if (received > 0) headers.Range = `bytes=${received}-`
    const response = await fetch(BUNDLED_MODEL.url, { headers, signal: abort.signal, redirect: 'follow' })

    if (received > 0 && response.status !== 206) {
      // Server ignored the range — start over rather than corrupt the hash.
      rmSync(partial, { force: true })
      download.abort = null
      setDownloadState({ status: 'idle', receivedBytes: 0 })
      return startModelDownload()
    }
    if (!response.ok || !response.body) {
      throw new Error(`download failed (${response.status})`)
    }

    const writer = createWriteStream(partial, { flags: received > 0 ? 'a' : 'w' })
    let lastBroadcast = 0
    const reader = response.body.getReader()

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          hash.update(value)
          received += value.length
          await new Promise<void>((resolve, reject) => {
            writer.write(value, (err) => (err ? reject(err) : resolve()))
          })
          const now = Date.now()
          if (now - lastBroadcast > PROGRESS_BROADCAST_MS) {
            lastBroadcast = now
            setDownloadState({ receivedBytes: received })
          }
        }
      }
    } finally {
      await new Promise<void>((resolve) => writer.end(() => resolve()))
    }

    setDownloadState({ status: 'verifying', receivedBytes: received })
    const digest = hash.digest('hex')
    if (received !== BUNDLED_MODEL.totalBytes || digest !== BUNDLED_MODEL.sha256) {
      rmSync(partial, { force: true })
      throw new Error('The download did not verify — it was removed. Try again.')
    }

    renameSync(partial, modelPath())
    writeFileSync(
      markerPath(),
      `${JSON.stringify({ file: BUNDLED_MODEL.file, sha256: digest, verifiedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8'
    )
    setDownloadState({ status: 'ready', receivedBytes: received, error: null })
  } catch (err) {
    if (abort.signal.aborted) {
      // Paused, not failed — the partial stays for resume.
      setDownloadState({ status: 'idle' })
    } else {
      const message =
        err instanceof Error && err.message.includes('verify')
          ? err.message
          : 'The download was interrupted. Check your connection and try again — it resumes where it left off.'
      setDownloadState({ status: 'error', error: message })
    }
  } finally {
    download.abort = null
  }
}

export function cancelModelDownload(): void {
  download.abort?.abort()
}

/** Boot: a consented, unfinished download resumes without being asked twice. */
export function resumeModelDownloadIfAccepted(): void {
  if (isHeadless()) return
  if (!isBundledRuntimeAvailable()) return
  if (getAppSettings().localAiModelConsent !== 'accepted') return
  if (isBundledModelReady()) return
  void startModelDownload()
}

/** Consent flow: 'accepted' starts the download; 'later' keeps the card dismissible. */
export function setModelConsent(consent: 'accepted' | 'later'): void {
  patchAppSettings({ localAiModelConsent: consent })
  if (consent === 'accepted') {
    void startModelDownload()
  } else {
    cancelModelDownload()
  }
}

// --- sidecar lifecycle ----------------------------------------------------

let sidecar: { child: ChildProcess; baseUrl: string } | null = null
let starting: Promise<string | null> | null = null
let idleTimer: NodeJS.Timeout | null = null
let stderrTail = ''

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('no port'))
      })
    })
    server.on('error', reject)
  })
}

async function waitForHealthy(baseUrl: string, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(HEALTH_POLL_MS * 2)
      })
      if (response.ok) return true
    } catch {
      // still loading the model
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
  }
  return false
}

function touchSidecarActivity(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    // Nobody has parsed anything in a while — give the ~3GB of RAM back.
    stopSidecar()
  }, IDLE_STOP_MS)
  idleTimer.unref()
}

let quarantineStripped = false

/**
 * macOS: a nested, unsigned, quarantined executable spawned by an unsigned app
 * can be SIGKILLed by Gatekeeper on first launch ("killed: 9"), even after the
 * user approved the app itself. Approving the app usually clears quarantine
 * recursively, and the fetch step ad-hoc signs the binaries — but on writable
 * installs (~/Applications, extracted zips) a nested quarantine flag can linger.
 * Strip it best-effort once before the first spawn. Fails silently on read-only
 * installs, where the approval-recursion already handled it.
 */
function stripQuarantineOnce(): void {
  if (quarantineStripped || process.platform !== 'darwin') return
  quarantineStripped = true
  try {
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', runtimeDir()], {
      stdio: 'ignore',
      timeout: 5000
    })
  } catch {
    // Best-effort — ad-hoc signature + approval-recursion cover the common cases.
  }
}

async function spawnSidecar(): Promise<string | null> {
  const binary = runtimeBinaryPath()
  if (!existsSync(binary) || !isBundledModelReady()) return null

  stripQuarantineOnce()
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(
    binary,
    [
      '-m', modelPath(),
      '--host', '127.0.0.1',
      '--port', String(port),
      '--ctx-size', '4096',
      '--jinja',
      '--no-webui',
      // Qwen3.5 thinks by default; the reasoning burns the whole max_tokens
      // budget and the structured content comes back EMPTY (verified on b9860).
      // This template kwarg disables it; templates without the variable ignore it.
      '--chat-template-kwargs', '{"enable_thinking":false}'
    ],
    {
      cwd: runtimeDir(),
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false
    }
  )
  stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000)
  })
  sidecar = { child, baseUrl }
  child.on('exit', () => {
    if (sidecar?.child === child) sidecar = null
  })

  const healthy = await waitForHealthy(baseUrl, child)
  if (!healthy) {
    if (stderrTail.trim()) {
      console.warn(`[localRuntime] llama-server failed to become healthy:\n${stderrTail.trim()}`)
    }
    child.kill('SIGKILL')
    if (sidecar?.child === child) sidecar = null
    return null
  }
  touchSidecarActivity()
  return baseUrl
}

/**
 * Ensure the sidecar is running and healthy. `budgetMs` caps how long the
 * caller waits: routing calls pass a short budget and fall back deterministically
 * while the model loads; warm-up passes none and waits it out. Concurrent
 * callers share one spawn.
 */
export async function ensureSidecarRunning(budgetMs?: number): Promise<string | null> {
  if (isHeadless()) return null
  if (!isBundledRuntimeAvailable() || !isBundledModelReady()) return null
  if (getAppSettings().localAiModelConsent !== 'accepted') return null

  if (sidecar && sidecar.child.exitCode === null && !starting) {
    touchSidecarActivity()
    return sidecar.baseUrl
  }

  if (!starting) {
    starting = spawnSidecar().finally(() => {
      starting = null
    })
  }

  if (budgetMs === undefined) return starting
  return Promise.race([
    starting,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), budgetMs)
      timer.unref()
    })
  ])
}

/** Short-budget variant for routing paths — never blocks capture on a cold start. */
export function sidecarBaseUrlForRouting(): Promise<string | null> {
  return ensureSidecarRunning(START_SHORT_BUDGET_MS)
}

/** Mark real traffic so the idle-stop window slides. */
export function noteSidecarUse(): void {
  if (sidecar) touchSidecarActivity()
}

export function stopSidecar(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const child = sidecar?.child
  sidecar = null
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const killer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS)
  killer.unref()
}

/** before-quit: SIGTERM now, SIGKILL at process exit if it's still around. */
export function shutdownLocalRuntime(): void {
  cancelModelDownload()
  const child = sidecar?.child
  stopSidecar()
  if (child) {
    process.once('exit', () => {
      if (child.exitCode === null) child.kill('SIGKILL')
    })
  }
}

/** Record the warm honesty-check duration (ms) once; null clears for re-measure. */
export function recordWarmCallMs(ms: number | null): void {
  patchAppSettings({ localAiWarmCallMs: ms })
}

export function getRuntimeStateForPanel(): LocalAiRuntimeState {
  const settings = getAppSettings()
  const ready = isBundledModelReady()
  return {
    bundledAvailable: isBundledRuntimeAvailable(),
    consent: settings.localAiModelConsent,
    download: ready
      ? { status: 'ready', receivedBytes: BUNDLED_MODEL.totalBytes, totalBytes: BUNDLED_MODEL.totalBytes, error: null }
      : download.state,
    source: sidecar && sidecar.child.exitCode === null ? 'bundled' : 'none',
    warmCallMs: settings.localAiWarmCallMs
  }
}
