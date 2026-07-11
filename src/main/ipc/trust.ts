import type { WebContents } from 'electron'

/**
 * Single source of truth for IPC sender validation (SPEC §3.1 — validate IPC senders).
 * Trusts only the packaged renderer (file://) and the Vite dev server (localhost).
 * Accepts both invoke events and plain `ipcMain.on` events (e.g. profiles:activity).
 */
export function isTrustedSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
): boolean {
  const sender = event.sender as WebContents
  const url = sender.getURL()

  if (!url) {
    return false
  }

  return (
    url.startsWith('file://') ||
    url.startsWith('http://localhost:') ||
    url.startsWith('https://localhost:')
  )
}

export function assertTrustedSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
): void {
  if (!isTrustedSender(event)) {
    throw new Error('Untrusted IPC sender')
  }
}

export function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

export function assertInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
}
