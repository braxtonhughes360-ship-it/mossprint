import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { safeDevLog } from './bootstrap'
import { registerIdleLock } from './idleLock'
import {
  isQuittingApp,
  markQuitting,
  setMainWindow,
  shouldHideMainWindowOnClose
} from './appLifecycle'

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

export function createWindow(): BrowserWindow {
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
