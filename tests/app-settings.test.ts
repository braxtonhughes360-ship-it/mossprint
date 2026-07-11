import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  mergeAppSettings,
  parseAppSettings
} from '../src/shared/appSettings'

describe('parseAppSettings', () => {
  it('defaults keepInMenuBar to false', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('{}')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(JSON.stringify({ keepInMenuBar: false }))).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('accepts keepInMenuBar true only when boolean true', () => {
    expect(parseAppSettings(JSON.stringify({ keepInMenuBar: true })).keepInMenuBar).toBe(true)
    expect(parseAppSettings(JSON.stringify({ keepInMenuBar: 'true' })).keepInMenuBar).toBe(false)
  })

  it('falls back on invalid JSON', () => {
    expect(parseAppSettings('{not json')).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('defaults the LA7 model-download fields', () => {
    const parsed = parseAppSettings('{}')
    expect(parsed.localAiModelConsent).toBe('pending')
    expect(parsed.localAiWarmCallMs).toBeNull()
  })

  it('accepts only known consent values', () => {
    expect(parseAppSettings(JSON.stringify({ localAiModelConsent: 'accepted' })).localAiModelConsent).toBe(
      'accepted'
    )
    expect(parseAppSettings(JSON.stringify({ localAiModelConsent: 'later' })).localAiModelConsent).toBe(
      'later'
    )
    // Anything unexpected collapses back to the safe default (no silent download).
    expect(parseAppSettings(JSON.stringify({ localAiModelConsent: 'yes' })).localAiModelConsent).toBe(
      'pending'
    )
    expect(parseAppSettings(JSON.stringify({ localAiModelConsent: 5 })).localAiModelConsent).toBe(
      'pending'
    )
  })

  it('accepts only a finite, non-negative warm-call time', () => {
    expect(parseAppSettings(JSON.stringify({ localAiWarmCallMs: 3200 })).localAiWarmCallMs).toBe(3200)
    expect(parseAppSettings(JSON.stringify({ localAiWarmCallMs: 0 })).localAiWarmCallMs).toBe(0)
    expect(parseAppSettings(JSON.stringify({ localAiWarmCallMs: -1 })).localAiWarmCallMs).toBeNull()
    expect(parseAppSettings(JSON.stringify({ localAiWarmCallMs: 'slow' })).localAiWarmCallMs).toBeNull()
  })
})

describe('mergeAppSettings', () => {
  it('patches keepInMenuBar', () => {
    expect(mergeAppSettings(DEFAULT_APP_SETTINGS, { keepInMenuBar: true }).keepInMenuBar).toBe(true)
  })

  it('patches consent without touching unrelated fields', () => {
    const current = { ...DEFAULT_APP_SETTINGS, keepInMenuBar: true }
    const next = mergeAppSettings(current, { localAiModelConsent: 'accepted' })
    expect(next.localAiModelConsent).toBe('accepted')
    expect(next.keepInMenuBar).toBe(true)
  })

  it('lets warm-call time be reset to null explicitly', () => {
    const current = { ...DEFAULT_APP_SETTINGS, localAiWarmCallMs: 3200 }
    expect(mergeAppSettings(current, { localAiWarmCallMs: null }).localAiWarmCallMs).toBeNull()
    // An absent patch key preserves the current value.
    expect(mergeAppSettings(current, { keepInMenuBar: true }).localAiWarmCallMs).toBe(3200)
  })
})
