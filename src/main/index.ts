import { app, BrowserWindow, shell } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHealthCheck, closeDatabase, setSetting } from './database'
import {
  activateProfile,
  createProfile,
  initializeProfiles,
  listProfiles,
  lockActiveProfile
} from './profiles'
import { PREFERENCES_STORAGE_KEY, DEFAULT_PREFERENCES } from '@shared/preferences'
import { registerCalendarHandlers } from './ipc/calendar'
import { registerMailHandlers } from './ipc/mail'
import { registerDatabaseHandlers, shutdownDatabase } from './ipc/database'
import { registerProfileHandlers, shutdownProfiles } from './ipc/profiles'
import { registerIdleLock, shutdownIdleLock } from './idleLock'
import { registerMoneyHandlers } from './ipc/money'
import { registerNewsHandlers } from './ipc/news'
import { registerGoalsHandlers } from './ipc/goals'
import { registerNotesHandlers } from './ipc/notes'
import {
  registerNoteAttachmentProtocol,
  registerNoteAttachmentScheme
} from './notesAttachmentProtocol'
import { registerNutritionHandlers } from './ipc/nutrition'
import { registerShellHandlers } from './ipc/shell'
import { registerCaptureHandlers } from './ipc/capture'
import { registerUpdatesHandlers } from './ipc/updates'
import { registerCaptureShortcut, shutdownCaptureWindow, warmCaptureWindow } from './captureWindow'
import { isKeepInMenuBarEnabled, loadAppSettings } from './appSettings'
import { resumeModelDownloadIfAccepted, shutdownLocalRuntime } from './localRuntime'
import {
  getMainWindow,
  isQuittingApp,
  markQuitting,
  registerMainWindowFactory,
  setMainWindow,
  shouldHideMainWindowOnClose,
  trayDeps
} from './appLifecycle'
import { createTray, shutdownTray } from './tray'
import { shutdownUpdater } from './updater'

/** Redirect headless verify runs before app.ready — must run before any getPath('userData'). */
function bootstrapHeadlessUserData(): void {
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

bootstrapHeadlessUserData()

/** Dev-only: stdout/stderr may be closed (EPIPE) when Electron outlives the terminal pipe. */
function safeDevLog(level: 'warn' | 'error', ...args: unknown[]): void {
  try {
    if (level === 'warn') console.warn(...args)
    else console.error(...args)
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String(err.code) : ''
    if (code !== 'EPIPE' && code !== 'ERR_STREAM_DESTROYED') throw err
  }
}

function swallowBrokenPipeOnExit(): void {
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

swallowBrokenPipeOnExit()

function loadEnvFile(): void {
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

loadEnvFile()

/** Closing the window quits MOSS — unless "Keep in menu bar" is on. */

app?.commandLine?.appendSwitch('enable-features', 'Vulkan')

registerNoteAttachmentScheme()

function isDev(): boolean {
  return !app.isPackaged
}

function getContentSecurityPolicy(): string {
  // Vite dev server needs inline scripts + eval for HMR; production stays strict.
  const devScript = isDev() ? " 'unsafe-inline' 'unsafe-eval'" : ''
  // The hero pulls live UV/solar data from open-meteo (renderer fetch); dev additionally
  // needs the Vite HMR sockets. Without an explicit connect-src, production falls back to
  // default-src 'self' and the weather call is blocked.
  // Update checks (R4) deliberately run in the MAIN process (updater.ts), so
  // github.com/api.github.com never need to appear in this renderer CSP.
  const connectSrc = isDev()
    ? "connect-src 'self' https://api.open-meteo.com ws://localhost:* http://localhost:* wss://localhost:*;"
    : "connect-src 'self' https://api.open-meteo.com;"

  return [
    "default-src 'self';",
    `script-src 'self'${devScript};`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
    // data: covers a webfont some deps inline as a data URI; bundled fonts use 'self'.
    "font-src 'self' data: https://fonts.gstatic.com;",
    // moss-attachment: serves note images from the profile directory (main process).
    "img-src 'self' data: https: moss-attachment:;",
    "object-src 'none';",
    "base-uri 'self';",
    // Email bodies render in a sandboxed (no-script) same-origin srcdoc iframe; its own
    // <meta> CSP (default-src 'none') governs what that document may load.
    "frame-src 'self';",
    "frame-ancestors 'none';",
    connectSrc
  ].join(' ')
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#dddcd8',
    title: 'MOSS',
    // Drop the gray OS title bar; the themed shell fills to the top edge.
    // macOS keeps inset traffic lights nudged into the canvas gutter.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 16 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webgl: true
    }
  })

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [getContentSecurityPolicy()]
      }
    })
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (!current || url === current) {
      return
    }

    // In dev, only allow navigation back to the Vite renderer root (a full HMR reload).
    // Allowing *any* localhost URL let a stray navigation replace the app with a served
    // source module rendered as raw text — block those, keep reloads working.
    const devRoot = process.env.ELECTRON_RENDERER_URL
    if (isDev() && devRoot && (url === devRoot || url === `${devRoot}/`)) {
      return
    }

    event.preventDefault()
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('close', (event) => {
    if (shouldHideMainWindowOnClose()) {
      event.preventDefault()
      window.hide()
      return
    }
    if (!isQuittingApp()) {
      markQuitting()
      app.quit()
    }
  })

  if (isDev()) {
    attachDevRendererRecovery(window)
  }

  if (isDev() && process.env.ELECTRON_RENDERER_URL) {
    void loadDevRenderer(window, process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  setMainWindow(window)
  registerIdleLock(window)
  return window
}

const DEV_LOAD_RETRIES = 8
const DEV_LOAD_RETRY_MS = 1500
const DEV_RENDERER_RELOAD_MAX = 4

function devRendererLoadErrorHtml(url: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>MOSS — dev server</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#dddcd8;color:#1a1a1a;text-align:center;padding:2rem}
p{max-width:28rem;line-height:1.5}code{font-size:.9em}</style></head>
<body><div><h1>MOSS could not reach the dev server</h1>
<p>Expected <code>${url}</code>. Quit other <code>npm run dev</code> instances, then run <code>npm run dev</code> again from the repo root.</p></div></body></html>`)}`
}

function attachDevRendererRecovery(window: BrowserWindow): void {
  let reloadAttempts = 0
  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  const reloadRenderer = (): void => {
    if (!rendererUrl || window.isDestroyed()) return
    if (reloadAttempts >= DEV_RENDERER_RELOAD_MAX) {
      safeDevLog('error', 'MOSS: renderer recovery exhausted; reload the app manually.')
      return
    }
    reloadAttempts += 1
    safeDevLog('warn', `MOSS: reloading renderer (attempt ${reloadAttempts}/${DEV_RENDERER_RELOAD_MAX})`)
    void window.loadURL(rendererUrl)
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    safeDevLog('error', 'MOSS: renderer process gone:', details.reason, details.exitCode)
    reloadRenderer()
  })

  window.webContents.on('did-fail-load', (_event, errorCode, _desc, validatedURL) => {
    if (errorCode === -3) return // ERR_ABORTED — navigation superseded
    if (rendererUrl && validatedURL.startsWith(rendererUrl.split('?')[0] ?? rendererUrl)) {
      safeDevLog('error', `MOSS: renderer failed to load (${errorCode})`, validatedURL)
      reloadRenderer()
    }
  })
}

async function loadDevRenderer(window: BrowserWindow, url: string): Promise<void> {
  for (let attempt = 0; attempt < DEV_LOAD_RETRIES; attempt += 1) {
    try {
      await window.loadURL(url)
      return
    } catch {
      if (attempt === DEV_LOAD_RETRIES - 1) {
        safeDevLog('error', `MOSS: failed to load dev renderer at ${url}`)
        if (!window.isDestroyed()) {
          await window.loadURL(devRendererLoadErrorHtml(url))
        }
        return
      }
      await new Promise((resolve) => setTimeout(resolve, DEV_LOAD_RETRY_MS))
    }
  }
}

async function initHeadlessProfile(): Promise<void> {
  // Isolated userData (see headlessProfile.ts) — never wipe or touch real operator profiles.
  initializeProfiles()
  let profileId = listProfiles()[0]?.id
  if (!profileId) {
    profileId = createProfile({ displayName: 'Healthcheck' }).profile.id
  }
  const result = await activateProfile(profileId, undefined, { bypassPassword: true })
  if (!result.ok) {
    throw new Error(result.message ?? 'Failed to open headless profile database')
  }
}

async function runDemoProfilesSeed(): Promise<void> {
  initializeProfiles()
  const existing = listProfiles()
  if (existing.length === 0) {
    const first = createProfile({ displayName: 'You' })
    await activateProfile(first.profile.id, undefined, { bypassPassword: true }).catch(
      () => undefined
    )
    setSetting(PREFERENCES_STORAGE_KEY, JSON.stringify({
      profile: { displayName: 'You' },
      setup: { completedAt: new Date().toISOString(), version: 1 }
    }))
    closeDatabase()
  }

  let profiles = listProfiles()
  if (profiles.length < 2) {
    createProfile({ displayName: 'Roommate', avatarColor: 'ember' })
    profiles = listProfiles()
  }

  const roommate = profiles.find((p) => p.displayName === 'Roommate')
  if (roommate) {
    await activateProfile(roommate.id, undefined, { bypassPassword: true })
    setSetting('demo.profile.marker', 'roommate-data')
    closeDatabase()
  }

  const primary = profiles.find((p) => p.displayName === 'You') ?? profiles[0]!
  await activateProfile(primary.id, undefined, { bypassPassword: true })
  setSetting('demo.profile.marker', 'primary-data')
  closeDatabase()
  lockActiveProfile()

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      profiles: listProfiles().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        databasePath: join(app.getPath('userData'), 'profiles', p.id, 'moss.sqlite')
      }))
    })}\n`
  )
  app.exit(0)
}

async function runHeadlessHealthCheck(): Promise<void> {
  try {
    await initHeadlessProfile()
    const result = runHealthCheck()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    app.exit(1)
  }
}

async function runHeadlessLedgerSmoke(): Promise<void> {
  // Exercises the V2e ledger lifecycle end-to-end through the real SQLCipher
  // stack (create → edit → revert → transfer → reconcile → delete → restore).
  // Wrapped in BEGIN/ROLLBACK so it never leaves residue in the profile DB.
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const db = getDb()

    const checks: Record<string, boolean> = {}
    const rowCount = (id: string): number =>
      (db.prepare('SELECT COUNT(*) AS c FROM ledger_transactions WHERE id = ?').get(id) as {
        c: number
      }).c

    db.exec('BEGIN')
    try {
      const accountA = money.createCashAccount({
        name: 'Smoke A',
        type: 'checking',
        startingBalanceCents: 10_000
      })
      const accountB = money.createCashAccount({
        name: 'Smoke B',
        type: 'savings',
        startingBalanceCents: 0
      })
      const category = money.createCategory({ name: 'Smoke envelope' })
      const occurredAt = new Date().toISOString()

      // create
      const expense = money.createTransaction({
        amountCents: -2000,
        type: 'expense',
        status: 'cleared',
        categoryId: category.id,
        memo: 'Smoke coffee',
        notes: 'first note',
        tags: ['Smoke', 'Coffee'],
        occurredAt,
        accountId: accountA.id
      })
      checks.createType = expense.type === 'expense'
      checks.createTags = expense.tags.includes('smoke') && expense.tags.includes('coffee')
      checks.createAudit = money.getTransactionAudit(expense.id).some((a) => a.action === 'created')

      // edit
      const edited = money.updateTransaction({
        id: expense.id,
        amountCents: -2500,
        type: 'expense',
        status: 'reconciled',
        categoryId: category.id,
        memo: 'Smoke coffee',
        notes: 'second note',
        tags: ['smoke'],
        occurredAt,
        accountId: accountA.id
      })
      checks.editAmount = edited.amountCents === -2500
      checks.editStatus = edited.status === 'reconciled'
      checks.editAudit = money.getTransactionAudit(expense.id).some((a) => a.action === 'edited')

      // revert
      const reverted = money.revertTransaction(expense.id)
      checks.revertAmount = reverted.amountCents === -2000
      checks.revertStatus = reverted.status === 'cleared'
      checks.revertAudit = money.getTransactionAudit(expense.id).some((a) => a.action === 'restored')

      // transfer (two legs)
      const legs = money.createTransfer({
        fromAccountId: accountA.id,
        toAccountId: accountB.id,
        amountCents: 1000,
        occurredAt
      })
      checks.transferLegs = legs.length === 2
      checks.transferType = legs.every((leg) => leg.type === 'transfer')
      checks.transferGrouped =
        legs[0].transferGroupId !== null && legs[0].transferGroupId === legs[1].transferGroupId

      // balances: A = 10000 − 2000 − 1000 = 7000 ; B = 0 + 1000 = 1000
      const balances = money.listCashAccounts()
      const balA = balances.find((a) => a.id === accountA.id)?.balanceCents
      const balB = balances.find((a) => a.id === accountB.id)?.balanceCents
      checks.balanceFrom = balA === 7000
      checks.balanceTo = balB === 1000

      // reconcile math + lock
      money.setTransactionStatus({ id: expense.id, status: 'pending' })
      const recon = money.getReconciliationSummary(accountA.id)
      checks.reconWorking = recon.workingBalanceCents === 7000
      checks.reconClearedExcludesPending = recon.clearedBalanceCents === 9000
      checks.reconPending = recon.pendingCount === 1
      const locked = money.reconcileClearedForAccount(accountA.id)
      checks.reconLockCount = locked.count === 1 // only the cleared transfer leg

      // delete + undo
      const del = money.deleteTransaction(expense.id)
      checks.deleteToken = del.undoToken !== ''
      checks.deleteGone = rowCount(expense.id) === 0
      money.restoreDeletedTransaction(del.undoToken)
      checks.restoreBack = rowCount(expense.id) === 1

      // deleting one transfer leg removes the whole group
      money.deleteTransaction(legs[0].id)
      const groupLeft = (
        db
          .prepare('SELECT COUNT(*) AS c FROM ledger_transactions WHERE transfer_group_id = ?')
          .get(legs[0].transferGroupId) as { c: number }
      ).c
      checks.transferGroupDelete = groupLeft === 0
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)

    const { resolveMerchantChip, normalizePayeeForMatch } = await import('@shared/merchantChip')
    const amazon = resolveMerchantChip('AMZN MKTP US*AB12CD')
    const local = resolveMerchantChip('Corner Cafe')
    const chipChecks = {
      amazonIcon: amazon.iconUrl === '/merchant-icons/amazon.svg',
      amazonMonogram: amazon.monogram === 'AM',
      localMonogram: local.monogram === 'CC',
      localColorStable:
        resolveMerchantChip('Corner Cafe').color === local.color &&
        resolveMerchantChip('corner cafe').color === local.color,
      normalizeNoise: normalizePayeeForMatch('SQ *STARBUCKS #1234').includes('starbucks')
    }
    const chipOk = Object.values(chipChecks).every(Boolean)

    process.stdout.write(`${JSON.stringify({ ok, checks, chipOk, chipChecks })}\n`)
    app.exit(ok && chipOk ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessCreditSmoke(): Promise<void> {
  // Credit-card accounting end-to-end: charge raises debt + hits the envelope (single count);
  // payoff transfer lowers debt + cash and leaves net worth unchanged. BEGIN/ROLLBACK — no residue.
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const { accountOwedCents } = await import('@shared/money')
    const db = getDb()

    const checks: Record<string, boolean> = {}
    // Net worth mirror: sum of all non-archived account balances (as buildNetWorthSeries does).
    const netWorth = (): number =>
      money.listCashAccounts().reduce((sum, a) => (a.archived ? sum : sum + a.balanceCents), 0)
    const balanceOf = (id: string): number =>
      money.listCashAccounts().find((a) => a.id === id)?.balanceCents ?? 0
    const spentOf = (categoryId: string): number =>
      money.getBudgetOverview().categories.find((r) => r.category.id === categoryId)?.spentCents ?? 0

    db.exec('BEGIN')
    try {
      const checking = money.createCashAccount({
        name: 'CC Smoke Checking',
        type: 'checking',
        startingBalanceCents: 100_000
      })
      // A card created with $500 owed is stored as a negative balance.
      const card = money.createCashAccount({
        name: 'CC Smoke Visa',
        type: 'credit',
        startingBalanceCents: -50_000
      })
      const category = money.createCategory({ name: 'CC Smoke envelope' })
      const occurredAt = new Date().toISOString()

      checks.creditTypeAccepted = balanceOf(card.id) === -50_000
      checks.owedHelper = accountOwedCents(balanceOf(card.id)) === 50_000

      const netWorthStart = netWorth() // 100000 + (-50000) = 50000
      checks.netWorthStart = netWorthStart === 50_000

      // Charge $50 on the card, categorized — raises debt AND envelope spent.
      money.createTransaction({
        amountCents: -5_000,
        type: 'expense',
        status: 'cleared',
        categoryId: category.id,
        memo: 'CC Smoke charge',
        occurredAt,
        accountId: card.id
      })
      checks.chargeRaisesOwed = balanceOf(card.id) === -55_000
      checks.chargeHitsEnvelope = spentOf(category.id) === 5_000
      checks.chargeLeavesCash = balanceOf(checking.id) === 100_000
      checks.chargeLowersNetWorth = netWorth() === 45_000 // down by exactly the charge

      // Pay $300 from checking → card. Lowers debt + cash, nets to zero in budget.
      const legs = money.createTransfer({
        fromAccountId: checking.id,
        toAccountId: card.id,
        amountCents: 30_000,
        occurredAt
      })
      checks.payTwoLegs = legs.length === 2
      checks.payNoCategory = legs.every((leg) => leg.categoryId === null)
      checks.payLowersOwed = balanceOf(card.id) === -25_000
      checks.payLowersCash = balanceOf(checking.id) === 70_000
      checks.payNoEnvelopeChange = spentOf(category.id) === 5_000 // payoff must not double-count
      checks.payKeepsNetWorth = netWorth() === 45_000 // paying debt doesn't change net worth
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessFlowSmoke(): Promise<void> {
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const moneyFlow = await import('./moneyFlow')
    const { checkAffordability, computeMonthWrapUp, MONTH_WRAP_MIN_LEFTOVER_CENTS } = await import('@shared/moneyFlow')
    const { currentPeriodKey, dayKeyToIso, dateKey } = await import('@shared/money')
    const db = getDb()

    const checks: Record<string, boolean> = {}

    db.exec('BEGIN')
    try {
      const periodKey = currentPeriodKey()
      const today = dateKey()
      const rent = money.createCategory({ name: 'Rent' })
      const fun = money.createCategory({ name: 'Fun' })
      const receivedAt = dayKeyToIso(today)

      money.createPaycheck({
        label: 'Pay A',
        amountCents: 80_000,
        receivedAt
      })
      money.createPaycheck({
        label: 'Pay B',
        amountCents: 120_000,
        receivedAt
      })
      money.setAssignment({ categoryId: rent.id, periodKey, amountCents: 140_000 })
      money.setAssignment({ categoryId: fun.id, periodKey, amountCents: 20_000 })

      const future = new Date()
      future.setDate(future.getDate() + 7)
      moneyFlow.createExpectedPaycheck({
        label: 'Next shift',
        amountCents: 95_000,
        expectedDate: dateKey(future)
      })

      let guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.variablePay = guidance.irregular.variablePay.detected
      checks.rentCovered = guidance.rentGlance.covered
      checks.hasTimeline = guidance.timeline.length > 0
      checks.overspendListShape =
        !guidance.overspendRisk.atRisk || guidance.overspendRisk.envelopes.every((e) => !!e.categoryId)

      money.createTransaction({
        amountCents: -25_000,
        type: 'expense',
        status: 'cleared',
        categoryId: fun.id,
        memo: 'Smoke fun',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.overspendNamed = guidance.overspendRisk.envelopes.some((e) => e.name === 'Fun')

      // Beta.4 A2 — the hero must tell one story: rent that is only partially
      // funded in-envelope but coverable from unassigned reads as the softer
      // "assign" nudge (never "covered"), the overspend list never names the
      // housing envelope the glance already handles, and a coverable state is
      // never a red month.
      money.createTransaction({
        amountCents: -10_000,
        type: 'expense',
        status: 'cleared',
        categoryId: rent.id,
        memo: 'Smoke rent partial',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.rentAssignNotCovered =
        !guidance.rentGlance.covered && guidance.rentGlance.state === 'assign'
      checks.rentCoveredXorAtRisk = !guidance.overspendRisk.envelopes.some(
        (e) => e.categoryId === rent.id
      )
      checks.coverableIsNotRed = guidance.status !== 'over'

      money.createTransaction({
        amountCents: -5000,
        type: 'expense',
        status: 'pending',
        categoryId: null,
        memo: 'Smoke unfiled',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.driftUnfiled = guidance.drift.items.some((i) => i.label === 'Unfiled spending')
      checks.driftPending = guidance.drift.items.some((i) => i.label === 'Pending')

      const afford = checkAffordability(guidance, 1000)
      checks.affordCheck = typeof afford.affordable === 'boolean'
      checks.forecastWhy = guidance.restOfMonthForecast.why.includes('spend pace')

      const lastDay = new Date(
        Number.parseInt(periodKey.slice(0, 4), 10),
        Number.parseInt(periodKey.slice(5, 7), 10),
        0
      ).getDate()
      const nearEndToday = `${periodKey}-${String(lastDay).padStart(2, '0')}`

      checks.monthWrapNotEligibleMidMonth = !computeMonthWrapUp({
        budget: money.getBudgetOverview(periodKey),
        isCurrentPeriod: true,
        today: `${periodKey}-05`
      }).eligible

      const coffee = money.createCategory({ name: 'Coffee' })
      money.setAssignment({ categoryId: coffee.id, periodKey, amountCents: 2000 })
      const wrapBelowMin = computeMonthWrapUp({
        budget: money.getBudgetOverview(periodKey),
        isCurrentPeriod: true,
        today: nearEndToday
      })
      checks.monthWrapBelowMin =
        wrapBelowMin.discretionaryLeftoverCents < MONTH_WRAP_MIN_LEFTOVER_CENTS &&
        !wrapBelowMin.eligible

      const dining = money.createCategory({ name: 'Dining' })
      money.setAssignment({ categoryId: dining.id, periodKey, amountCents: 50_000 })
      money.createTransaction({
        amountCents: -10_000,
        type: 'expense',
        status: 'cleared',
        categoryId: dining.id,
        memo: 'Smoke dining',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      const wrapHigh = computeMonthWrapUp({
        budget: money.getBudgetOverview(periodKey),
        isCurrentPeriod: true,
        today: nearEndToday
      })
      checks.monthWrapLeftover =
        wrapHigh.discretionaryLeftoverCents >= MONTH_WRAP_MIN_LEFTOVER_CENTS &&
        wrapHigh.suggestedSweepCents === wrapHigh.discretionaryLeftoverCents
      checks.monthWrapEligibleNearEnd = wrapHigh.eligible

      const { computeContributionGuidance } = await import('@shared/moneySavings')
      const pacePulled = computeContributionGuidance({
        savedCents: 0,
        targetCents: 50_000,
        targetDate: null,
        assignedThisPeriodCents: 10_000,
        safeToSaveCents: 5000,
        unassignedCents: 5000
      })
      checks.savingsPaceUsesBalance =
        pacePulled.remainingThisMonthCents === 12_500 && pacePulled.suggestedAssignCents === 5000
      const paceHeld = computeContributionGuidance({
        savedCents: 10_000,
        targetCents: 50_000,
        targetDate: null,
        assignedThisPeriodCents: 10_000,
        safeToSaveCents: 5000,
        unassignedCents: 5000
      })
      checks.savingsPaceHeldPartial =
        paceHeld.remainingThisMonthCents < pacePulled.remainingThisMonthCents

      // Rollover off materializes pile into "to assign" (Option A); turning back on is fresh start.
      const priorMonth = new Date()
      priorMonth.setMonth(priorMonth.getMonth() - 1)
      const priorPeriod = `${priorMonth.getFullYear()}-${String(priorMonth.getMonth() + 1).padStart(2, '0')}`
      const sinking = money.createCategory({ name: 'Insurance', rolloverEnabled: true })
      const priorReceived = dayKeyToIso(`${priorPeriod}-15`)
      money.setAssignment({ categoryId: sinking.id, periodKey: priorPeriod, amountCents: 50_000 })
      money.createTransaction({
        amountCents: -30_000,
        type: 'expense',
        status: 'cleared',
        categoryId: sinking.id,
        memo: 'Prior premium',
        notes: '',
        tags: [],
        occurredAt: priorReceived
      })
      money.setAssignment({ categoryId: sinking.id, periodKey, amountCents: 10_000 })
      let budget = money.getBudgetOverview(periodKey)
      const sinkingRow = budget.categories.find((r) => r.category.id === sinking.id)
      checks.rolloverCarryIn =
        !!sinkingRow && sinkingRow.carryInCents === 20_000 && sinkingRow.remainingCents === 30_000
      const poolBefore = budget.unassignedCents
      money.setCategoryRollover({ categoryId: sinking.id, rolloverEnabled: false })
      budget = money.getBudgetOverview(periodKey)
      const afterOff = budget.categories.find((r) => r.category.id === sinking.id)
      checks.rolloverReleaseToPool = budget.unassignedCents === poolBefore + 20_000
      checks.rolloverReleasedPersisted =
        !!afterOff && afterOff.category.rolloverReleasedCents === 20_000 && afterOff.remainingCents === 10_000
      money.setCategoryRollover({ categoryId: sinking.id, rolloverEnabled: true })
      budget = money.getBudgetOverview(periodKey)
      const afterOn = budget.categories.find((r) => r.category.id === sinking.id)
      checks.rolloverFreshOn =
        !!afterOn &&
        afterOn.remainingCents === 10_000 &&
        afterOn.assignedCents === 10_000 &&
        afterOn.carryInCents === 0 &&
        afterOn.category.rolloverReleasedCents === 20_000

      const fresh = money.createCategory({ name: 'FreshBill', rolloverEnabled: false })
      money.setAssignment({ categoryId: fresh.id, periodKey, amountCents: 14_000 })
      money.setCategoryRollover({ categoryId: fresh.id, rolloverEnabled: true })
      budget = money.getBudgetOverview(periodKey)
      const freshRow = budget.categories.find((r) => r.category.id === fresh.id)
      checks.rolloverEnableKeepsAssign =
        !!freshRow &&
        freshRow.assignedCents === 14_000 &&
        freshRow.remainingCents === 14_000 &&
        freshRow.carryInCents === 0 &&
        freshRow.category.rolloverReleasedCents === 0

      const corrupt = money.createCategory({ name: 'CorruptHeal', rolloverEnabled: true })
      money.setAssignment({ categoryId: corrupt.id, periodKey, amountCents: 14_000 })
      db.prepare('UPDATE budget_categories SET rollover_released_cents = 14_000 WHERE id = ?').run(
        corrupt.id
      )
      // Heal is one-shot per profile (no writes on ordinary budget reads) — re-arm
      // it so this deliberate corruption exercises the heal logic itself.
      db.prepare("DELETE FROM settings WHERE key = 'money_heal_rollover_on_seal_v1'").run()
      budget = money.getBudgetOverview(periodKey)
      const corruptRow = budget.categories.find((r) => r.category.id === corrupt.id)
      checks.rolloverHealOnSeal =
        !!corruptRow &&
        corruptRow.remainingCents === 14_000 &&
        corruptRow.category.rolloverReleasedCents === 0

      const rolloverOver = money.createCategory({ name: 'RolloverOver', rolloverEnabled: true })
      money.setAssignment({ categoryId: rolloverOver.id, periodKey: priorPeriod, amountCents: 10_000 })
      money.setAssignment({ categoryId: rolloverOver.id, periodKey, amountCents: 5_000 })
      money.createTransaction({
        amountCents: -20_000,
        type: 'expense',
        status: 'cleared',
        categoryId: rolloverOver.id,
        memo: 'Over pile',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      budget = money.getBudgetOverview(periodKey)
      const overBefore = budget.categories.find((r) => r.category.id === rolloverOver.id)
      checks.coverOverspendDetectsRollover =
        !!overBefore && overBefore.remainingCents === -5_000 && budget.overspent.some((o) => o.categoryId === rolloverOver.id)
      money.createPaycheck({
        label: 'Cover pool',
        amountCents: 100_000,
        receivedAt
      })
      money.coverOverspending({ categoryId: rolloverOver.id, periodKey, source: 'pool' })
      budget = money.getBudgetOverview(periodKey)
      const overAfter = budget.categories.find((r) => r.category.id === rolloverOver.id)
      checks.coverOverspendRolloverOn = !!overAfter && overAfter.remainingCents >= 0
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessReportsSmoke(): Promise<void> {
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const moneyReports = await import('./moneyReports')
    const { currentPeriodKey, dayKeyToIso, dateKey } = await import('@shared/money')
    const { normalizeMoneyReportsOverview, EMPTY_REPORT_FILTERS } = await import('@shared/moneyReports')
    const db = getDb()

    const checks: Record<string, boolean> = {}

    db.exec('BEGIN')
    try {
      const periodKey = currentPeriodKey()
      const today = dateKey()
      const groceries = money.createCategory({ name: 'Groceries' })
      const rent = money.createCategory({ name: 'Rent' })
      const receivedAt = dayKeyToIso(today)

      money.createPaycheck({ label: 'Pay', amountCents: 200_000, receivedAt })
      money.setAssignment({ categoryId: rent.id, periodKey, amountCents: 120_000 })
      money.setAssignment({ categoryId: groceries.id, periodKey, amountCents: 30_000 })
      money.createTransaction({
        amountCents: -4500,
        type: 'expense',
        status: 'cleared',
        categoryId: groceries.id,
        memo: 'Market',
        notes: '',
        tags: ['food'],
        occurredAt: receivedAt
      })

      const overview = moneyReports.getMoneyReportsOverview(EMPTY_REPORT_FILTERS, periodKey)
      checks.hasData = overview.hasData
      checks.spendingRows = overview.spendingByCategory.length > 0
      checks.cashFlowSeries = overview.cashFlowSeries.length >= 1
      checks.cashFlowAssigned =
        overview.cashFlowSeries.length > 0 &&
        typeof overview.cashFlowSeries[0].assignedCents === 'number'
      checks.envelopeProgress = overview.envelopeProgress.length > 0
      checks.envelopeWeeklySeries =
        overview.envelopeProgress.length > 0 &&
        overview.envelopeProgress[0].weeklySeries.length >= 1
      checks.netWorthSeries = overview.netWorthSeries.length >= 1
      checks.comparisonWhy = overview.comparison.why.length > 0
      // The Budget-trends meta (comparison.current) and the chart point come from the
      // same period — their assigned totals must agree, or the chart lies.
      const lastFlow = overview.cashFlowSeries[overview.cashFlowSeries.length - 1]
      checks.assignedConsistent =
        lastFlow.assignedCents === overview.comparison.current.assignedCents

      const normalized = normalizeMoneyReportsOverview(overview, periodKey)
      checks.normalizeArrays =
        Array.isArray(normalized.spendingByCategory) &&
        Array.isArray(normalized.envelopeProgress) &&
        Array.isArray(normalized.savingsGlance) &&
        Array.isArray(normalized.netWorthSeries)

      const preset = moneyReports.createReportPreset({
        name: 'Smoke preset',
        filters: { ...overview.filters, rangePreset: 'this_month' },
        viewMode: 'chart'
      })
      checks.presetRoundTrip = moneyReports.listReportPresets().some((p) => p.id === preset.id)
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessImportSmoke(): Promise<void> {
  // Exercises the V2f import/export engine end-to-end against real SQLite:
  // parse → guess mapping → preview (ok/error/unmatched) → commit → re-preview
  // (duplicate detection) → full backup. Wrapped in BEGIN/ROLLBACK so nothing
  // persists, matching the reports/ledger smoke pattern.
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const io = await import('./moneyImportExport')
    const { guessMapping, DEFAULT_IMPORT_OPTIONS, detectPreset, applyImportPreset } = await import(
      '@shared/moneyImportExport'
    )
    const db = getDb()

    const checks: Record<string, boolean> = {}

    db.exec('BEGIN')
    try {
      money.createCategory({ name: 'Groceries' })
      money.createCashAccount({ name: 'Checking', type: 'checking' })

      const csv = [
        'Date,Payee,Category,Amount',
        '2026-06-10,Market,Groceries,-45.00',
        '2026-06-11,Paycheck,,1200.00',
        'not-a-date,Broken,,-10.00',
        '2026-06-12,Cafe,Coffee,-5.25'
      ].join('\n')

      const parsed = io.parseCsv(csv)
      checks.parsedHeaders = parsed.headers.length === 4 && parsed.rows.length === 4

      const mapping = guessMapping(parsed.headers)
      checks.guessedMapping = mapping[0] === 'date' && mapping.includes('amount')

      const request = {
        headers: parsed.headers,
        rows: parsed.rows,
        mapping,
        options: { ...DEFAULT_IMPORT_OPTIONS }
      }

      const preview = io.previewImport(request)
      checks.previewOk = preview.okCount === 3 && preview.errorCount === 1
      checks.previewUnmatched = preview.unmatchedCategories.includes('Coffee')

      const commit = io.commitImport(request)
      checks.committed = commit.imported === 3 && commit.skippedErrors === 1

      const preview2 = io.previewImport(request)
      checks.dedupe = preview2.duplicateCount === 3 && preview2.okCount === 0

      const commit2 = io.commitImport(request)
      checks.dedupeSkips = commit2.imported === 0 && commit2.skippedDuplicates === 3

      const backup = io.buildBackup()
      checks.backupTxns = Boolean(backup.tables.ledger_transactions) &&
        backup.tables.ledger_transactions.rows.length >= 3
      checks.backupCategories = Boolean(backup.tables.budget_categories)

      // V2.5a — Chase preset: Description → payee (not Details DEBIT/CREDIT)
      const chaseCsv = [
        'Details,Posting Date,Description,Amount,Type,Balance',
        'DEBIT,06/15/2026,STARBUCKS,-5.75,DEBIT,100.00',
        'DEBIT,06/16/2026,PAYCHECK,1200.00,CREDIT,1300.00'
      ].join('\n')
      const chaseParsed = io.parseCsv(chaseCsv)
      checks.chasePreset = detectPreset(chaseParsed.headers) === 'chase'
      const chaseApplied = applyImportPreset('chase', chaseParsed.headers)
      checks.chaseMapping =
        chaseApplied.mapping.includes('date') &&
        chaseApplied.mapping.includes('payee') &&
        chaseApplied.mapping.includes('amount') &&
        chaseParsed.headers[chaseParsed.headers.indexOf('Details')] !== undefined &&
        chaseApplied.mapping[chaseParsed.headers.indexOf('Details')] === 'ignore'
      const chasePreview = io.previewImport({
        headers: chaseParsed.headers,
        rows: chaseParsed.rows,
        mapping: chaseApplied.mapping,
        options: chaseApplied.options
      })
      checks.chasePayeeNotDebit = chasePreview.rows[0].payee === 'STARBUCKS'
      checks.chaseAmounts =
        chasePreview.okCount === 2 &&
        chasePreview.rows[0].amountCents === -575 &&
        chasePreview.rows[1].amountCents === 120000

      // V2.5a — Capital One debit/credit two-column → signed amount
      const twoColCsv = [
        'Transaction Date,Description,Debit,Credit',
        '06/15/2026,Grocery Store,45.50,',
        '06/16/2026,Pay Deposit,,1200.00'
      ].join('\n')
      const twoColParsed = io.parseCsv(twoColCsv)
      checks.twoColPreset = detectPreset(twoColParsed.headers) === 'capital_one'
      const twoColApplied = applyImportPreset('capital_one', twoColParsed.headers)
      checks.twoColMapping =
        twoColApplied.mapping.includes('outflow') && twoColApplied.mapping.includes('inflow')
      const twoColPreview = io.previewImport({
        headers: twoColParsed.headers,
        rows: twoColParsed.rows,
        mapping: twoColApplied.mapping,
        options: twoColApplied.options
      })
      checks.twoColAmounts =
        twoColPreview.okCount === 2 &&
        twoColPreview.rows[0].amountCents === -4550 &&
        twoColPreview.rows[1].amountCents === 120000
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessNewsOffline(): Promise<void> {
  // Exercises the "offline / unreachable feed" path without touching the network:
  // an unresolvable .invalid host makes fetch throw, hitting the same catch branch
  // as a real offline sync. Asserts (a) already-fetched items stay visible and
  // (b) the source row records last_error.
  await initHeadlessProfile()
  try {
    const { randomUUID } = await import('node:crypto')
    const { getDb } = await import('./database')
    const { addNewsSource, syncNewsSource, listNewsItems, listNewsSources, deleteNewsSource } =
      await import('./news')

    // Idempotent: drop any leftover test source from a prior run before adding.
    const TEST_URL = 'https://offline-test.invalid/feed.xml'
    const stale = listNewsSources().find((s) => s.url === TEST_URL)
    if (stale) deleteNewsSource(stale.id)

    const source = await addNewsSource({ url: TEST_URL })

    // Seed a "last-good" item as if a prior sync had succeeded.
    getDb()
      .prepare(
        `INSERT INTO news_items (
           id, source_id, external_id, title, url, summary, published_at, read_at, created_at
         ) VALUES (@id, @sourceId, 'seed-1', 'Last good headline',
           'https://offline-test.invalid/a', 'cached summary', @ts, NULL, @ts)`
      )
      .run({ id: randomUUID(), sourceId: source.id, ts: new Date().toISOString() })

    const before = listNewsItems().filter((i) => i.sourceId === source.id).length

    let threw = false
    const syncResult = await syncNewsSource(source.id)
    if (syncResult.error) threw = true

    const after = listNewsItems().filter((i) => i.sourceId === source.id).length
    const row = listNewsSources().find((s) => s.id === source.id)
    const lastError = row?.lastError ?? null

    // Clean up so the test never leaves a phantom feed in the profile DB.
    deleteNewsSource(source.id)

    const itemsPreserved = before === 1 && after === 1
    const errorOnRow = Boolean(lastError)
    const ok = threw && itemsPreserved && errorOnRow

    process.stdout.write(
      `${JSON.stringify({ ok, threw, before, after, itemsPreserved, errorOnRow, lastError })}\n`
    )
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

const NEWS_WIDGET_SHOT_SOURCES = [
  {
    url: 'https://shot-seed.invalid/bbc.xml',
    title: 'BBC News',
    category: 'national'
  },
  {
    url: 'https://shot-seed.invalid/local.xml',
    title: 'Seattle Times',
    category: 'local'
  }
] as const

/** Deterministic fake briefing for screenshot runs — never real feed data. */
async function seedShotNewsItems(): Promise<void> {
  const { randomUUID } = await import('node:crypto')
  const { getDb } = await import('./database')
  const { addNewsSource, deleteNewsSource, listNewsSources } = await import('./news')

  for (const seed of NEWS_WIDGET_SHOT_SOURCES) {
    const stale = listNewsSources().find((source) => source.url === seed.url)
    if (stale) deleteNewsSource(stale.id)
  }

  const now = Date.now()
  const fetchedAt = new Date(now - 12 * 60000).toISOString()
  const national = await addNewsSource({ ...NEWS_WIDGET_SHOT_SOURCES[0] })
  const local = await addNewsSource({ ...NEWS_WIDGET_SHOT_SOURCES[1] })

  getDb()
    .prepare('UPDATE news_sources SET last_fetched_at = ? WHERE id IN (?, ?)')
    .run(fetchedAt, national.id, local.id)

  const insertItem = (
    sourceId: string,
    externalId: string,
    title: string,
    summary: string,
    minutesAgo: number,
    imageUrl = ''
  ): void => {
    const publishedAt = new Date(now - minutesAgo * 60000).toISOString()
    getDb()
      .prepare(
        `INSERT INTO news_items (
           id, source_id, external_id, title, url, summary, image_url, published_at, read_at, created_at
         ) VALUES (
           @id, @sourceId, @externalId, @title, @url, @summary, @imageUrl, @publishedAt, NULL, @createdAt
         )`
      )
      .run({
        id: randomUUID(),
        sourceId,
        externalId,
        title,
        url: `https://shot-seed.invalid/${externalId}`,
        summary,
        imageUrl,
        publishedAt,
        createdAt: fetchedAt
      })
  }

  const heroImage =
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80'
  const thumbA =
    'https://images.unsplash.com/photo-1529107386315-d1caf5642164?auto=format&fit=crop&w=240&q=80'
  const thumbB =
    'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=240&q=80'
  const thumbC =
    'https://images.unsplash.com/photo-1514567171-4270ef7985c4?auto=format&fit=crop&w=240&q=80'
  const thumbD =
    'https://images.unsplash.com/photo-1527482790664-8c457e228969?auto=format&fit=crop&w=240&q=80'

  insertItem(
    national.id,
    'lead-1',
    'Global markets rally as inflation cools faster than forecast',
    'Major indexes closed higher after new data showed price growth easing for a third month.',
    8,
    heroImage
  )
  insertItem(
    national.id,
    'top-2',
    'Congress reaches late deal to avert partial shutdown',
    'Leaders agreed to a short-term funding patch with hours to spare before the deadline.',
    45,
    thumbA
  )
  insertItem(
    national.id,
    'top-3',
    'Tech giants outline new safety rules for AI assistants',
    'The voluntary framework focuses on election integrity and medical advice guardrails.',
    90,
    thumbB
  )
  insertItem(
    local.id,
    'local-1',
    'City council approves expanded light-rail funding plan',
    'The vote clears the way for two new stations and faster evening service downtown.',
    30,
    thumbC
  )
  insertItem(
    local.id,
    'local-2',
    'Weekend storm brings heavy rain; flood watches issued',
    'Emergency crews staged sandbags in low-lying neighborhoods ahead of the front.',
    75,
    thumbD
  )
}

async function runHeadlessNewsWidgetShot(): Promise<void> {
  await initHeadlessProfile()
  try {
    await seedShotNewsItems()

    setSetting(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        colorMode: 'light',
        motionIntensity: 'off',
        ambientIntensity: 'off',
        profile: { displayName: 'Alex' },
        setup: { completedAt: new Date().toISOString(), version: 1 },
        modules: {
          ...DEFAULT_PREFERENCES.modules,
          inbox: { enabled: false },
          news: {
            enabled: true,
            maxItems: 9,
            widgetLayout: 'split',
            briefingMode: 'balanced',
            maxPerSource: 2
          }
        }
      })
    )

    const outDir = join(app.getAppPath(), 'agent_docs', 'screenshots')
    mkdirSync(outDir, { recursive: true })

    const captureWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      backgroundColor: '#dddcd8',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webgl: false
      }
    })

    await captureWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })

    await captureWindow.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 20000
        const tick = () => {
          const headline = document.querySelector('.dashboard-news-hero-headline')
          const sync = document.querySelector('.dashboard-news-sync')
          if (
            headline &&
            headline.textContent?.trim() &&
            sync?.textContent?.includes('Updated')
          ) {
            resolve(true)
            return
          }
          if (Date.now() > deadline) {
            reject(new Error('News widget did not render briefing data in time'))
            return
          }
          requestAnimationFrame(tick)
        }
        tick()
      })`,
      true
    )

    await new Promise((resolve) => setTimeout(resolve, 600))

    const writeShot = async (filename: string): Promise<void> => {
      const image = await captureWindow.webContents.capturePage()
      writeFileSync(join(outDir, filename), image.toPNG())
    }

    await writeShot('news-widget-dashboard-light.png')

    await captureWindow.webContents.executeJavaScript(
      `(() => {
        document.documentElement.dataset.colorMode = 'dark'
        document.documentElement.style.colorScheme = 'dark'
      })()`,
      true
    )

    await new Promise((resolve) => setTimeout(resolve, 250))
    await writeShot('news-widget-dashboard-dark.png')

    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy()
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        light: join(outDir, 'news-widget-dashboard-light.png'),
        dark: join(outDir, 'news-widget-dashboard-dark.png')
      })}\n`
    )
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

const README_SHOTS = [
  { route: '/', filename: 'dashboard', readySelector: '.dashboard-news-sync' },
  { route: '/money', filename: 'money', readySelector: '.money-arrival-kicker' },
  { route: '/nutrition', filename: 'nutrition', readySelector: '.nutrition-arrival-kicker' },
  { route: '/calendar', filename: 'calendar', readySelector: '.calendar-view-toggle' },
  // R1: the rebuilt Notes document workspace is the beta.5 headline shot —
  // captured with the pinned note OPEN so the document (not an empty pane)
  // is what the README shows.
  {
    route: '/notes',
    filename: 'notes',
    readySelector: '.notes-layout',
    prepare: `(() => {
      const row = document.querySelector('.notes-row')
      if (row) row.click()
    })()`,
    preparedSelector: '.notes-doc'
  }
] as const

// Extra routes for the full visual audit (MOSS_SHOTS_FULL=1) — every shell surface, both modes.
const AUDIT_ONLY_SHOTS = [
  { route: '/inbox', filename: 'inbox', readySelector: '.moss-arrival-inbox' },
  { route: '/settings', filename: 'settings', readySelector: '.settings-card' }
] as const

/**
 * README screenshots: seed the QA Tester profile into ISOLATED userData,
 * swap live feeds for the deterministic briefing, capture light-mode PNGs
 * of the dashboard + module pages into docs/screenshots/.
 */
async function runHeadlessReadmeShots(): Promise<void> {
  try {
    const { runQaProfileSeed, QA_PROFILE_NAME } = await import('./qaProfileSeed')
    // skipNewsSync: every source is deleted below anyway, and the live fetch
    // (no request timeout) hangs the whole run when offline.
    await runQaProfileSeed({ quitApp: false, force: true, skipNewsSync: true })

    const qa = listProfiles().find((p) => p.displayName === QA_PROFILE_NAME)
    if (!qa) throw new Error('QA Tester profile missing after seed')
    const activated = await activateProfile(qa.id, undefined, { bypassPassword: true })
    if (!activated.ok) {
      throw new Error(activated.message ?? 'Failed to reactivate QA profile')
    }

    // Live feeds are non-deterministic (and may be offline) — replace with the fixed briefing.
    const { listNewsSources, deleteNewsSource } = await import('./news')
    for (const source of listNewsSources()) deleteNewsSource(source.id)
    await seedShotNewsItems()

    const fullAudit = process.env.MOSS_SHOTS_FULL === '1'

    // Motion off (stable frames), friendly persona name — still fake data.
    const writeShotPreferences = (colorMode: 'light' | 'dark'): void => {
      setSetting(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({
          ...DEFAULT_PREFERENCES,
          colorMode,
          motionIntensity: 'off',
          ambientIntensity: 'off',
          profile: { displayName: 'Alex' },
          setup: { completedAt: new Date().toISOString(), version: 1 },
          modules: {
            calendar: { enabled: true },
            money: { enabled: true, investmentsEnabled: true, advancedToolsEnabled: true },
            nutrition: { enabled: true },
            inbox: { enabled: fullAudit },
            notes: { enabled: true },
            news: {
              enabled: true,
              maxItems: 9,
              widgetLayout: 'split',
              briefingMode: 'balanced',
              maxPerSource: 2
            }
          }
        })
      )
    }

    const outDir = fullAudit
      ? join(app.getAppPath(), 'agent_docs', 'screenshots', 'audit')
      : join(app.getAppPath(), 'docs', 'screenshots')
    mkdirSync(outDir, { recursive: true })

    const captureWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: '#dddcd8',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webgl: false
      }
    })

    const waitForSelector = async (selector: string, label: string): Promise<void> => {
      try {
        await captureWindow.webContents.executeJavaScript(
          `new Promise((resolve, reject) => {
            const deadline = Date.now() + 20000
            const tick = () => {
              if (document.querySelector('${selector}')) {
                resolve(true)
                return
              }
              if (Date.now() > deadline) {
                reject(new Error('${label} did not render ${selector} in time'))
                return
              }
              requestAnimationFrame(tick)
            }
            tick()
          })`,
          true
        )
      } catch (waitErr) {
        const debugText = await captureWindow.webContents
          .executeJavaScript(`document.body.innerText.slice(0, 600)`, true)
          .catch(() => '(no body text)')
        const debugShot = await captureWindow.webContents.capturePage()
        writeFileSync(join(outDir, 'readme-debug.png'), debugShot.toPNG())
        process.stderr.write(`Debug body text for ${label}: ${JSON.stringify(debugText)}\n`)
        throw waitErr
      }
    }

    const enterQaProfile = async (): Promise<void> => {
      if (captureWindow.webContents.getURL()) {
        // loadFile with only a hash change is a same-document navigation — the old renderer
        // context (and its already-loaded preferences) would survive. Force a real reload.
        const reloaded = new Promise<void>((resolve) =>
          captureWindow.webContents.once('did-finish-load', () => resolve())
        )
        captureWindow.webContents.reloadIgnoringCache()
        await reloaded
      } else {
        await captureWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })
      }

      // A fresh boot lands on the profile picker — enter the QA profile like a user would.
      await waitForSelector('.moss-profile-tile, .moss-render-root', 'profile picker or shell')
      await captureWindow.webContents.executeJavaScript(
        `(() => {
          const tiles = Array.from(document.querySelectorAll('.moss-profile-tile'))
          if (tiles.length === 0) return false
          const target = tiles.find((tile) => tile.textContent?.includes(${JSON.stringify(QA_PROFILE_NAME)}))
          if (!target) throw new Error('QA Tester profile tile not found')
          target.click()
          return true
        })()`,
        true
      )
    }

    const modes = fullAudit ? (['light', 'dark'] as const) : (['light'] as const)
    const shots = fullAudit ? [...README_SHOTS, ...AUDIT_ONLY_SHOTS] : README_SHOTS

    const written: string[] = []
    for (const mode of modes) {
      writeShotPreferences(mode)
      await enterQaProfile()

      for (const shot of shots) {
        await captureWindow.webContents.executeJavaScript(
          `window.location.hash = '#${shot.route}'`,
          true
        )
        await waitForSelector(shot.readySelector, `route ${shot.route}`)

        // Some shots stage the page first (e.g. Notes opens a document).
        const staged = shot as {
          prepare?: string
          preparedSelector?: string
        }
        if (staged.prepare) {
          await captureWindow.webContents.executeJavaScript(staged.prepare, true)
          if (staged.preparedSelector) {
            await waitForSelector(staged.preparedSelector, `prepared ${shot.route}`)
          }
        }

        // Let data queries, fonts, and images settle before the frame is captured.
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const renderedMode = await captureWindow.webContents.executeJavaScript(
          `document.documentElement.dataset.colorMode`,
          true
        )
        if (renderedMode !== mode) {
          throw new Error(
            `mode mismatch on ${shot.route}: wanted ${mode}, renderer has ${renderedMode}`
          )
        }

        const image = await captureWindow.webContents.capturePage()
        const filePath = join(outDir, `${shot.filename}-${mode}.png`)
        writeFileSync(filePath, image.toPNG())
        written.push(filePath)
      }
    }

    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy()
    }

    process.stdout.write(`${JSON.stringify({ ok: true, written })}\n`)
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

/**
 * QA-09 perf sweep (beta.5 V2): cold start → interactive dashboard, per-route
 * switch times (cold + warm), idle CPU sample, and process memory — against the
 * seeded QA profile so runs compare before/after builds on identical data.
 * Motion/ambient forced off so numbers measure the app, not the (full-tier-only,
 * by-design) ambient canvas.
 */
async function runHeadlessPerfSweep(): Promise<void> {
  const mark = (step: string): void => {
    process.stderr.write(`[perf-sweep] ${step}\n`)
  }
  try {
    mark('seed:start')
    const { runQaProfileSeed, QA_PROFILE_NAME } = await import('./qaProfileSeed')
    // skipNewsSync: perf numbers must not depend on the network being up.
    await runQaProfileSeed({ quitApp: false, force: true, skipNewsSync: true })
    mark('seed:done')

    const qa = listProfiles().find((p) => p.displayName === QA_PROFILE_NAME)
    if (!qa) throw new Error('QA Tester profile missing after seed')
    const activated = await activateProfile(qa.id, undefined, { bypassPassword: true })
    if (!activated.ok) throw new Error(activated.message ?? 'Failed to activate QA profile')
    await seedShotNewsItems()
    mark('profile:active')

    setSetting(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        colorMode: 'dark',
        motionIntensity: 'off',
        ambientIntensity: 'off',
        profile: { displayName: 'Alex' },
        setup: { completedAt: new Date().toISOString(), version: 1 },
        modules: {
          calendar: { enabled: true },
          money: { enabled: true, investmentsEnabled: true, advancedToolsEnabled: true },
          nutrition: { enabled: true },
          inbox: { enabled: true },
          notes: { enabled: true },
          news: { enabled: true }
        }
      })
    )

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: '#dddcd8',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webgl: false
      }
    })
    const wc = win.webContents
    // Surface renderer errors on stderr — "Script failed to execute" alone is undebuggable.
    wc.on('console-message', (_event, level, message) => {
      if (level >= 3) process.stderr.write(`[renderer] ${message}\n`)
    })

    const waitFor = (selector: string, label: string): Promise<unknown> =>
      wc.executeJavaScript(
        `new Promise((resolve, reject) => {
          const deadline = Date.now() + 30000
          const tick = () => {
            if (document.querySelector(${JSON.stringify(selector)})) return resolve(true)
            if (Date.now() > deadline) return reject(new Error(${JSON.stringify(label)} + ' timed out'))
            requestAnimationFrame(tick)
          }
          tick()
        })`,
        true
      )

    const metrics = async (): Promise<Record<string, number>> => {
      const res = (await wc.debugger.sendCommand('Performance.getMetrics')) as {
        metrics: Array<{ name: string; value: number }>
      }
      return Object.fromEntries(res.metrics.map((m) => [m.name, m.value]))
    }

    // Cold start: renderer load → picker → dashboard interactive.
    const t0 = Date.now()
    await win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })
    mark('renderer:loaded')
    // Attach only once a renderer target exists — pre-load, Performance.enable
    // never resolves. getMetrics is cumulative since renderer start, so boot
    // numbers are unaffected by the late enable.
    wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('Performance.enable')
    await waitFor('.moss-profile-tile', 'profile picker')
    const pickerReadyMs = Date.now() - t0
    mark('picker:ready')
    await wc.executeJavaScript(
      `(() => {
        const tiles = Array.from(document.querySelectorAll('.moss-profile-tile'))
        const target = tiles.find((tile) => tile.textContent?.includes(${JSON.stringify(QA_PROFILE_NAME)}))
        if (!target) throw new Error('QA Tester profile tile not found')
        target.click()
      })()`,
      true
    )
    await waitFor('.dashboard-news-sync', 'dashboard')
    const dashboardReadyMs = Date.now() - t0
    mark('dashboard:ready')
    const bootMetrics = await metrics()

    // Seed the ink-gate fixture BEFORE the first /notes visit so the list
    // query's first fetch includes it (global staleTime is 15s — a later
    // bridge-side insert would not surface on remount).
    await wc.executeJavaScript(
      `(async () => {
        const body = Array.from({ length: 220 }, (_, i) => 'Line ' + i + ' — ink perf fixture.').join('\\n')
        await window.moss.notes.createNote({ title: 'Ink perf fixture', body })
        return true
      })()`,
      true
    )

    // Route switches: cold pass then warm pass over every module route.
    const routes = [
      { route: '/money', selector: '.money-arrival-kicker' },
      { route: '/nutrition', selector: '.nutrition-arrival-kicker' },
      { route: '/calendar', selector: '.calendar-view-toggle' },
      { route: '/inbox', selector: '.moss-arrival-inbox' },
      { route: '/notes', selector: '.moss-arrival-notes' },
      { route: '/settings', selector: '.settings-card' },
      { route: '/', selector: '.dashboard-news-sync' }
    ]
    const routeSwitches: Record<string, { coldMs: number; warmMs: number }> = {}
    for (const pass of ['coldMs', 'warmMs'] as const) {
      for (const { route, selector } of routes) {
        const start = Date.now()
        await wc.executeJavaScript(`window.location.hash = '#${route}'`, true)
        await waitFor(selector, `route ${route}`)
        mark(`route:${route} ${pass}`)
        ;(routeSwitches[route] ??= { coldMs: 0, warmMs: 0 })[pass] = Date.now() - start
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }

    // R2 note-ink gate: open Notes, enter Draw on the seeded long document,
    // lay down a heavy multi-stroke session ON the page, and measure (a)
    // per-frame cost while a stroke extends (one real flush — catmull-rom +
    // taper — per frame) and (b) scroll fps with the session live (each
    // scroll repaints the viewport-window canvas under a translate). These
    // numbers decide draw-anywhere vs the framed-sketch degrade path. The ink
    // must also round-trip through autosave — persistence is asserted at the end.
    await wc.executeJavaScript(`window.location.hash = '#/notes'`, true)
    await waitFor('.moss-arrival-notes', 'notes workspace')
    await waitFor('.notes-row', 'notes list rows')
    await wc.executeJavaScript(
      `new Promise((resolve, reject) => {
        // The list may render cached rows before the refetch lands the
        // bridge-created fixture — poll instead of racing it.
        const deadline = Date.now() + 10000
        const tick = () => {
          const rows = Array.from(document.querySelectorAll('.notes-row'))
          const target = rows.find((row) => row.textContent?.includes('Ink perf fixture'))
          if (target) {
            target.click()
            return resolve(true)
          }
          if (Date.now() > deadline) return reject(new Error('Ink perf fixture row timed out'))
          requestAnimationFrame(tick)
        }
        tick()
      })`,
      true
    )
    await waitFor('.notes-doc-scroll', 'note document')
    const noteInkStart = await metrics()
    const noteInk = (await wc.executeJavaScript(
      `(async () => {
        const drawBtn = Array.from(document.querySelectorAll('.notes-editor-toolbar .money-button'))
          .find((b) => b.textContent.trim() === 'Draw')
        if (!drawBtn) throw new Error('Draw button not found')
        drawBtn.click()
        const layer = await new Promise((resolve, reject) => {
          const deadline = Date.now() + 5000
          const tick = () => {
            const el = document.querySelector('.notes-ink-layer[data-pen]')
            if (el) return resolve(el)
            if (Date.now() > deadline) return reject(new Error('ink layer never armed'))
            requestAnimationFrame(tick)
          }
          tick()
        })
        const rect = layer.getBoundingClientRect()
        const pev = (type, x, y, buttons) =>
          new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', pressure: 0.5, isPrimary: true,
            button: 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true
          })
        const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
        const stat = (arr, skip) => {
          const sorted = arr.slice(skip).sort((a, b) => a - b)
          const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
          return {
            frames: sorted.length,
            medianFrameMs: Math.round(at(0.5) * 100) / 100,
            p95FrameMs: Math.round(at(0.95) * 100) / 100,
            framesOver33Ms: sorted.filter((ms) => ms > 33.4).length
          }
        }
        // Draw: 6 strokes, 120 moves each, one move per frame -> a real flush a frame.
        const drawFrames = []
        for (let s = 0; s < 6; s++) {
          const sx = rect.left + 60 + s * 18
          const sy = rect.top + 60
          layer.dispatchEvent(pev('pointerdown', sx, sy, 1))
          let last = performance.now()
          for (let f = 0; f < 120; f++) {
            const t = f / 120
            layer.dispatchEvent(
              pev('pointermove', sx + Math.sin(t * Math.PI * 4) * 180 + t * 30, sy + t * 320, 1)
            )
            await nextFrame()
            const now = performance.now()
            drawFrames.push(now - last)
            last = now
          }
          layer.dispatchEvent(pev('pointerup', rect.left + 60 + s * 18, rect.top + 380, 0))
        }
        // Scroll with the live session: the window canvas repaints per scroll frame.
        const scroller = document.querySelector('.notes-doc-scroll')
        const maxTop = Math.max(1, scroller.scrollHeight - scroller.clientHeight)
        const scrollFrames = []
        let plast = performance.now()
        for (let f = 0; f < 120; f++) {
          scroller.scrollTop = (f % 2 ? 0.66 : 0.33) * maxTop + (f * 7) % 120
          await nextFrame()
          const now = performance.now()
          scrollFrames.push(now - plast)
          plast = now
        }
        // Leave pen mode; autosave (450ms debounce) commits the session.
        const doneBtn = Array.from(document.querySelectorAll('.notes-ink-toolbar .money-button'))
          .find((b) => b.textContent.trim() === 'Done')
        if (doneBtn) doneBtn.click()
        await new Promise((r) => setTimeout(r, 900))
        const rows = await window.moss.notes.listNotes()
        const fixture = rows.find((n) => n.title === 'Ink perf fixture')
        const saved = fixture ? await window.moss.notes.getNote(fixture.id) : null
        return {
          sessionStrokes: 6,
          drawFrames: drawFrames.length,
          draw: stat(drawFrames, 8),
          scroll: stat(scrollFrames, 8),
          inkPersistedStrokes: saved && saved.ink ? saved.ink.strokes.length : 0
        }
      })()`,
      true
    )) as { sessionStrokes: number; drawFrames: number } & Record<string, unknown>
    const noteInkEnd = await metrics()
    const noteInkDelta = (key: string): number => (noteInkEnd[key] ?? 0) - (noteInkStart[key] ?? 0)
    mark('notes:ink-measured')

    // Idle sample on the dashboard (settle first so mount work doesn't pollute it).
    const idleSeconds = Number(process.env.MOSS_PERF_IDLE_SECONDS ?? 15)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const idleStart = await metrics()
    await new Promise((resolve) => setTimeout(resolve, idleSeconds * 1000))
    const idleEnd = await metrics()
    const delta = (key: string): number => (idleEnd[key] ?? 0) - (idleStart[key] ?? 0)

    const appMetrics = app
      .getAppMetrics()
      .map((p) => ({ type: p.type, workingSetMb: p.memory.workingSetSize / 1024 }))

    wc.debugger.detach()
    if (!win.isDestroyed()) win.destroy()

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        coldStart: { pickerReadyMs, dashboardReadyMs },
        boot: {
          scriptDurationSec: bootMetrics.ScriptDuration,
          jsHeapUsedMb: (bootMetrics.JSHeapUsedSize ?? 0) / 1048576,
          nodes: bootMetrics.Nodes
        },
        routeSwitches,
        noteInk: {
          ...noteInk,
          scriptDurationSec: noteInkDelta('ScriptDuration'),
          perDrawFrameScriptMs:
            noteInk.drawFrames > 0
              ? Math.round((noteInkDelta('ScriptDuration') * 1000 * 1000) / noteInk.drawFrames) / 1000
              : 0,
          layoutCount: noteInkDelta('LayoutCount'),
          recalcStyleCount: noteInkDelta('RecalcStyleCount')
        },
        idle: {
          seconds: idleSeconds,
          taskDurationSec: delta('TaskDuration'),
          scriptDurationSec: delta('ScriptDuration'),
          layoutCount: delta('LayoutCount'),
          recalcStyleCount: delta('RecalcStyleCount'),
          jsHeapUsedMb: (idleEnd.JSHeapUsedSize ?? 0) / 1048576,
          nodes: idleEnd.Nodes
        },
        processMemory: appMetrics
      })}\n`
    )
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessCalendarParse(): Promise<void> {
  const { runCalendarParseFixtures } = await import('../shared/calendarEventParse')
  try {
    const result = runCalendarParseFixtures()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessDescribeParse(): Promise<void> {
  const { runDescribeParseFixtures } = await import('./nutritionDescribeParse')
  try {
    const result = runDescribeParseFixtures()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessCaptureRouting(): Promise<void> {
  // sanitizeCaptureIntent resolves envelope guesses and describeMeal reads the
  // food cache — both need an active (isolated) profile database.
  await initHeadlessProfile()
  const { runCaptureRoutingFixtures } = await import('./captureRoutingFixtures')
  try {
    const result = await runCaptureRoutingFixtures()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessDescribeSmoke(): Promise<void> {
  // describeMeal reads the food cache, so a profile DB must be active —
  // since per-profile DBs (V2a) getDb() no longer opens a legacy DB by default.
  await initHeadlessProfile()
  const { describeMeal } = await import('./nutritionDescribe')
  try {
    const cases = [
      '2 slices pepperoni pizza, 1 glass apple juice',
      'one slize of cheese pizza',
      '2 scoops icecream and cone',
      'two scopps of ice cream and cone',
      'scopps of vanilla',
      'one bowl of reeses peanut butter cereal and milk',
      'one bowl of captain crunch cereal and milk',
      'chick fil a chicken sandwich meal',
      'big mac meal large',
      'chipotle bowl'
    ]
    const results: Array<{
      text: string
      items: Array<{ label: string; source: string; kcal: number; assumed?: boolean }>
    }> = []

    for (const text of cases) {
      const result = await describeMeal({
        text,
        dateKey: '2026-06-19',
        mealSlot: 'snack'
      })
      results.push({
        text,
        items: result.items.map((i) => ({
          label: i.label,
          source: i.source,
          kcal: Math.round(i.snapshotKcal),
          ...(i.assumed ? { assumed: true } : {})
        }))
      })
    }

    const ok = results.every((row) => {
      if (row.text.includes('cheese pizza')) {
        return row.items.some(
          (i) =>
            i.source === 'estimate' &&
            i.label.toLowerCase().includes('cheese') &&
            !i.label.toLowerCase().includes('pepperoni')
        )
      }
      if (row.text.includes('pepperoni')) {
        return row.items.some(
          (i) =>
            i.source === 'estimate' &&
            i.label.toLowerCase().includes('pepperoni')
        )
      }
      if (row.text.includes('vanilla')) {
        return row.items.some(
          (i) =>
            i.source === 'estimate' &&
            i.kcal >= 100 &&
            !i.label.toLowerCase().includes('notco')
        )
      }
      if (row.text.includes('icecream') || row.text.includes('ice cream')) {
        const estimates = row.items.filter((i) => i.source === 'estimate')
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        const hasIce = estimates.some((i) => /ice cream/i.test(i.label))
        const noMisleading = row.items.every(
          (i) =>
            !i.label.toLowerCase().includes('notco') &&
            !i.label.toLowerCase().includes('not ice')
        )
        if (row.text.includes(' and ')) {
          return row.items.length >= 2 && hasIce && totalKcal >= 200 && noMisleading
        }
        return estimates.length >= 1 && totalKcal >= 100 && noMisleading
      }
      if (row.text.includes('reeses') && row.text.includes('cereal')) {
        const cereal = row.items.find((i) => /reese|cereal/i.test(i.label))
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          cereal != null &&
          cereal.kcal >= 140 &&
          cereal.kcal <= 220 &&
          totalKcal >= 200 &&
          totalKcal <= 320 &&
          !row.items.some((i) => i.kcal > 400)
        )
      }
      if (row.text.includes('crunch') && row.text.includes('cereal')) {
        const cereal = row.items.find((i) => /crunch|cereal/i.test(i.label))
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          cereal != null &&
          cereal.kcal >= 130 &&
          cereal.kcal <= 220 &&
          totalKcal >= 200 &&
          totalKcal <= 320 &&
          !row.items.some((i) => i.kcal > 400)
        )
      }
      if (row.text.includes('chick fil a') && row.text.includes('meal')) {
        const assumed = row.items.filter((i) => i.assumed)
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          row.items.length >= 3 &&
          assumed.length >= 2 &&
          row.items.some((i) => /sandwich|chick/i.test(i.label) && !i.assumed) &&
          row.items.some((i) => /fries/i.test(i.label)) &&
          row.items.some((i) => /drink|soda|soft/i.test(i.label)) &&
          totalKcal >= 850 &&
          totalKcal <= 1100
        )
      }
      if (row.text.includes('big mac') && row.text.includes('meal')) {
        const assumed = row.items.filter((i) => i.assumed)
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          row.items.length >= 3 &&
          assumed.length >= 2 &&
          row.items.some((i) => /big mac/i.test(i.label) && !i.assumed) &&
          row.items.some((i) => /large fries|fries/i.test(i.label)) &&
          totalKcal >= 1200 &&
          totalKcal <= 1500
        )
      }
      if (row.text === 'chipotle bowl') {
        return (
          row.items.length === 1 &&
          !row.items.some((i) => i.assumed) &&
          row.items.some((i) => /bowl|chipotle/i.test(i.label)) &&
          row.items[0].kcal >= 500
        )
      }
      return row.items.some((i) => i.source !== 'unresolved')
    })

    process.stdout.write(`${JSON.stringify({ ok, results })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

async function runHeadlessEstimateLabels(): Promise<void> {
  const { runEstimateLabelRegressions, runEstimateKcalAnchorRegressions } = await import(
    './nutritionEstimates'
  )
  const labelResult = runEstimateLabelRegressions()
  const kcalResult = runEstimateKcalAnchorRegressions()
  const result = {
    ok: labelResult.ok && kcalResult.ok,
    failures: [...labelResult.failures, ...kcalResult.failures]
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  app.exit(result.ok ? 0 : 1)
}

async function runHeadlessUsdaImport(): Promise<void> {
  await initHeadlessProfile()
  const { downloadAndImportUsdaFoundation } = await import('./nutritionUsdaImport')
  try {
    const result = await downloadAndImportUsdaFoundation()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

app.whenReady().then(() => {
  registerProfileHandlers()
  registerDatabaseHandlers()
  registerMoneyHandlers()
  registerNutritionHandlers()
  registerCalendarHandlers()
  registerMailHandlers()
  registerNewsHandlers()
  registerNotesHandlers()
  registerNoteAttachmentProtocol()
  registerGoalsHandlers()
  registerShellHandlers()
  registerCaptureHandlers()
  registerUpdatesHandlers()

  if (process.env.MOSS_DEMO_PROFILES === '1') {
    void runDemoProfilesSeed()
    return
  }

  if (process.env.MOSS_HEADLESS_HEALTHCHECK === '1') {
    void runHeadlessHealthCheck()
    return
  }

  if (process.env.MOSS_HEADLESS_USDA_IMPORT === '1') {
    void runHeadlessUsdaImport()
    return
  }

  if (process.env.MOSS_HEADLESS_CALENDAR_PARSE === '1') {
    void runHeadlessCalendarParse()
    return
  }

  if (process.env.MOSS_HEADLESS_NEWS_OFFLINE === '1') {
    void runHeadlessNewsOffline()
    return
  }

  if (process.env.MOSS_HEADLESS_LEDGER_SMOKE === '1') {
    void runHeadlessLedgerSmoke()
    return
  }

  if (process.env.MOSS_HEADLESS_FLOW_SMOKE === '1') {
    void runHeadlessFlowSmoke()
    return
  }

  if (process.env.MOSS_HEADLESS_REPORTS_SMOKE === '1') {
    void runHeadlessReportsSmoke()
    return
  }

  if (process.env.MOSS_HEADLESS_IMPORT_SMOKE === '1') {
    void runHeadlessImportSmoke()
    return
  }

  if (process.env.MOSS_HEADLESS_CREDIT_SMOKE === '1') {
    void runHeadlessCreditSmoke()
    return
  }

  if (process.env.MOSS_HEADLESS_SEED === '1') {
    void import('./headlessSeed').then(({ runHeadlessSeed }) => runHeadlessSeed())
    return
  }

  if (process.env.MOSS_QA_SEED === '1') {
    void import('./qaProfileSeed').then(({ runQaProfileSeed }) =>
      runQaProfileSeed({
        quitApp: true,
        force: process.env.MOSS_QA_SEED_FORCE === '1'
      })
    )
    return
  }

  if (process.env.MOSS_HEADLESS_NEWS_WIDGET_SHOT === '1') {
    void runHeadlessNewsWidgetShot()
    return
  }

  if (process.env.MOSS_HEADLESS_README_SHOTS === '1') {
    void runHeadlessReadmeShots()
    return
  }

  if (process.env.MOSS_HEADLESS_QA2_SMOKE === '1') {
    void import('./qa2Smoke').then(({ runHeadlessQa2Smoke }) => runHeadlessQa2Smoke())
    return
  }

  if (process.env.MOSS_HEADLESS_PERF_SWEEP === '1') {
    void runHeadlessPerfSweep()
    return
  }

  if (process.env.MOSS_HEADLESS_DESCRIBE_PARSE === '1') {
    void runHeadlessDescribeParse()
    return
  }

  if (process.env.MOSS_HEADLESS_CAPTURE_ROUTING === '1') {
    void runHeadlessCaptureRouting()
    return
  }

  if (process.env.MOSS_HEADLESS_DESCRIBE === '1') {
    void runHeadlessDescribeSmoke()
    return
  }

  if (process.env.MOSS_HEADLESS_ESTIMATE_LABELS === '1') {
    void runHeadlessEstimateLabels()
    return
  }

  loadAppSettings()
  registerMainWindowFactory(createWindow)

  createWindow()
  registerCaptureShortcut()
  warmCaptureWindow()
  resumeModelDownloadIfAccepted()

  if (isKeepInMenuBarEnabled()) {
    createTray(trayDeps())
  }

  // Launch-time module syncs moved into activateProfile (profiles.ts): no profile
  // database is open at boot, so syncing here always failed silently.

  app.on('activate', () => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.show()
      window.focus()
      return
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  markQuitting()
  shutdownTray()
  shutdownUpdater()
  shutdownCaptureWindow()
  shutdownIdleLock()
  shutdownLocalRuntime()
  shutdownDatabase()
  shutdownProfiles()
})

app.on('window-all-closed', () => {
  if (isKeepInMenuBarEnabled()) {
    return
  }
  app.quit()
})
