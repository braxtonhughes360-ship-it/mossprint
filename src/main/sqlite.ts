/**
 * SQLCipher-capable SQLite — drop-in for better-sqlite3 with encryption pragmas.
 * @see dbEncryption.ts
 */
import Database from 'better-sqlite3-multiple-ciphers'

export type SqliteDatabase = Database.Database
export default Database
