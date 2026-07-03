import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSetting = vi.fn<() => { value: string } | null>(() => null)

vi.mock('../src/main/database', () => ({
  getSetting: (...args: unknown[]) => getSetting(...args)
}))

import {
  LOCALAI_CAPTURE_ENABLED_SETTING,
  LOCALAI_ENABLED_SETTING,
  LOCALAI_MODEL_SETTING,
  LEGACY_ENABLED_SETTING,
  LEGACY_MODEL_SETTING,
  PREFERRED_MODELS,
  isLocalLlmEnabled,
  isSurfaceLlmEnabled,
  pickPreferredModel,
  probeOllama,
  resetLocalLlmProbe
} from '../src/main/localLlm'

const INSTALLED = [
  'phi3:mini',
  'mistral:7b',
  'gemma3:4b',
  'qwen3:4b',
  'llama3.2:3b',
  'llama3.1:8b'
]

describe('pickPreferredModel', () => {
  beforeEach(() => {
    getSetting.mockReset()
    getSetting.mockReturnValue(null)
  })

  it('follows PREFERRED_MODELS prefix order over install list order', () => {
    expect(pickPreferredModel(INSTALLED)).toBe('llama3.2:3b')
  })

  it('prefers gemma3 and qwen3 ahead of mistral and phi3', () => {
    const subset = ['phi3:mini', 'mistral:7b', 'gemma3:4b', 'qwen3:4b']
    expect(pickPreferredModel(subset)).toBe('gemma3:4b')
  })

  it('exposes the expected preference order including new models before mistral/phi3', () => {
    expect(PREFERRED_MODELS.indexOf('gemma3')).toBeLessThan(PREFERRED_MODELS.indexOf('mistral'))
    expect(PREFERRED_MODELS.indexOf('qwen3')).toBeLessThan(PREFERRED_MODELS.indexOf('phi3'))
    // beta.4: qwen3.5 leads (matches the bundled model); llama3.2 stays next.
    expect(PREFERRED_MODELS[0]).toBe('qwen3.5')
    expect(PREFERRED_MODELS[1]).toBe('llama3.2')
  })

  it('does not let the qwen3.5 entry shadow qwen3-only installs', () => {
    // 'qwen3.5' must not prefix-match a plain qwen3 tag…
    expect(pickPreferredModel(['phi3:mini', 'qwen3:4b'])).toBe('qwen3:4b')
    // …and a qwen3.5 install wins over everything else.
    expect(pickPreferredModel([...INSTALLED, 'qwen3.5:4b'])).toBe('qwen3.5:4b')
  })

  it('honors a configured model prefix when it matches an installed tag', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_MODEL_SETTING) return { value: 'qwen3' }
      return null
    })
    expect(pickPreferredModel(INSTALLED)).toBe('qwen3:4b')
  })
})

describe('localai settings fallback', () => {
  beforeEach(() => {
    getSetting.mockReset()
    resetLocalLlmProbe()
  })

  it('reads legacy enabled key when localai.enabled is unset', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_ENABLED_SETTING) return null
      if (key === LEGACY_ENABLED_SETTING) return { value: '0' }
      return null
    })
    expect(isLocalLlmEnabled()).toBe(false)
  })

  it('prefers localai.enabled over the legacy key', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_ENABLED_SETTING) return { value: '1' }
      if (key === LEGACY_ENABLED_SETTING) return { value: '0' }
      return null
    })
    expect(isLocalLlmEnabled()).toBe(true)
  })

  it('reads legacy model key when localai.model is unset', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_MODEL_SETTING) return null
      if (key === LEGACY_MODEL_SETTING) return { value: 'mistral' }
      return null
    })
    expect(pickPreferredModel(INSTALLED)).toBe('mistral:7b')
  })

  it('prefers localai.model over the legacy key', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_MODEL_SETTING) return { value: 'qwen3' }
      if (key === LEGACY_MODEL_SETTING) return { value: 'mistral' }
      return null
    })
    expect(pickPreferredModel(INSTALLED)).toBe('qwen3:4b')
  })
})

describe('isSurfaceLlmEnabled', () => {
  beforeEach(() => {
    getSetting.mockReset()
    delete process.env.MOSS_HEADLESS_USER_DATA
  })

  it('returns false when the master toggle is off', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_ENABLED_SETTING) return { value: '0' }
      return null
    })
    expect(isSurfaceLlmEnabled('capture')).toBe(false)
    expect(isSurfaceLlmEnabled('money')).toBe(false)
  })

  it('returns false when a surface toggle is off', () => {
    getSetting.mockImplementation((key: string) => {
      if (key === LOCALAI_CAPTURE_ENABLED_SETTING) return { value: '0' }
      return null
    })
    expect(isSurfaceLlmEnabled('capture')).toBe(false)
    expect(isSurfaceLlmEnabled('money')).toBe(true)
  })

  it('returns true by default when toggles are unset', () => {
    getSetting.mockReturnValue(null)
    expect(isSurfaceLlmEnabled('capture')).toBe(true)
  })

  it('returns false under MOSS_HEADLESS_USER_DATA', () => {
    process.env.MOSS_HEADLESS_USER_DATA = '/tmp/headless'
    getSetting.mockReturnValue(null)
    expect(isSurfaceLlmEnabled('capture')).toBe(false)
  })
})

describe('probeOllama cache', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    getSetting.mockReset()
    getSetting.mockReturnValue(null)
    resetLocalLlmProbe()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the cached probe result within the cache window', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:3b' }] })
    })

    const first = await probeOllama()
    const second = await probeOllama()

    expect(first).toEqual({ model: 'llama3.2:3b', error: null })
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags')
  })

  it('re-probes after resetLocalLlmProbe clears the cache', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:3b' }] })
    })

    await probeOllama()
    resetLocalLlmProbe()
    await probeOllama()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
