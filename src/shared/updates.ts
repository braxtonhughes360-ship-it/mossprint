/**
 * Shared types for the app updater (V2 Phase R4).
 *
 * Two delivery modes, decided in the main process:
 * - 'auto'   — electron-updater downloads the release in the background
 *              (Windows NSIS, Linux AppImage). Never restarts on its own;
 *              the renderer offers "Restart to update".
 * - 'notify' — version check only, via the GitHub releases API
 *              (macOS unsigned builds, Linux deb, dev builds). The renderer
 *              offers a Download link to the releases page.
 */

export type UpdateMode = 'auto' | 'notify'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'ready-to-install'
  | 'error'

export interface UpdateState {
  currentVersion: string
  mode: UpdateMode
  status: UpdateStatus
  /** ISO timestamp of the last completed check (success or failure). */
  lastCheckedAt: string | null
  /** Newest published version, when one is known. */
  latestVersion: string | null
  /** Releases page for the newest version (notify mode). */
  downloadUrl: string | null
  /** Human-readable problem description when status is 'error'. */
  message: string | null
}

interface ParsedVersion {
  release: [number, number, number]
  prerelease: string[]
}

/** Parse "v0.9.2" / "0.9.0-beta.1" → comparable parts. Returns null when unparseable. */
export function parseVersion(raw: string): ParsedVersion | null {
  const trimmed = raw.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(trimmed)
  if (!match) return null
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

/** semver precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(rawA: string, rawB: string): number {
  const a = parseVersion(rawA)
  const b = parseVersion(rawB)
  if (!a || !b) return 0

  for (let i = 0; i < 3; i += 1) {
    if (a.release[i] !== b.release[i]) return a.release[i]! - b.release[i]!
  }

  // A release outranks any of its prereleases (1.0.0 > 1.0.0-beta.1).
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i += 1) {
    const partA = a.prerelease[i]
    const partB = b.prerelease[i]
    // Shorter prerelease list sorts first (beta < beta.1).
    if (partA === undefined) return -1
    if (partB === undefined) return 1
    const numA = /^\d+$/.test(partA) ? Number(partA) : null
    const numB = /^\d+$/.test(partB) ? Number(partB) : null
    // Numeric identifiers sort below alphanumeric ones (1 < beta).
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB
    } else if (numA !== null) {
      return -1
    } else if (numB !== null) {
      return 1
    } else if (partA !== partB) {
      return partA < partB ? -1 : 1
    }
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
