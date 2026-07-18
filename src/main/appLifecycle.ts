import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { MossAppSettings } from '@shared/appSettings'
import { isKeepInMenuBarEnabled, patchAppSettings } from './appSettings'
import { syncTray } from './tray'

let mainWindow: BrowserWindow | null = null
let createMainWindow: (() => BrowserWindow) | null = null

export function registerMainWindowFactory(factory: () => BrowserWindow): void {
  createMainWindow = factory
}
let isQuitting = false

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function isQuittingApp(): boolean {
  return isQuitting
}

export function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }
  if (!createMainWindow) {
    throw new Error('Main window factory not registered')
  }
  createMainWindow()
}

export function requestAppQuit(): void {
  if (!isQuitting) {
    isQuitting = true
    app.quit()
  }
}

export function markQuitting(): void {
  isQuitting = true
}

export function shouldHideMainWindowOnClose(): boolean {
  return !isQuitting && isKeepInMenuBarEnabled()
}

export function applyKeepInMenuBarSetting(enabled: boolean): MossAppSettings {
  const next = patchAppSettings({ keepInMenuBar: enabled })
  syncTray(next.keepInMenuBar, {
    showMainWindow,
    requestQuit: requestAppQuit
  })
  return next
}

export function trayDeps(): {
  showMainWindow: () => void
  requestQuit: () => void
} {
  return {
    showMainWindow,
    requestQuit: requestAppQuit
  }
}
