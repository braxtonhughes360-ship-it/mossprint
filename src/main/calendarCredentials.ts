import { safeStorage } from 'electron'
import { getSetting, setSetting } from './database'

// The Google client id/secret are the same household app for Calendar + Gmail, so the config
// helpers now live in googleOAuth.ts. Re-exported here to keep calendarGoogle.ts imports stable.
export {
  getGoogleOAuthClientConfig,
  isGoogleOAuthConfigured,
  storeGoogleOAuthClientConfig
} from './googleOAuth'

const TOKEN_KEY_PREFIX = 'calendar:google:token:'

export function storeGoogleToken(sourceId: string, token: Record<string, unknown>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this device')
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(token))
  setSetting(`${TOKEN_KEY_PREFIX}${sourceId}`, encrypted.toString('base64'))
}

export function readGoogleToken(sourceId: string): Record<string, unknown> | null {
  const record = getSetting(`${TOKEN_KEY_PREFIX}${sourceId}`)
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

export function deleteGoogleToken(sourceId: string): void {
  setSetting(`${TOKEN_KEY_PREFIX}${sourceId}`, '')
}

const SOURCE_SECRET_PREFIX = 'calendar:source:secret:'

/** Encrypted per-source secret blob (e.g. CalDAV Basic-auth username/password JSON). */
export function storeSourceSecret(sourceId: string, secret: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this device')
  }
  const encrypted = safeStorage.encryptString(secret)
  setSetting(`${SOURCE_SECRET_PREFIX}${sourceId}`, encrypted.toString('base64'))
}

export function readSourceSecret(sourceId: string): string | null {
  const record = getSetting(`${SOURCE_SECRET_PREFIX}${sourceId}`)
  if (!record?.value) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(record.value, 'base64'))
  } catch {
    return null
  }
}

export function deleteSourceSecret(sourceId: string): void {
  setSetting(`${SOURCE_SECRET_PREFIX}${sourceId}`, '')
}
