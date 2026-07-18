import { ipcMain, powerMonitor, type BrowserWindow } from 'electron'
import { getActiveProfileState, lockActiveProfile } from './profiles'
import { isTrustedSender } from './ipc/trust'
import { createPowerLockBinding } from './powerLock'

const IDLE_CHANNEL = 'profiles:activity'
const LOCKED_CHANNEL = 'profiles:idle-locked'

/** Lock the active profile after sustained inactivity (default 15 minutes). */
const IDLE_MS = 15 * 60 * 1000

let idleTimer: ReturnType<typeof setTimeout> | null = null
let boundWindow: BrowserWindow | null = null
let detachPowerLock: (() => void) | null = null

function notifyLocked(): void {
  if (boundWindow && !boundWindow.isDestroyed()) {
    boundWindow.webContents.send(LOCKED_CHANNEL)
  }
}

function isPasswordProfileActive(): boolean {
  // Idle/exit locks exist to protect a password; a password-less profile has
  // nothing to lock behind, and bouncing a glanceable dashboard to the picker
  // is hostile.
  const active = getActiveProfileState()
  return Boolean(active?.profile.passwordEnabled)
}

function scheduleIdleLock(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (!isPasswordProfileActive()) return
    lockActiveProfile()
    notifyLocked()
  }, IDLE_MS)
}

export function registerIdleLock(window: BrowserWindow): void {
  boundWindow = window
  ipcMain.removeAllListeners(IDLE_CHANNEL)
  ipcMain.on(IDLE_CHANNEL, (event) => {
    // H1(a): same sender discipline as every invoke handler — an untrusted
    // ping must not keep a profile unlocked. Ignore rather than throw: this
    // is a fire-and-forget channel with no reply to reject.
    if (!isTrustedSender(event)) return
    scheduleIdleLock()
  })
  scheduleIdleLock()

  // H1(b): the machine leaving the user's control locks immediately —
  // 'suspend' and 'lock-screen' only, never display-sleep (see powerLock.ts).
  detachPowerLock?.()
  detachPowerLock = createPowerLockBinding({
    isPasswordProfileActive,
    lock: lockActiveProfile,
    notify: notifyLocked
  }).attach(powerMonitor)
}

export function resetIdleLockOnActivate(): void {
  scheduleIdleLock()
}

export function shutdownIdleLock(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  ipcMain.removeAllListeners(IDLE_CHANNEL)
  detachPowerLock?.()
  detachPowerLock = null
  boundWindow = null
}

export { LOCKED_CHANNEL }
