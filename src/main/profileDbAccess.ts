import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  encryptPlainDatabaseFile,
  generateProfileDbKey,
  isPlaintextSqliteFile
} from './dbEncryption'
import { closeDatabase, openDatabaseAt } from './database'
import {
  deleteProfileDbKeyFromKeychain,
  readProfileDbKeyFromKeychain,
  storeProfileDbKeyInKeychain
} from './profileDbKey'
import { profileDatabasePath } from './profilePaths'
import {
  deriveRecoveryWrapSecret,
  deriveWrapSecret,
  unwrapDbKey,
  wrapDbKey
} from './profileDbEscrow'

export interface ProfileDbKeyRow {
  id: string
  password_enabled: number
  db_key_wrapped: string | null
  db_key_salt: string | null
  db_key_recovery_wrapped: string | null
  db_key_recovery_salt: string | null
}

export interface NewProfileDbEscrow {
  dbKeyRecoverySalt: string
  dbKeyRecoveryWrapped: string
}

/** Create encrypted moss.sqlite + recovery escrow for a brand-new profile. */
export function provisionNewProfileDatabase(
  profileId: string,
  recoveryPhrase: string
): NewProfileDbEscrow {
  const dbKey = generateProfileDbKey()
  storeProfileDbKeyInKeychain(profileId, dbKey)

  const recoverySalt = randomBytes(16)
  const recoverySecret = deriveRecoveryWrapSecret(recoveryPhrase, recoverySalt)
  const recoveryWrapped = wrapDbKey(dbKey, recoverySecret)

  const dbPath = profileDatabasePath(profileId)
  openDatabaseAt(dbPath, dbKey)
  closeDatabase()

  return {
    dbKeyRecoverySalt: recoverySalt.toString('hex'),
    dbKeyRecoveryWrapped: recoveryWrapped
  }
}

export function resolveDbKey(row: ProfileDbKeyRow, password?: string): Buffer {
  if (row.password_enabled === 1) {
    if (!password || !row.db_key_wrapped || !row.db_key_salt) {
      throw new Error('Profile encryption is misconfigured.')
    }
    try {
      return unwrapDbKey(
        row.db_key_wrapped,
        deriveWrapSecret(password, Buffer.from(row.db_key_salt, 'hex'))
      )
    } catch {
      throw new Error('Wrong password.')
    }
  }

  const keychainKey = readProfileDbKeyFromKeychain(row.id)
  if (keychainKey) {
    return keychainKey
  }

  const dbPath = profileDatabasePath(row.id)
  if (existsSync(dbPath) && isPlaintextSqliteFile(dbPath)) {
    const dbKey = generateProfileDbKey()
    storeProfileDbKeyInKeychain(row.id, dbKey)
    encryptPlainDatabaseFile(dbPath, dbKey)
    return dbKey
  }

  throw new Error('Profile encryption key missing — regenerate recovery or create a new profile.')
}

export function openProfileDatabase(row: ProfileDbKeyRow, password?: string): void {
  const dbPath = profileDatabasePath(row.id)
  const dbKey = resolveDbKey(row, password)
  if (isPlaintextSqliteFile(dbPath)) {
    encryptPlainDatabaseFile(dbPath, dbKey)
  }
  openDatabaseAt(dbPath, dbKey)
}

export function wrapProfileDbKeyForPassword(
  profileId: string,
  password: string,
  dbKeySalt: Buffer
): { wrapped: string; saltHex: string } {
  const dbKey = readProfileDbKeyFromKeychain(profileId)
  if (!dbKey) {
    throw new Error('Profile database key not found.')
  }
  const wrapped = wrapDbKey(dbKey, deriveWrapSecret(password, dbKeySalt))
  deleteProfileDbKeyFromKeychain(profileId)
  return { wrapped, saltHex: dbKeySalt.toString('hex') }
}

export function unwrapProfileDbKeyWithRecovery(
  row: ProfileDbKeyRow,
  recoveryPhrase: string
): Buffer {
  if (!row.db_key_recovery_wrapped || !row.db_key_recovery_salt) {
    throw new Error('Recovery escrow is not configured for this profile.')
  }
  return unwrapDbKey(
    row.db_key_recovery_wrapped,
    deriveRecoveryWrapSecret(recoveryPhrase, Buffer.from(row.db_key_recovery_salt, 'hex'))
  )
}

export function rewrapProfileDbKeyForPassword(
  dbKey: Buffer,
  password: string,
  dbKeySalt: Buffer
): string {
  return wrapDbKey(dbKey, deriveWrapSecret(password, dbKeySalt))
}

export function refreshRecoveryEscrow(dbKey: Buffer, recoveryPhrase: string): {
  saltHex: string
  wrapped: string
} {
  const salt = randomBytes(16)
  return {
    saltHex: salt.toString('hex'),
    wrapped: wrapDbKey(dbKey, deriveRecoveryWrapSecret(recoveryPhrase, salt))
  }
}

/** Read the live DB key for an unlocked password profile (recovery / password change). */
export function readActiveDbKey(row: ProfileDbKeyRow, password: string): Buffer {
  return resolveDbKey(row, password)
}

export function restoreKeychainFromDbKey(profileId: string, dbKey: Buffer): void {
  storeProfileDbKeyInKeychain(profileId, dbKey)
}
