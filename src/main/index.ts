import { app, BrowserWindow } from 'electron'
import { bootstrapHeadlessUserData, loadEnvFile, swallowBrokenPipeOnExit } from './bootstrap'
import { createWindow } from './mainWindow'
import { registerIpcHandlers } from './ipcRegistry'
import { dispatchHeadlessRun } from './headlessDispatch'
import { registerNoteAttachmentScheme } from './notesAttachmentProtocol'
import { registerCaptureShortcut, shutdownCaptureWindow, warmCaptureWindow } from './captureWindow'
import { isKeepInMenuBarEnabled, loadAppSettings } from './appSettings'
import { resumeModelDownloadIfAccepted, shutdownLocalRuntime } from './localRuntime'
import { getMainWindow, markQuitting, registerMainWindowFactory, trayDeps } from './appLifecycle'
import { createTray, shutdownTray } from './tray'
import { shutdownUpdater } from './updater'
import { shutdownIdleLock } from './idleLock'
import { shutdownDatabase } from './ipc/database'
import { shutdownProfiles } from './ipc/profiles'

bootstrapHeadlessUserData()
swallowBrokenPipeOnExit()
loadEnvFile()

/** Closing the window quits MOSS — unless "Keep in menu bar" is on. */

app?.commandLine?.appendSwitch('enable-features', 'Vulkan')

registerNoteAttachmentScheme()

app.whenReady().then(() => {
  registerIpcHandlers()

  if (dispatchHeadlessRun()) {
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
