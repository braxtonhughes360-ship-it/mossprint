import { safeStorage } from 'electron'
import { getSetting, setSetting } from './database'

/**
 * OAuth tokens for mail accounts live in the OS keychain via Electron safeStorage — never as
 * plain text in SQLite (SPEC §3.2). Only the base64 of the encrypted blob is parked in settings,
 * keyed by account id.
 */

const TOKEN_KEY_PREFIX = 'mail:gmail:token:'
const PASSWORD_KEY_PREFIX = 'mail:imap:password:'

export function storeMailToken(accountId: string, token: Record<string, unknown>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this device')
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(token))
  setSetting(`${TOKEN_KEY_PREFIX}${accountId}`, encrypted.toString('base64'))
}

export function readMailToken(accountId: string): Record<string, unknown> | null {
  const record = getSetting(`${TOKEN_KEY_PREFIX}${accountId}`)
  if (!record?.value) {
    return null
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }

  try {
    const decrypted = safeStorage.decryptString(Buffer.from(record.value, 'base64'))
    return JSON.parse(decrypted) as Record<string, unknown>
  } catch {
    return null
  }
}

export function deleteMailToken(accountId: string): void {
  setSetting(`${TOKEN_KEY_PREFIX}${accountId}`, '')
}

export function hasMailToken(accountId: string): boolean {
  return Boolean(getSetting(`${TOKEN_KEY_PREFIX}${accountId}`)?.value)
}

/** IMAP/SMTP app password — same keychain-only discipline as OAuth tokens. */
export function storeMailPassword(accountId: string, password: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this device')
  }
  const encrypted = safeStorage.encryptString(password)
  setSetting(`${PASSWORD_KEY_PREFIX}${accountId}`, encrypted.toString('base64'))
}

export function readMailPassword(accountId: string): string | null {
  const record = getSetting(`${PASSWORD_KEY_PREFIX}${accountId}`)
  if (!record?.value || !safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    return safeStorage.decryptString(Buffer.from(record.value, 'base64'))
  } catch {
    return null
  }
}

export function deleteMailPassword(accountId: string): void {
  setSetting(`${PASSWORD_KEY_PREFIX}${accountId}`, '')
}
