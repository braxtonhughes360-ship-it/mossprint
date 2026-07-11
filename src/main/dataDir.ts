/**
 * D1 — "Your data" overview + live move of the profiles tree.
 *
 * Move contract (QA-18, master plan): pre-flight → close every DB handle →
 * copy → verify the copy (file count + sizes, read-only SQLCipher open at the
 * target) → atomically flip the stored override → only then delete the old
 * tree → relaunch. Any failure before the flip removes the partial copy and
 * leaves the old data untouched.
 */
import { app, dialog, safeStorage, shell } from 'electron'
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import Database from './sqlite'
import { applySqlCipherKey, verifySqlCipherKey } from './dbEncryption'
import {
  MOSS_DATA_MARKER,
  compareManifests,
  evaluateMoveTarget,
  serializeDataRootOverride,
  type ManifestEntry
} from './dataDirCore'
import {
  currentDataRootOverride,
  dataRootOverridePath,
  invalidateProfilesRootCache,
  profileDatabasePath,
  profileDirectory,
  profilesRoot
} from './profilePaths'
import { closeProfilesRegistry, listProfiles, lockActiveProfile } from './profiles'
import { usesPlainDbKeyStorage } from './headlessProfile'
import { bundledModelDir } from './localRuntime'
import type { DataOverview, MoveDataFolderResult } from '@shared/types'

function directoryBytes(root: string): number {
  let total = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) total += statSync(path).size
    }
  }
  try {
    walk(root)
  } catch {
    // partial totals beat a crashed settings card
  }
  return total
}

function buildManifest(root: string): ManifestEntry[] {
  const entries: ManifestEntry[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, rel)
      else if (entry.isFile()) entries.push({ rel, size: statSync(path).size })
    }
  }
  walk(root, '')
  entries.sort((a, b) => a.rel.localeCompare(b.rel))
  return entries
}

export function getDataOverview(): DataOverview {
  const root = profilesRoot()
  const modelDir = bundledModelDir()

  const profiles = listProfiles().map((profile) => ({
    id: profile.id,
    displayName: profile.displayName,
    bytes: existsSync(profileDirectory(profile.id)) ? directoryBytes(profileDirectory(profile.id)) : 0
  }))

  return {
    dataRoot: root,
    isCustomLocation: currentDataRootOverride() !== null,
    defaultDataRoot: app.getPath('userData'),
    totalBytes: existsSync(root) ? directoryBytes(root) : 0,
    profiles,
    modelDir,
    modelBytes: existsSync(modelDir) ? directoryBytes(modelDir) : 0
  }
}

export function showDataInFolder(): void {
  const root = profilesRoot()
  const active = listProfiles()
  // Highlight the first profile's DB when it exists — the file the user cares about.
  const dbPath = active[0] ? profileDatabasePath(active[0].id) : null
  shell.showItemInFolder(dbPath && existsSync(dbPath) ? dbPath : root)
}

export async function pickMoveTarget(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder for your MOSS data',
    buttonLabel: 'Choose folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]!
}

function probeWritable(dir: string): boolean {
  const probePath = join(dir, `.moss-write-probe-${Date.now()}`)
  try {
    accessSync(dir, constants.W_OK)
    writeFileSync(probePath, 'probe')
    rmSync(probePath)
    return true
  } catch {
    try {
      rmSync(probePath, { force: true })
    } catch {
      // best effort
    }
    return false
  }
}

function freeBytesAt(dir: string): number | null {
  try {
    const stats = statfsSync(dir)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

/** Read a copied db.key.enc directly at the target (profilePaths still points at the source). */
function readDbKeyAt(keyFilePath: string): Buffer | null {
  if (!existsSync(keyFilePath)) return null
  try {
    const blob = readFileSync(keyFilePath, 'utf8')
    if (!usesPlainDbKeyStorage() && safeStorage.isEncryptionAvailable()) {
      try {
        return Buffer.from(safeStorage.decryptString(Buffer.from(blob, 'base64')), 'base64')
      } catch {
        // plain fallback file from a prior create — try base64 below
      }
    }
    return Buffer.from(blob, 'base64')
  } catch {
    return null
  }
}

/** Open the copied DB read-only with its own copied key — proves the copy decrypts. */
function verifyCopiedProfileDb(newRoot: string, profileId: string): string | null {
  const dbPath = join(newRoot, profileId, 'moss.sqlite')
  if (!existsSync(dbPath)) return `Copied database missing for profile ${profileId}.`

  const key = readDbKeyAt(join(newRoot, profileId, 'db.key.enc'))
  // Password-wrapped profiles keep no key file; the byte-for-byte size check
  // already covers them — the wrapped key in the registry moves with the tree.
  if (!key) return null

  try {
    const database = new Database(dbPath, { readonly: true })
    try {
      applySqlCipherKey(database, key)
      verifySqlCipherKey(database)
    } finally {
      database.close()
    }
    return null
  } catch {
    return `Copied database for profile ${profileId} failed to open.`
  }
}

function verifyCopiedRegistry(newRoot: string, expectedProfiles: number): string | null {
  const registryPath = join(newRoot, 'registry.sqlite')
  if (!existsSync(registryPath)) return 'Copied profile registry is missing.'
  try {
    const database = new Database(registryPath, { readonly: true })
    try {
      const row = database.prepare('SELECT COUNT(*) AS count FROM profiles').get() as {
        count: number
      }
      if (row.count !== expectedProfiles) {
        return `Copied registry lists ${row.count} profiles, expected ${expectedProfiles}.`
      }
    } finally {
      database.close()
    }
    return null
  } catch {
    return 'Copied profile registry failed to open.'
  }
}

/** Atomic flip: tmp-write + rename for a custom root, delete for the default. */
function flipDataRootOverride(targetBase: string, isDefaultUserData: boolean): void {
  const overridePath = dataRootOverridePath()
  if (isDefaultUserData) {
    rmSync(overridePath, { force: true })
  } else {
    const tmpPath = `${overridePath}.tmp`
    writeFileSync(tmpPath, serializeDataRootOverride(targetBase), 'utf8')
    renameSync(tmpPath, overridePath)
  }
  invalidateProfilesRootCache()
}

export async function moveDataFolder(rawTarget: string): Promise<MoveDataFolderResult> {
  const userData = app.getPath('userData')
  const targetBase = resolve(rawTarget)
  const currentRoot = profilesRoot()
  const previousOverride = currentDataRootOverride()
  const isDefaultUserData = resolve(userData) === targetBase

  if (!existsSync(currentRoot)) {
    return { ok: false, error: 'No data folder to move yet.' }
  }

  const exists = existsSync(targetBase)
  const isDirectory = exists ? statSync(targetBase).isDirectory() : false
  const preflight = evaluateMoveTarget({
    targetBase,
    currentRoot,
    isDefaultUserData,
    exists,
    isDirectory,
    writable: exists && isDirectory ? probeWritable(targetBase) : false,
    entries: exists && isDirectory ? readdirSync(targetBase) : [],
    freeBytes: exists && isDirectory ? freeBytesAt(targetBase) : null,
    requiredBytes: directoryBytes(currentRoot)
  })
  if (!preflight.ok) {
    return { ok: false, error: preflight.reason }
  }
  const newRoot = preflight.newRoot

  // Everything past this point runs with all DB handles closed. Locking also
  // clears the persisted active profile — after the restart the operator picks
  // (and, with a password, unlocks) the profile again, which is the honest state.
  const profileCount = listProfiles().length
  const markerPath = join(targetBase, MOSS_DATA_MARKER)
  const markerPreexisted = existsSync(markerPath)
  lockActiveProfile()
  closeProfilesRegistry()
  // Snapshot the tree only after close — WAL/SHM sidecars checkpoint away on
  // close, and a manifest taken earlier would flag their absence as data loss.
  const sourceManifest = buildManifest(currentRoot)

  try {
    cpSync(currentRoot, newRoot, { recursive: true, force: false, errorOnExist: true })

    const comparison = compareManifests(sourceManifest, buildManifest(newRoot))
    if (!comparison.ok) throw new Error(comparison.reason)

    const registryProblem = verifyCopiedRegistry(newRoot, profileCount)
    if (registryProblem) throw new Error(registryProblem)

    for (const profile of readdirSync(newRoot, { withFileTypes: true })) {
      if (!profile.isDirectory()) continue
      const dbProblem = verifyCopiedProfileDb(newRoot, profile.name)
      if (dbProblem) throw new Error(dbProblem)
    }

    if (!isDefaultUserData) {
      writeFileSync(
        markerPath,
        `${JSON.stringify({ app: 'moss', movedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8'
      )
    }
  } catch (error) {
    // Nothing was flipped: remove the partial copy, old data is untouched.
    try {
      rmSync(newRoot, { recursive: true, force: true })
      if (!markerPreexisted) rmSync(markerPath, { force: true })
    } catch {
      // best effort — the override still points at the intact old tree
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Copy failed — your data was not moved.',
      locked: true
    }
  }

  // Verified copy in place — flip, then (and only then) delete the old tree.
  flipDataRootOverride(targetBase, isDefaultUserData)
  if (resolve(profilesRoot()) !== resolve(newRoot)) {
    // The flip did not stick (disk error on the override file). Undo it.
    try {
      if (previousOverride) flipDataRootOverride(previousOverride, false)
      else flipDataRootOverride(userData, true)
      rmSync(newRoot, { recursive: true, force: true })
      if (!markerPreexisted) rmSync(markerPath, { force: true })
    } catch {
      // best effort
    }
    return {
      ok: false,
      error: 'Could not save the new location — your data was not moved.',
      locked: true
    }
  }

  try {
    rmSync(currentRoot, { recursive: true, force: true })
    if (previousOverride) {
      // Leaving a custom dir behind: clear its marker and the dir itself when empty.
      rmSync(join(previousOverride, MOSS_DATA_MARKER), { force: true })
      const leftover = readdirSync(previousOverride)
      if (leftover.length === 0) rmSync(previousOverride, { recursive: true })
    }
  } catch {
    // Old copy cleanup is best effort — the flip already happened, data is safe.
  }

  return { ok: true, newRoot }
}
