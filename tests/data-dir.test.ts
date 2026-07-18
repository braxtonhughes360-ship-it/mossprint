import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  MOSS_DATA_MARKER,
  compareManifests,
  evaluateMoveTarget,
  isPathInside,
  parseDataRootOverride,
  resolveProfilesRoot,
  serializeDataRootOverride,
  type MoveTargetProbe
} from '../src/main/dataDirCore'

const USER_DATA = '/Users/op/Library/Application Support/moss'

describe('parseDataRootOverride', () => {
  it('reads a valid override', () => {
    expect(parseDataRootOverride('{"dataRoot":"/Volumes/Vault/MOSS"}')).toBe('/Volumes/Vault/MOSS')
  })

  it('round-trips through serialize', () => {
    expect(parseDataRootOverride(serializeDataRootOverride('/Volumes/Vault/MOSS'))).toBe(
      '/Volumes/Vault/MOSS'
    )
  })

  it('rejects missing, empty, relative, and malformed values', () => {
    expect(parseDataRootOverride(null)).toBeNull()
    expect(parseDataRootOverride('')).toBeNull()
    expect(parseDataRootOverride('{}')).toBeNull()
    expect(parseDataRootOverride('{"dataRoot":""}')).toBeNull()
    expect(parseDataRootOverride('{"dataRoot":"   "}')).toBeNull()
    expect(parseDataRootOverride('{"dataRoot":"relative/path"}')).toBeNull()
    expect(parseDataRootOverride('{"dataRoot":42}')).toBeNull()
    expect(parseDataRootOverride('{not json')).toBeNull()
  })
})

describe('resolveProfilesRoot', () => {
  it('defaults to userData/profiles without an override', () => {
    expect(resolveProfilesRoot(USER_DATA, null)).toBe(join(USER_DATA, 'profiles'))
  })

  it('resolves through the override when set', () => {
    expect(resolveProfilesRoot(USER_DATA, '/Volumes/Vault/MOSS')).toBe(
      '/Volumes/Vault/MOSS/profiles'
    )
  })
})

describe('isPathInside', () => {
  it('detects containment and rejects siblings and self', () => {
    expect(isPathInside('/a/b', '/a/b/c')).toBe(true)
    expect(isPathInside('/a/b', '/a/b/c/d')).toBe(true)
    expect(isPathInside('/a/b', '/a/b')).toBe(false)
    expect(isPathInside('/a/b', '/a/bc')).toBe(false)
    expect(isPathInside('/a/b/c', '/a/b')).toBe(false)
  })
})

function probe(overrides: Partial<MoveTargetProbe> = {}): MoveTargetProbe {
  return {
    targetBase: '/Volumes/Vault/MOSS',
    currentRoot: join(USER_DATA, 'profiles'),
    isDefaultUserData: false,
    exists: true,
    isDirectory: true,
    writable: true,
    entries: [],
    freeBytes: 10_000_000,
    requiredBytes: 1_000_000,
    ...overrides
  }
}

describe('evaluateMoveTarget pre-flight', () => {
  it('accepts an empty writable folder with room', () => {
    const result = evaluateMoveTarget(probe())
    expect(result).toEqual({ ok: true, newRoot: '/Volumes/Vault/MOSS/profiles' })
  })

  it('accepts a folder that only carries the MOSS marker and OS litter', () => {
    expect(evaluateMoveTarget(probe({ entries: [MOSS_DATA_MARKER, '.DS_Store'] })).ok).toBe(true)
  })

  it('rejects a missing or non-directory target', () => {
    expect(evaluateMoveTarget(probe({ exists: false }))).toMatchObject({ ok: false })
    expect(evaluateMoveTarget(probe({ isDirectory: false }))).toMatchObject({ ok: false })
  })

  it('rejects an unwritable target', () => {
    expect(evaluateMoveTarget(probe({ writable: false }))).toMatchObject({ ok: false })
  })

  it('rejects moving to the place data already lives', () => {
    const result = evaluateMoveTarget(
      probe({ targetBase: USER_DATA, currentRoot: join(USER_DATA, 'profiles') })
    )
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('already stored') })
  })

  it('rejects a target inside the current data tree (recursive copy)', () => {
    const result = evaluateMoveTarget(
      probe({ targetBase: join(USER_DATA, 'profiles', 'nested') })
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a target that already contains a profiles folder', () => {
    const result = evaluateMoveTarget(probe({ entries: ['profiles'] }))
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('MOSS data') })
  })

  it('rejects a non-empty folder without the marker', () => {
    expect(evaluateMoveTarget(probe({ entries: ['tax-returns.pdf'] }))).toMatchObject({
      ok: false
    })
  })

  it('lets the default userData dir through the empty rule (move back)', () => {
    const result = evaluateMoveTarget(
      probe({
        targetBase: USER_DATA,
        currentRoot: '/Volumes/Vault/MOSS/profiles',
        isDefaultUserData: true,
        entries: ['app-settings.json', 'local-ai', 'data-root.json']
      })
    )
    expect(result).toEqual({ ok: true, newRoot: join(USER_DATA, 'profiles') })
  })

  it('still blocks move-back when a profiles dir already exists at default', () => {
    const result = evaluateMoveTarget(
      probe({
        targetBase: USER_DATA,
        currentRoot: '/Volumes/Vault/MOSS/profiles',
        isDefaultUserData: true,
        entries: ['app-settings.json', 'profiles']
      })
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects unknown or insufficient free space', () => {
    expect(evaluateMoveTarget(probe({ freeBytes: null }))).toMatchObject({ ok: false })
    expect(evaluateMoveTarget(probe({ freeBytes: 1_000_000 }))).toMatchObject({ ok: false })
    expect(evaluateMoveTarget(probe({ freeBytes: 999_999 }))).toMatchObject({ ok: false })
  })
})

describe('compareManifests', () => {
  const source = [
    { rel: 'registry.sqlite', size: 4096 },
    { rel: 'abc/moss.sqlite', size: 1_048_576 },
    { rel: 'abc/db.key.enc', size: 220 }
  ]

  it('passes on an identical copy', () => {
    expect(compareManifests(source, [...source].reverse())).toEqual({ ok: true })
  })

  it('fails on a missing file', () => {
    const target = source.slice(0, 2)
    expect(compareManifests(source, target)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('count')
    })
  })

  it('fails on a renamed file even when counts match', () => {
    const target = [...source.slice(0, 2), { rel: 'abc/db.key', size: 220 }]
    expect(compareManifests(source, target)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Missing')
    })
  })

  it('fails on a size mismatch (truncated copy)', () => {
    const target = [...source.slice(0, 2), { rel: 'abc/db.key.enc', size: 100 }]
    expect(compareManifests(source, target)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Size mismatch')
    })
  })
})
