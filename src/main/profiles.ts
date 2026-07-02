import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from './sqlite'
import { app } from 'electron'
import {
  normalizeAvatarColor,
  profileSummaryFromRecord,
  type ActivateProfileResponse,
  type CreateProfileInput,
  type CreateProfileResult,
  type DeleteProfileInput,
  type ProfileAvatarColor,
  type ProfileRecord,
  type ProfileSummary,
  type RegenerateRecoveryPhraseInput,
  type RegenerateRecoveryPhraseResult,
  type ResetProfilePasswordInput,
  type SetProfilePasswordInput,
  type UpdateProfileInput
} from '@shared/profiles'
import { PREFERENCES_STORAGE_KEY, parsePreferences } from '@shared/preferences'
import { closeDatabase } from './database'
import { resetIdleLockOnActivate } from './idleLock'
import {
  openProfileDatabase,
  provisionNewProfileDatabase,
  readActiveDbKey,
  refreshRecoveryEscrow,
  resolveDbKey,
  restoreKeychainFromDbKey,
  rewrapProfileDbKeyForPassword,
  unwrapProfileDbKeyWithRecovery,
  wrapProfileDbKeyForPassword,
  type ProfileDbKeyRow
} from './profileDbAccess'
import { profileDatabasePath, profileDirectory, profilesRoot } from './profilePaths'
import {
  generateRecoveryPhrase,
  hashProfilePassword,
  hashRecoveryPhrase,
  validateProfilePassword,
  verifyProfilePassword,
  verifyRecoveryPhrase
} from './profileSecurity'
import {
  assertUnlockAllowed,
  clearUnlockAttempts,
  enforceUnlockDelay,
  recordFailedUnlock
} from './unlockAttempts'

let registryDb: Database.Database | null = null

let activeProfileId: string | null = null
let activeDatabasePath: string | null = null
/** In-memory session tokens — cleared on lock or quit. Never persisted. */
const unlockedSessions = new Set<string>()

function registryPath(): string {
  return join(profilesRoot(), 'registry.sqlite')
}

function activeProfileMetaPath(): string {
  return join(app.getPath('userData'), 'active-profile.json')
}

function legacyDatabasePath(): string {
  return join(app.getPath('userData'), 'moss.sqlite')
}

function openRegistry(): Database.Database {
  if (!registryDb) {
    mkdirSync(profilesRoot(), { recursive: true })
    registryDb = new Database(registryPath())
    registryDb.pragma('journal_mode = WAL')
    registryDb.pragma('foreign_keys = ON')
    migrateRegistry(registryDb)
  }
  return registryDb
}

function migrateRegistry(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT 'moss',
      password_enabled INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      password_salt TEXT,
      recovery_enabled INTEGER NOT NULL DEFAULT 0,
      recovery_hash TEXT,
      recovery_salt TEXT,
      created_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `)

  const columns = database.prepare('PRAGMA table_info(profiles)').all() as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('recovery_enabled')) {
    database.exec(
      `ALTER TABLE profiles ADD COLUMN recovery_enabled INTEGER NOT NULL DEFAULT 0`
    )
  }
  if (!names.has('recovery_hash')) {
    database.exec(`ALTER TABLE profiles ADD COLUMN recovery_hash TEXT`)
  }
  if (!names.has('recovery_salt')) {
    database.exec(`ALTER TABLE profiles ADD COLUMN recovery_salt TEXT`)
  }
  if (!names.has('db_key_salt')) {
    database.exec(`ALTER TABLE profiles ADD COLUMN db_key_salt TEXT`)
  }
  if (!names.has('db_key_wrapped')) {
    database.exec(`ALTER TABLE profiles ADD COLUMN db_key_wrapped TEXT`)
  }
  if (!names.has('db_key_recovery_salt')) {
    database.exec(`ALTER TABLE profiles ADD COLUMN db_key_recovery_salt TEXT`)
  }
  if (!names.has('db_key_recovery_wrapped')) {
    database.exec(`ALTER TABLE profiles ADD COLUMN db_key_recovery_wrapped TEXT`)
  }
}

function hardenPath(path: string, mode: number): void {
  try {
    if (existsSync(path)) chmodSync(path, mode)
  } catch {
    // best effort — permissions still depend on the OS login
  }
}

function hardenProfileStorage(profileId: string): void {
  const dir = profileDirectory(profileId)
  const dbPath = profileDatabasePath(profileId)
  hardenPath(profilesRoot(), 0o700)
  hardenPath(dir, 0o700)
  hardenPath(dbPath, 0o600)
  hardenPath(registryPath(), 0o600)
}

function rowToRecord(row: {
  id: string
  display_name: string
  avatar_color: string
  password_enabled: number
  password_hash: string | null
  password_salt: string | null
  recovery_enabled: number
  recovery_hash: string | null
  recovery_salt: string | null
  created_at: string
  sort_order: number
}): ProfileRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarColor: normalizeAvatarColor(row.avatar_color),
    passwordEnabled: row.password_enabled === 1,
    recoveryEnabled: row.recovery_enabled === 1,
    createdAt: row.created_at,
    sortOrder: row.sort_order
  }
}

function storeRecoveryPhrase(
  profileId: string,
  phrase: string,
  escrow?: { saltHex: string; wrapped: string }
): void {
  const salt = randomBytes(16)
  const hash = hashRecoveryPhrase(phrase, salt)
  openRegistry()
    .prepare(
      `UPDATE profiles
       SET recovery_enabled = 1, recovery_hash = @hash, recovery_salt = @salt,
           db_key_recovery_salt = COALESCE(@dbKeyRecoverySalt, db_key_recovery_salt),
           db_key_recovery_wrapped = COALESCE(@dbKeyRecoveryWrapped, db_key_recovery_wrapped)
       WHERE id = @id`
    )
    .run({
      id: profileId,
      hash,
      salt: salt.toString('hex'),
      dbKeyRecoverySalt: escrow?.saltHex ?? null,
      dbKeyRecoveryWrapped: escrow?.wrapped ?? null
    })
}

function hashPassword(password: string, salt: Buffer): string {
  return hashProfilePassword(password, salt)
}

function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  return verifyProfilePassword(password, saltHex, hashHex)
}

function readDisplayNameFromDb(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null
  try {
    const database = new Database(dbPath, { readonly: true })
    const row = database
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(PREFERENCES_STORAGE_KEY) as { value: string } | undefined
    database.close()
    if (!row?.value) return null
    return parsePreferences(row.value).profile.displayName.trim() || null
  } catch {
    return null
  }
}

function persistActiveProfileId(profileId: string): void {
  writeFileSync(activeProfileMetaPath(), JSON.stringify({ profileId }), 'utf8')
}

function readPersistedActiveProfileId(): string | null {
  try {
    if (!existsSync(activeProfileMetaPath())) return null
    const parsed = JSON.parse(readFileSync(activeProfileMetaPath(), 'utf8')) as {
      profileId?: string
    }
    return typeof parsed.profileId === 'string' ? parsed.profileId : null
  } catch {
    return null
  }
}

function clearPersistedActiveProfileId(): void {
  try {
    if (existsSync(activeProfileMetaPath())) {
      rmSync(activeProfileMetaPath())
    }
  } catch {
    // best effort
  }
}

function migrateLegacyDatabase(registry: Database.Database): ProfileSummary | null {
  const count = (
    registry.prepare('SELECT COUNT(*) AS count FROM profiles').get() as { count: number }
  ).count
  if (count > 0) return null

  const legacyPath = legacyDatabasePath()
  if (!existsSync(legacyPath)) return null

  const id = randomUUID()
  const now = new Date().toISOString()
  const profileDir = profileDirectory(id)
  mkdirSync(profileDir, { recursive: true })
  const targetPath = profileDatabasePath(id)

  renameSync(legacyPath, targetPath)

  const displayName = readDisplayNameFromDb(targetPath) ?? 'Me'

  registry
    .prepare(
      `INSERT INTO profiles (id, display_name, avatar_color, password_enabled, password_hash, password_salt, created_at, sort_order)
       VALUES (@id, @displayName, 'moss', 0, NULL, NULL, @createdAt, 0)`
    )
    .run({ id, displayName, createdAt: now })

  persistActiveProfileId(id)
  return profileSummaryFromRecord(rowToRecord(getProfileRow(id)!))
}

function getProfileRow(id: string):
  | (ProfileDbKeyRow & {
      display_name: string
      avatar_color: string
      password_hash: string | null
      password_salt: string | null
      recovery_enabled: number
      recovery_hash: string | null
      recovery_salt: string | null
      created_at: string
      sort_order: number
    })
  | undefined {
  return openRegistry()
    .prepare(
      `SELECT id, display_name, avatar_color, password_enabled, password_hash, password_salt,
              recovery_enabled, recovery_hash, recovery_salt,
              db_key_salt, db_key_wrapped, db_key_recovery_salt, db_key_recovery_wrapped,
              created_at, sort_order
       FROM profiles WHERE id = ?`
    )
    .get(id) as ReturnType<typeof getProfileRow>
}

function getProfileRecord(id: string): ProfileRecord | null {
  const row = getProfileRow(id)
  return row ? rowToRecord(row) : null
}

function grantSession(profileId: string): void {
  unlockedSessions.add(profileId)
}

function revokeSession(profileId: string): void {
  unlockedSessions.delete(profileId)
}

export function isProfileUnlocked(profileId: string): boolean {
  const record = getProfileRecord(profileId)
  if (!record) return false
  if (!record.passwordEnabled) return true
  return unlockedSessions.has(profileId)
}

function assertUnlocked(profileId: string): void {
  if (!isProfileUnlocked(profileId)) {
    throw new Error('Profile is locked')
  }
}

export function initializeProfiles(): void {
  const registry = openRegistry()
  migrateLegacyDatabase(registry)
}

export function listProfiles(): ProfileSummary[] {
  const rows = openRegistry()
    .prepare(
      `SELECT id, display_name, avatar_color, password_enabled, password_hash, password_salt,
              recovery_enabled, recovery_hash, recovery_salt,
              db_key_salt, db_key_wrapped, db_key_recovery_salt, db_key_recovery_wrapped,
              created_at, sort_order
       FROM profiles ORDER BY sort_order ASC, created_at ASC`
    )
    .all() as Array<NonNullable<ReturnType<typeof getProfileRow>>>

  return rows.map((row) => profileSummaryFromRecord(rowToRecord(row)))
}

export function getActiveProfileState(): {
  profile: ProfileSummary
  databasePath: string
} | null {
  if (!activeProfileId || !activeDatabasePath) return null
  const record = getProfileRecord(activeProfileId)
  if (!record) return null
  return {
    profile: profileSummaryFromRecord(record),
    databasePath: activeDatabasePath
  }
}

export async function activateProfile(
  profileId: string,
  password?: string,
  options?: { bypassPassword?: boolean }
): Promise<ActivateProfileResponse> {
  const row = getProfileRow(profileId)
  if (!row) {
    return { ok: false, code: 'not_found', message: 'Profile not found.' }
  }

  const record = rowToRecord(row)

  if (!options?.bypassPassword) {
    try {
      await enforceUnlockDelay(profileId)
      assertUnlockAllowed(profileId)
    } catch (error) {
      return {
        ok: false,
        code: 'rate_limited',
        message: error instanceof Error ? error.message : 'Too many attempts.'
      }
    }
  }

  if (record.passwordEnabled && !options?.bypassPassword) {
    if (!password) {
      return { ok: false, code: 'password_required', message: 'Password required.' }
    }
    if (!row.password_salt || !row.password_hash) {
      return { ok: false, code: 'locked', message: 'Profile password is misconfigured.' }
    }
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      recordFailedUnlock(profileId)
      return { ok: false, code: 'wrong_password', message: 'Wrong password.' }
    }
  }

  const dbPath = profileDatabasePath(profileId)
  mkdirSync(profileDirectory(profileId), { recursive: true })

  closeDatabase()
  try {
    openProfileDatabase(row, password)
  } catch (error) {
    if (record.passwordEnabled) {
      recordFailedUnlock(profileId)
      return { ok: false, code: 'wrong_password', message: 'Wrong password.' }
    }
    return {
      ok: false,
      code: 'locked',
      message: error instanceof Error ? error.message : 'Could not open profile database.'
    }
  }

  activeProfileId = profileId
  activeDatabasePath = dbPath
  grantSession(profileId)
  persistActiveProfileId(profileId)
  hardenProfileStorage(profileId)
  clearUnlockAttempts(profileId)
  resetIdleLockOnActivate()

  void import('./nutritionUsdaImport')
    .then(({ maybeAutoImportUsdaFoundation }) => maybeAutoImportUsdaFoundation())
    .catch(() => {
      // foundation import is best-effort on profile open
    })

  // Background refresh belongs here, not at app boot: no profile database is open
  // until a profile activates, so boot-time syncs always threw and were swallowed.
  if (
    !process.env.MOSS_HEADLESS_USER_DATA &&
    process.env.MOSS_QA_SEED !== '1' &&
    process.env.MOSS_DEMO_PROFILES !== '1'
  ) {
    void import('./calendarSync')
      .then(({ syncAllCalendarSources }) => syncAllCalendarSources())
      .catch(() => undefined)
    void import('./news')
      .then(({ syncAllNewsSources }) => syncAllNewsSources())
      .catch(() => undefined)
    void import('./mailSync')
      .then(({ syncAllMailAccounts }) => syncAllMailAccounts())
      .catch(() => undefined)
  }

  return {
    ok: true,
    profile: profileSummaryFromRecord(record),
    databasePath: dbPath
  }
}

export async function activateDefaultProfile(
  options?: { bypassPassword?: boolean }
): Promise<ActivateProfileResponse | null> {
  const profiles = listProfiles()
  if (profiles.length === 0) return null

  const persisted = readPersistedActiveProfileId()
  const target =
    (persisted && profiles.some((p) => p.id === persisted) ? persisted : null) ??
    profiles[0]!.id

  return activateProfile(target, undefined, options)
}

export function lockActiveProfile(): void {
  if (activeProfileId) {
    revokeSession(activeProfileId)
  }
  activeProfileId = null
  activeDatabasePath = null
  closeDatabase()
  clearPersistedActiveProfileId()
}

export function requireActiveProfileDatabase(): string {
  if (!activeProfileId || !activeDatabasePath) {
    throw new Error('No active profile')
  }
  assertUnlocked(activeProfileId)
  return activeDatabasePath
}

export function createProfile(input: CreateProfileInput): CreateProfileResult {
  const registry = openRegistry()
  const id = randomUUID()
  const now = new Date().toISOString()
  const displayName = input.displayName.trim().slice(0, 64) || 'New profile'
  const avatarColor = normalizeAvatarColor(input.avatarColor)
  const sortOrder = (
    registry.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM profiles').get() as {
      next: number
    }
  ).next
  const recoveryPhrase = generateRecoveryPhrase()
  const recoverySalt = randomBytes(16)
  const recoveryHash = hashRecoveryPhrase(recoveryPhrase, recoverySalt)

  mkdirSync(profileDirectory(id), { recursive: true })
  const escrow = provisionNewProfileDatabase(id, recoveryPhrase)

  registry
    .prepare(
      `INSERT INTO profiles (
         id, display_name, avatar_color, password_enabled, password_hash, password_salt,
         recovery_enabled, recovery_hash, recovery_salt,
         db_key_salt, db_key_wrapped, db_key_recovery_salt, db_key_recovery_wrapped,
         created_at, sort_order
       )
       VALUES (
         @id, @displayName, @avatarColor, 0, NULL, NULL,
         1, @recoveryHash, @recoverySalt,
         NULL, NULL, @dbKeyRecoverySalt, @dbKeyRecoveryWrapped,
         @createdAt, @sortOrder
       )`
    )
    .run({
      id,
      displayName,
      avatarColor,
      recoveryHash,
      recoverySalt: recoverySalt.toString('hex'),
      dbKeyRecoverySalt: escrow.dbKeyRecoverySalt,
      dbKeyRecoveryWrapped: escrow.dbKeyRecoveryWrapped,
      createdAt: now,
      sortOrder
    })

  hardenProfileStorage(id)

  return {
    profile: profileSummaryFromRecord(getProfileRecord(id)!),
    recoveryPhrase
  }
}

export function updateProfile(profileId: string, input: UpdateProfileInput): ProfileSummary {
  const record = getProfileRecord(profileId)
  if (!record) throw new Error('Profile not found')

  const displayName =
    input.displayName !== undefined ? input.displayName.trim().slice(0, 64) : record.displayName
  const avatarColor =
    input.avatarColor !== undefined ? normalizeAvatarColor(input.avatarColor) : record.avatarColor

  openRegistry()
    .prepare(
      `UPDATE profiles SET display_name = @displayName, avatar_color = @avatarColor WHERE id = @id`
    )
    .run({ id: profileId, displayName, avatarColor })

  return profileSummaryFromRecord(getProfileRecord(profileId)!)
}

export function setProfilePassword(profileId: string, input: SetProfilePasswordInput): ProfileSummary {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  const password = input.password.trim()
  const passwordError = validateProfilePassword(password)
  if (passwordError) {
    throw new Error(passwordError)
  }

  if (!record.recoveryEnabled) {
    throw new Error('Set up a recovery phrase before enabling a profile password.')
  }

  if (record.passwordEnabled) {
    if (!input.currentPassword) {
      throw new Error('Current password required.')
    }
    if (!row.password_salt || !row.password_hash) {
      throw new Error('Profile password is misconfigured.')
    }
    if (!verifyPassword(input.currentPassword, row.password_salt, row.password_hash)) {
      throw new Error('Current password is wrong.')
    }
  }

  const salt = randomBytes(16)
  const hash = hashPassword(password, salt)
  const dbKeySalt = randomBytes(16)

  let dbKeyWrapped: string
  if (record.passwordEnabled && input.currentPassword) {
    const dbKey = readActiveDbKey(row, input.currentPassword)
    dbKeyWrapped = rewrapProfileDbKeyForPassword(dbKey, password, dbKeySalt)
  } else {
    const wrapped = wrapProfileDbKeyForPassword(profileId, password, dbKeySalt)
    dbKeyWrapped = wrapped.wrapped
  }

  openRegistry()
    .prepare(
      `UPDATE profiles
       SET password_enabled = 1, password_hash = @hash, password_salt = @salt,
           db_key_salt = @dbKeySalt, db_key_wrapped = @dbKeyWrapped
       WHERE id = @id`
    )
    .run({
      id: profileId,
      hash,
      salt: salt.toString('hex'),
      dbKeySalt: dbKeySalt.toString('hex'),
      dbKeyWrapped
    })

  grantSession(profileId)
  return profileSummaryFromRecord(getProfileRecord(profileId)!)
}

export function resetProfilePassword(
  profileId: string,
  input: ResetProfilePasswordInput
): ProfileSummary {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  if (!record.recoveryEnabled || !row.recovery_salt || !row.recovery_hash) {
    throw new Error('Recovery phrase is not set up for this profile.')
  }
  if (!verifyRecoveryPhrase(input.recoveryPhrase, row.recovery_salt, row.recovery_hash)) {
    throw new Error('Recovery phrase does not match.')
  }

  const passwordError = validateProfilePassword(input.newPassword)
  if (passwordError) {
    throw new Error(passwordError)
  }

  const dbKey = unwrapProfileDbKeyWithRecovery(row, input.recoveryPhrase)
  const salt = randomBytes(16)
  const hash = hashPassword(input.newPassword.trim(), salt)
  const dbKeySalt = randomBytes(16)
  const dbKeyWrapped = rewrapProfileDbKeyForPassword(dbKey, input.newPassword.trim(), dbKeySalt)

  openRegistry()
    .prepare(
      `UPDATE profiles
       SET password_enabled = 1, password_hash = @hash, password_salt = @salt,
           db_key_salt = @dbKeySalt, db_key_wrapped = @dbKeyWrapped
       WHERE id = @id`
    )
    .run({
      id: profileId,
      hash,
      salt: salt.toString('hex'),
      dbKeySalt: dbKeySalt.toString('hex'),
      dbKeyWrapped
    })

  grantSession(profileId)
  return profileSummaryFromRecord(getProfileRecord(profileId)!)
}

export function regenerateRecoveryPhrase(
  profileId: string,
  input: RegenerateRecoveryPhraseInput
): RegenerateRecoveryPhraseResult {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  if (record.passwordEnabled) {
    if (!input.password || !row.password_salt || !row.password_hash) {
      throw new Error('Current password required.')
    }
    if (!verifyPassword(input.password, row.password_salt, row.password_hash)) {
      throw new Error('Current password is wrong.')
    }
  } else if (record.recoveryEnabled) {
    if (!input.recoveryPhrase || !row.recovery_salt || !row.recovery_hash) {
      throw new Error('Current recovery phrase required.')
    }
    if (!verifyRecoveryPhrase(input.recoveryPhrase, row.recovery_salt, row.recovery_hash)) {
      throw new Error('Recovery phrase does not match.')
    }
  }

  const recoveryPhrase = generateRecoveryPhrase()
  let dbKey: Buffer
  if (record.passwordEnabled && input.password) {
    dbKey = readActiveDbKey(row, input.password)
  } else if (row.db_key_recovery_wrapped && input.recoveryPhrase) {
    dbKey = unwrapProfileDbKeyWithRecovery(row, input.recoveryPhrase)
  } else {
    dbKey = resolveDbKey(row)
  }
  const escrow = refreshRecoveryEscrow(dbKey, recoveryPhrase)
  storeRecoveryPhrase(profileId, recoveryPhrase, escrow)
  grantSession(profileId)
  return {
    profile: profileSummaryFromRecord(getProfileRecord(profileId)!),
    recoveryPhrase
  }
}

export function issueRecoveryPhraseForPasswordSetup(
  profileId: string
): RegenerateRecoveryPhraseResult {
  assertUnlocked(profileId)
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  if (record.passwordEnabled) {
    throw new Error('Password is already enabled for this profile.')
  }

  const dbKey = resolveDbKey(row)
  const recoveryPhrase = generateRecoveryPhrase()
  const escrow = refreshRecoveryEscrow(dbKey, recoveryPhrase)
  storeRecoveryPhrase(profileId, recoveryPhrase, escrow)
  grantSession(profileId)

  return {
    profile: profileSummaryFromRecord(getProfileRecord(profileId)!),
    recoveryPhrase
  }
}

export function setupRecoveryPhraseForLegacyProfile(profileId: string): RegenerateRecoveryPhraseResult {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')
  const record = rowToRecord(row)
  if (record.recoveryEnabled && row.db_key_recovery_wrapped) {
    throw new Error('Recovery phrase is already set.')
  }
  const recoveryPhrase = generateRecoveryPhrase()
  const dbKey = resolveDbKey(row)
  const escrow = refreshRecoveryEscrow(dbKey, recoveryPhrase)
  storeRecoveryPhrase(profileId, recoveryPhrase, escrow)
  return {
    profile: profileSummaryFromRecord(getProfileRecord(profileId)!),
    recoveryPhrase
  }
}

export function clearProfilePassword(profileId: string, currentPassword: string): ProfileSummary {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  if (!record.passwordEnabled) {
    return profileSummaryFromRecord(record)
  }

  if (!row.password_salt || !row.password_hash) {
    throw new Error('Profile password is misconfigured.')
  }
  if (!verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
    throw new Error('Current password is wrong.')
  }

  const dbKey = readActiveDbKey(row, currentPassword)
  restoreKeychainFromDbKey(profileId, dbKey)

  openRegistry()
    .prepare(
      `UPDATE profiles
       SET password_enabled = 0, password_hash = NULL, password_salt = NULL,
           db_key_salt = NULL, db_key_wrapped = NULL
       WHERE id = @id`
    )
    .run({ id: profileId })

  grantSession(profileId)
  return profileSummaryFromRecord(getProfileRecord(profileId)!)
}

export function clearProfilePasswordWithRecovery(
  profileId: string,
  recoveryPhrase: string
): ProfileSummary {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  if (!record.passwordEnabled) {
    return profileSummaryFromRecord(record)
  }
  if (!row.recovery_salt || !row.recovery_hash) {
    throw new Error('Recovery phrase is misconfigured.')
  }
  if (!verifyRecoveryPhrase(recoveryPhrase, row.recovery_salt, row.recovery_hash)) {
    throw new Error('Recovery phrase does not match.')
  }

  const dbKey = unwrapProfileDbKeyWithRecovery(row, recoveryPhrase)
  restoreKeychainFromDbKey(profileId, dbKey)

  openRegistry()
    .prepare(
      `UPDATE profiles
       SET password_enabled = 0, password_hash = NULL, password_salt = NULL,
           db_key_salt = NULL, db_key_wrapped = NULL
       WHERE id = @id`
    )
    .run({ id: profileId })

  grantSession(profileId)
  return profileSummaryFromRecord(getProfileRecord(profileId)!)
}

export function deleteProfile(profileId: string, input: DeleteProfileInput): void {
  const row = getProfileRow(profileId)
  if (!row) throw new Error('Profile not found')

  const record = rowToRecord(row)
  if (input.confirmName.trim() !== record.displayName) {
    throw new Error('Confirmation name does not match.')
  }

  if (record.passwordEnabled) {
    if (!input.password) throw new Error('Password required.')
    if (!row.password_salt || !row.password_hash) {
      throw new Error('Profile password is misconfigured.')
    }
    if (!verifyPassword(input.password, row.password_salt, row.password_hash)) {
      throw new Error('Password is wrong.')
    }
  } else if (record.recoveryEnabled && row.recovery_salt && row.recovery_hash && input.password) {
    if (!verifyRecoveryPhrase(input.password, row.recovery_salt, row.recovery_hash)) {
      throw new Error('Recovery phrase is wrong.')
    }
  }

  const wasActive = activeProfileId === profileId

  openRegistry().prepare('DELETE FROM profiles WHERE id = ?').run(profileId)
  rmSync(profileDirectory(profileId), { recursive: true, force: true })
  revokeSession(profileId)

  if (wasActive) {
    activeProfileId = null
    activeDatabasePath = null
    closeDatabase()
    clearPersistedActiveProfileId()
  }
}

export function closeProfilesRegistry(): void {
  if (registryDb) {
    registryDb.close()
    registryDb = null
  }
}

/** Operator reset — deletes every profile directory, registry, and active-session marker. */
export function wipeAllProfiles(): { ok: true; removed: number } {
  if (process.env.MOSS_ALLOW_PROFILE_WIPE !== '1') {
    throw new Error(
      'Refusing to wipe profiles without MOSS_ALLOW_PROFILE_WIPE=1. Use npm run moss:wipe-profiles instead.'
    )
  }
  lockActiveProfile()
  closeProfilesRegistry()

  let removed = 0
  const root = profilesRoot()
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (entry === 'registry.sqlite' || entry.startsWith('registry.sqlite-')) {
        try {
          rmSync(join(root, entry), { force: true })
        } catch {
          // best effort
        }
        continue
      }
      const path = join(root, entry)
      try {
        rmSync(path, { recursive: true, force: true })
        removed += 1
      } catch {
        // best effort
      }
    }
  }

  try {
    if (existsSync(activeProfileMetaPath())) rmSync(activeProfileMetaPath())
  } catch {
    // best effort
  }

  try {
    const legacy = legacyDatabasePath()
    if (existsSync(legacy)) rmSync(legacy)
  } catch {
    // best effort
  }

  return { ok: true, removed }
}

export function avatarColorHue(color: ProfileAvatarColor): number {
  switch (color) {
    case 'moss':
      return 145
    case 'ember':
      return 32
    case 'slate':
      return 220
    case 'violet':
      return 280
    case 'rose':
      return 350
  }
}
