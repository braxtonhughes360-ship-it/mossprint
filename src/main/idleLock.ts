import { ipcMain, type BrowserWindow } from 'electron'
import { getActiveProfileState, lockActiveProfile } from './profiles'

const IDLE_CHANNEL = 'profiles:activity'
const LOCKED_CHANNEL = 'profiles:idle-locked'

/** Lock the active profile after sustained inactivity (default 15 minutes). */
const IDLE_MS = 15 * 60 * 1000

let idleTimer: ReturnType<typeof setTimeout> | null = null
let boundWindow: BrowserWindow | null = null

function notifyLocked(): void {
  if (boundWindow && !boundWindow.isDestroyed()) {
    boundWindow.webContents.send(LOCKED_CHANNEL)
  }
}

function scheduleIdleLock(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    // Idle lock exists to protect a password; a password-less profile has nothing
    // to lock behind, and bouncing a glanceable dashboard to the picker is hostile.
    const active = getActiveProfileState()
    if (!active || !active.profile.passwordEnabled) return
    lockActiveProfile()
    notifyLocked()
  }, IDLE_MS)
}

export function registerIdleLock(window: BrowserWindow): void {
  boundWindow = window
  ipcMain.removeAllListeners(IDLE_CHANNEL)
  ipcMain.on(IDLE_CHANNEL, () => {
    scheduleIdleLock()
  })
  scheduleIdleLock()
}

export function resetIdleLockOnActivate(): void {
  scheduleIdleLock()
}

export function shutdownIdleLock(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  ipcMain.removeAllListeners(IDLE_CHANNEL)
  boundWindow = null
}

export { LOCKED_CHANNEL }
