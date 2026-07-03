/** Surfaces that can opt out of LLM fallback independently (plan §2.5). */
export type LocalAiSurface = 'capture' | 'money' | 'nutrition' | 'calendar'

export const LOCALAI_SETTING_KEYS = {
  model: 'localai.model',
  enabled: 'localai.enabled',
  capture: 'localai.capture.enabled',
  money: 'localai.money.enabled',
  nutrition: 'localai.nutrition.enabled',
  calendar: 'localai.calendar.enabled'
} as const

/** Where structured calls are being served from. */
export type LocalAiRuntimeSource = 'ollama' | 'bundled' | 'none'

export type LocalAiDownloadStatus =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error'

export interface LocalAiDownloadState {
  status: LocalAiDownloadStatus
  receivedBytes: number
  totalBytes: number
  /** Plain-language failure line; null unless status === 'error'. */
  error: string | null
}

export interface LocalAiRuntimeState {
  /** True when the bundled llama.cpp runtime binary is present on this install. */
  bundledAvailable: boolean
  /** Consent state for the one-time model download. */
  consent: 'pending' | 'later' | 'accepted'
  download: LocalAiDownloadState
  /** Which engine answered the probe. */
  source: LocalAiRuntimeSource
  /** Warm structured-call duration (ms) from the honesty check; null = unmeasured. */
  warmCallMs: number | null
}

export interface LocalAiPanelState {
  /** Picked model tag when smart parsing can run; null when unavailable or disabled. */
  model: string | null
  error: string | null
  installedModels: string[]
  masterEnabled: boolean
  /** Stored toggle values (default true when unset). */
  surfaces: Record<LocalAiSurface, boolean>
  configuredModel: string | null
  runtime: LocalAiRuntimeState
}

/** Approximate size of the bundled model download, for consent copy. */
export const LOCALAI_MODEL_DOWNLOAD_GB = 2.7

/** Warm-call bar (ms): slower than this and the panel says the machine is slow. */
export const LOCALAI_WARM_CALL_BAR_MS = 4000

/** Friendly model label for status copy (strip tag suffix when present). */
export function formatLocalAiModelLabel(model: string): string {
  const colon = model.indexOf(':')
  return colon > 0 ? model.slice(0, colon) : model
}
