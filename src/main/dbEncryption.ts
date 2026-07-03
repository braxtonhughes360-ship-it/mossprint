import { randomBytes, scryptSync } from 'node:crypto'
import type { SqliteDatabase } from './sqlite'
import Database from './sqlite'
import { closeSync, openSync, readSync } from 'node:fs'

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }
const DB_KEY_LENGTH = 32

export function deriveProfileDbKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password.trim(), salt, DB_KEY_LENGTH, SCRYPT_OPTIONS)
}

export function generateProfileDbKey(): Buffer {
  return randomBytes(DB_KEY_LENGTH)
}

export function applySqlCipherKey(database: SqliteDatabase, key: Buffer): void {
  database.pragma(`cipher='sqlcipher'`)
  database.pragma('legacy=4')
  database.pragma(`key="x'${key.toString('hex')}'"`)
}

export function verifySqlCipherKey(database: SqliteDatabase): void {
  database.prepare('SELECT 1 AS ok').get()
}

export function isPlaintextSqliteFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    const header = Buffer.alloc(16)
    readSync(fd, header, 0, 16, 0)
    closeSync(fd)
    return header.toString('utf8').startsWith('SQLite format')
  } catch {
    return false
  }
}

/** Create a new encrypted profile database and run schema migrations. */
export function createEncryptedDatabase(path: string, key: Buffer): SqliteDatabase {
  const database = new Database(path)
  applySqlCipherKey(database, key)
  return database
}

/** Re-encrypt an existing plaintext SQLite file in place. */
export function encryptPlainDatabaseFile(path: string, key: Buffer): void {
  const database = new Database(path)
  try {
    database.pragma(`cipher='sqlcipher'`)
    database.pragma('legacy=4')
    database.pragma(`rekey="x'${key.toString('hex')}'"`)
  } finally {
    database.close()
  }
}

export function openEncryptedDatabase(path: string, key: Buffer): SqliteDatabase {
  const database = new Database(path)
  applySqlCipherKey(database, key)
  verifySqlCipherKey(database)
  return database
}

export function tryOpenEncryptedDatabase(path: string, key: Buffer): SqliteDatabase | null {
  try {
    return openEncryptedDatabase(path, key)
  } catch {
    return null
  }
}
