/** Surfaces that can opt out of LLM fallback independently (plan §2.5). */
export type LocalAiSurface = 'capture' | 'money' | 'nutrition' | 'calendar'

export const LOCALAI_SETTING_KEYS = {
  model: 'localai.model',
  enabled: 'localai.enabled',
  /**
   * 'ollama' = the user explicitly chose their own Ollama over the bundled
   * default (written ONLY by the beta.5 settings panel). Absent/other = bundled
   * first. A pre-beta.5 localai.model value alone never expresses this intent —
   * the old dropdown existed before there was a bundled model to prefer.
   */
  engine: 'localai.engine',
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
  /** 'ollama' when the user explicitly chose their own Ollama (QA2-04: lets the
   * panel say so honestly when that Ollama has since gone away). */
  enginePreference: 'ollama' | null
  runtime: LocalAiRuntimeState
}

/** Approximate size of the bundled model download, for consent copy. */
export const LOCALAI_MODEL_DOWNLOAD_GB = 2.7

/** Tag the bundled runtime reports (localRuntime.BUNDLED_MODEL.tag mirrors this). */
export const LOCALAI_BUNDLED_MODEL_TAG = 'qwen3.5:built-in'

/**
 * Sentinel select value for "use MOSS's built-in model" in the settings panel.
 * Writing it clears the localai.model override (empty string) — never stored as-is.
 */
export const LOCALAI_USE_BUILTIN_VALUE = '__moss-builtin__'

/** Warm-call bar (ms): slower than this and the panel says the machine is slow. */
export const LOCALAI_WARM_CALL_BAR_MS = 4000

/** Friendly model label for status copy (strip tag suffix when present). */
export function formatLocalAiModelLabel(model: string): string {
  const colon = model.indexOf(':')
  return colon > 0 ? model.slice(0, colon) : model
}
