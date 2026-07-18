/**
 * D1 — pure decision logic for the "Your data" location + move flow.
 *
 * No electron or fs imports: everything here takes plain inputs so the
 * pre-flight guards and override resolution are unit-testable (vitest runs
 * node-only). The fs/electron glue lives in dataDir.ts and profilePaths.ts.
 */
import { isAbsolute, join, relative, resolve } from 'node:path'

/** Marker file MOSS writes at a custom data-folder root so we can recognize it later. */
export const MOSS_DATA_MARKER = '.moss-data'

/** Entries that never block the "target must be empty" rule. */
const IGNORABLE_ENTRIES = new Set([MOSS_DATA_MARKER, '.DS_Store', 'desktop.ini', 'Thumbs.db'])

/** Parse userData/data-root.json — returns the override base dir or null. */
export function parseDataRootOverride(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { dataRoot?: unknown }
    if (typeof parsed.dataRoot !== 'string') return null
    const trimmed = parsed.dataRoot.trim()
    if (trimmed.length === 0 || !isAbsolute(trimmed)) return null
    return trimmed
  } catch {
    return null
  }
}

export function serializeDataRootOverride(dataRoot: string): string {
  return `${JSON.stringify({ dataRoot }, null, 2)}\n`
}

/**
 * The profiles tree lives under <override>/profiles when an override is set,
 * otherwise under <userData>/profiles (the pre-D1 layout, unchanged).
 */
export function resolveProfilesRoot(userDataDir: string, overrideRoot: string | null): string {
  return join(overrideRoot ?? userDataDir, 'profiles')
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export interface MoveTargetProbe {
  /** Directory the operator picked — the profiles tree is created inside it. */
  targetBase: string
  /** Current profiles root (…/profiles). */
  currentRoot: string
  /** True when targetBase is the app's userData dir (move back to default). */
  isDefaultUserData: boolean
  exists: boolean
  isDirectory: boolean
  writable: boolean
  /** readdir of targetBase ('' entries impossible; [] when empty). */
  entries: string[]
  /** Free bytes on the target volume; null when it could not be determined. */
  freeBytes: number | null
  /** Bytes currently used by the profiles tree. */
  requiredBytes: number
}

export type MovePreflightResult =
  | { ok: true; newRoot: string }
  | { ok: false; reason: string }

/** All pre-flight guards. Any failure here means nothing has been touched. */
export function evaluateMoveTarget(probe: MoveTargetProbe): MovePreflightResult {
  const newRoot = join(probe.targetBase, 'profiles')

  if (!probe.exists) {
    return { ok: false, reason: 'That folder does not exist.' }
  }
  if (!probe.isDirectory) {
    return { ok: false, reason: 'The chosen path is not a folder.' }
  }
  if (!probe.writable) {
    return { ok: false, reason: 'MOSS cannot write to that folder. Choose one you own.' }
  }
  if (resolve(newRoot) === resolve(probe.currentRoot)) {
    return { ok: false, reason: 'Your data is already stored there.' }
  }
  if (isPathInside(probe.currentRoot, probe.targetBase)) {
    return { ok: false, reason: 'Choose a folder outside the current data folder.' }
  }
  if (isPathInside(probe.targetBase, probe.currentRoot)) {
    return { ok: false, reason: 'The current data folder already lives inside that folder.' }
  }
  if (probe.entries.includes('profiles')) {
    return { ok: false, reason: 'That folder already contains MOSS data. Choose an empty folder.' }
  }
  if (!probe.isDefaultUserData) {
    const blocking = probe.entries.filter((entry) => !IGNORABLE_ENTRIES.has(entry))
    if (blocking.length > 0) {
      return { ok: false, reason: 'Choose an empty folder (or one MOSS created before).' }
    }
  }
  if (probe.freeBytes === null) {
    return { ok: false, reason: 'Could not determine free space on the target drive.' }
  }
  if (probe.freeBytes <= probe.requiredBytes) {
    return { ok: false, reason: 'Not enough free space on the target drive.' }
  }

  return { ok: true, newRoot }
}

export interface ManifestEntry {
  /** Path relative to the tree root, POSIX separators. */
  rel: string
  size: number
}

export type ManifestComparison = { ok: true } | { ok: false; reason: string }

/** Copy verification: every source file must exist at the target with the same size. */
export function compareManifests(
  source: ManifestEntry[],
  target: ManifestEntry[]
): ManifestComparison {
  if (source.length !== target.length) {
    return {
      ok: false,
      reason: `File count mismatch: expected ${source.length}, found ${target.length}.`
    }
  }
  const targetSizes = new Map(target.map((entry) => [entry.rel, entry.size]))
  for (const entry of source) {
    const copied = targetSizes.get(entry.rel)
    if (copied === undefined) {
      return { ok: false, reason: `Missing file in copy: ${entry.rel}` }
    }
    if (copied !== entry.size) {
      return {
        ok: false,
        reason: `Size mismatch for ${entry.rel}: expected ${entry.size}, found ${copied}.`
      }
    }
  }
  return { ok: true }
}
