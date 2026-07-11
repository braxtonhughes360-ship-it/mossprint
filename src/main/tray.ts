import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTURE_SHORTCUT, toggleCaptureWindow } from './captureWindow'

let tray: Tray | null = null

function trayAssetPath(fileName: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, fileName)
  }
  return join(app.getAppPath(), 'build', fileName)
}

function loadTrayImage(): Electron.NativeImage {
  const isMac = process.platform === 'darwin'
  const fileName = isMac ? 'trayTemplate.png' : 'trayIcon.png'
  const path = trayAssetPath(fileName)

  if (!existsSync(path)) {
    throw new Error(`MOSS tray icon missing at ${path} — run npm run icon:tray`)
  }

  const image = nativeImage.createFromPath(path)
  if (isMac) {
    image.setTemplateImage(true)
  }
  return image
}

function captureMenuLabel(): string {
  return process.platform === 'darwin'
    ? 'Quick capture (⌘⇧M)'
    : 'Quick capture (Ctrl+Shift+M)'
}

function buildContextMenu(deps: TrayDeps): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open MOSS',
      click: () => deps.showMainWindow()
    },
    {
      label: captureMenuLabel(),
      accelerator: CAPTURE_SHORTCUT,
      click: () => toggleCaptureWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => deps.requestQuit()
    }
  ])
}

export interface TrayDeps {
  showMainWindow: () => void
  requestQuit: () => void
}

let trayDeps: TrayDeps | null = null

export function createTray(deps: TrayDeps): void {
  if (tray) return
  trayDeps = deps

  tray = new Tray(loadTrayImage())
  tray.setToolTip('MOSS')
  tray.setContextMenu(buildContextMenu(deps))

  tray.on('click', () => {
    toggleCaptureWindow()
  })
}

export function destroyTray(): void {
  if (!tray) return
  tray.destroy()
  tray = null
}

export function syncTray(enabled: boolean, deps: TrayDeps): void {
  trayDeps = deps
  if (enabled) {
    createTray(deps)
    return
  }
  destroyTray()
}

export function shutdownTray(): void {
  destroyTray()
  trayDeps = null
}

/** Refresh the context menu after deps change (noop if tray absent). */
export function refreshTrayMenu(): void {
  if (!tray || !trayDeps) return
  tray.setContextMenu(buildContextMenu(trayDeps))
}
