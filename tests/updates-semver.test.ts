import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion, parseVersion } from '../src/shared/updates'

describe('parseVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseVersion('0.9.2')).toEqual({ release: [0, 9, 2], prerelease: [] })
    expect(parseVersion('v1.2.3')).toEqual({ release: [1, 2, 3], prerelease: [] })
  })

  it('parses prerelease identifiers', () => {
    expect(parseVersion('0.9.0-beta.1')).toEqual({ release: [0, 9, 0], prerelease: ['beta', '1'] })
  })

  it('returns null for garbage', () => {
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders releases numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.9.2', '0.9.2')).toBe(0)
  })

  it('ranks a release above its own prereleases', () => {
    expect(compareVersions('0.9.0', '0.9.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0-beta.1', '0.9.0')).toBeLessThan(0)
  })

  it('orders prereleases per semver precedence', () => {
    expect(compareVersions('0.9.0-beta.2', '0.9.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0-beta.10', '0.9.0-beta.9')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0-beta', '0.9.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('0.9.0-alpha.1', '0.9.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('0.9.0-1', '0.9.0-beta')).toBeLessThan(0)
  })
})

describe('isNewerVersion', () => {
  it('drives the notify-mode banner decision', () => {
    expect(isNewerVersion('0.9.2', '0.9.1')).toBe(true)
    expect(isNewerVersion('v0.9.2', '0.9.2')).toBe(false)
    expect(isNewerVersion('0.9.0-beta.2', '0.9.0-beta.1')).toBe(true)
    // Unparseable tags never trigger a false "update available".
    expect(isNewerVersion('nightly', '0.9.1')).toBe(false)
  })
})
