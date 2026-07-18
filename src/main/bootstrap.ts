import { app } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Redirect headless verify runs before app.ready — must run before any getPath('userData'). */
export function bootstrapHeadlessUserData(): void {
  const headless =
    process.env.MOSS_HEADLESS_HEALTHCHECK === '1' ||
    process.env.MOSS_HEADLESS_LEDGER_SMOKE === '1' ||
    process.env.MOSS_HEADLESS_FLOW_SMOKE === '1' ||
    process.env.MOSS_HEADLESS_REPORTS_SMOKE === '1' ||
    process.env.MOSS_HEADLESS_IMPORT_SMOKE === '1' ||
    process.env.MOSS_HEADLESS_CREDIT_SMOKE === '1' ||
    process.env.MOSS_HEADLESS_USDA_IMPORT === '1' ||
    process.env.MOSS_HEADLESS_CALENDAR_PARSE === '1' ||
    process.env.MOSS_HEADLESS_NEWS_OFFLINE === '1' ||
    process.env.MOSS_HEADLESS_NEWS_WIDGET_SHOT === '1' ||
    process.env.MOSS_HEADLESS_README_SHOTS === '1' ||
    process.env.MOSS_HEADLESS_PERF_SWEEP === '1' ||
    process.env.MOSS_HEADLESS_DESCRIBE_PARSE === '1' ||
    process.env.MOSS_HEADLESS_CAPTURE_ROUTING === '1' ||
    process.env.MOSS_HEADLESS_DESCRIBE === '1' ||
    process.env.MOSS_HEADLESS_ESTIMATE_LABELS === '1' ||
    process.env.MOSS_HEADLESS_SEED === '1' ||
    Boolean(process.env.MOSS_HEADLESS_USER_DATA)

  if (!headless) return

  let base = process.env.MOSS_HEADLESS_USER_DATA
  if (!base) {
    base = mkdtempSync(join(tmpdir(), 'moss-headless-'))
    process.env.MOSS_HEADLESS_USER_DATA = base
  }
  mkdirSync(base, { recursive: true })
  app.setPath('userData', base)
}

/** Dev-only: stdout/stderr may be closed (EPIPE) when Electron outlives the terminal pipe. */
export function safeDevLog(level: 'warn' | 'error', ...args: unknown[]): void {
  try {
    if (level === 'warn') console.warn(...args)
    else console.error(...args)
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String(err.code) : ''
    if (code !== 'EPIPE' && code !== 'ERR_STREAM_DESTROYED') throw err
  }
}

export function swallowBrokenPipeOnExit(): void {
  process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return
  })
  process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return
  })
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return
    safeDevLog('error', err)
    process.exit(1)
  })
}

export function loadEnvFile(): void {
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) {
    return
  }

  try {
    const text = readFileSync(envPath, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const eq = trimmed.indexOf('=')
      if (eq <= 0) {
        continue
      }
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // ignore missing .env
  }
}
