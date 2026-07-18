import { BrowserWindow, globalShortcut } from 'electron'
import { join } from 'node:path'
import { CAPTURE_SHOWN_EVENT } from '@shared/ipc'
import { warmCaptureIntentLlm } from './captureIntentLlm'

export const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+M'

const CAPTURE_WIDTH = 560
const CAPTURE_HEIGHT = 152

let captureWindow: BrowserWindow | null = null
let warmTimer: ReturnType<typeof setTimeout> | null = null
let shuttingDown = false

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'MOSS Capture',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  // Capture should pop over whatever the user is doing, on any desktop/space.
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // One input, no links — any navigation attempt is a bug or an attack.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })

  window.on('blur', () => {
    if (!window.isDestroyed() && window.isVisible()) {
      window.hide()
    }
  })

  if (isDev() && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/capture`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/capture' })
  }

  window.on('closed', () => {
    if (captureWindow === window) {
      captureWindow = null
    }
  })

  return window
}

function showCaptureWindow(window: BrowserWindow): void {
  // The pre-warmed window caches renderer state from before unlock, and
  // visibilitychange is unreliable in hidden transparent windows — ping the
  // page on every show so it re-syncs lock state (QA2-07).
  window.webContents.send(CAPTURE_SHOWN_EVENT)
  window.show()
  window.focus()
  warmCaptureIntentLlm()
}

export function toggleCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    if (captureWindow.isVisible()) {
      captureWindow.hide()
    } else {
      showCaptureWindow(captureWindow)
    }
    return
  }

  captureWindow = createCaptureWindow()
  captureWindow.once('ready-to-show', () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      showCaptureWindow(captureWindow)
    }
  })
}

/**
 * Pre-create the hidden capture window shortly after launch so the first
 * Cmd/Ctrl+Shift+M shows instantly instead of paying BrowserWindow creation
 * + renderer load on the hot path. Delayed a beat so it never competes with
 * the main window's first paint.
 */
export function warmCaptureWindow(delayMs = 3000): void {
  warmTimer = setTimeout(() => {
    warmTimer = null
    if (!shuttingDown && (!captureWindow || captureWindow.isDestroyed())) {
      captureWindow = createCaptureWindow()
    }
  }, delayMs)
}

export function hideCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible()) {
    captureWindow.hide()
  }
}

export function registerCaptureShortcut(): void {
  const registered = globalShortcut.register(CAPTURE_SHORTCUT, toggleCaptureWindow)
  if (!registered) {
    console.warn(`MOSS: could not register global shortcut ${CAPTURE_SHORTCUT} (already in use?)`)
  }
}

export function shutdownCaptureWindow(): void {
  shuttingDown = true
  if (warmTimer) {
    clearTimeout(warmTimer)
    warmTimer = null
  }
  globalShortcut.unregister(CAPTURE_SHORTCUT)
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.destroy()
  }
  captureWindow = null
}
