/** Consent state for the bundled local-AI model download (per-machine, not per-profile). */
export type LocalAiModelConsent = 'pending' | 'later' | 'accepted'

export interface MossAppSettings {
  /** When true, closing the main window hides to the menu bar tray instead of quitting. */
  keepInMenuBar: boolean
  /** Bundled local-AI model download consent — 'later' re-offers, 'accepted' downloads. */
  localAiModelConsent: LocalAiModelConsent
  /**
   * Warm structured-call duration from the per-machine honesty check (ms).
   * null = not measured yet. Over the ~4s bar → the Local AI panel says so.
   */
  localAiWarmCallMs: number | null
}

export const DEFAULT_APP_SETTINGS: MossAppSettings = {
  keepInMenuBar: false,
  localAiModelConsent: 'pending',
  localAiWarmCallMs: null
}

function parseConsent(value: unknown): LocalAiModelConsent {
  return value === 'later' || value === 'accepted' ? value : 'pending'
}

function parseWarmCallMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function parseAppSettings(raw: string | null | undefined): MossAppSettings {
  if (!raw) return { ...DEFAULT_APP_SETTINGS }

  try {
    const parsed = JSON.parse(raw) as Partial<MossAppSettings>
    return {
      keepInMenuBar: parsed.keepInMenuBar === true,
      localAiModelConsent: parseConsent(parsed.localAiModelConsent),
      localAiWarmCallMs: parseWarmCallMs(parsed.localAiWarmCallMs)
    }
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

export function mergeAppSettings(
  current: MossAppSettings,
  patch: Partial<MossAppSettings>
): MossAppSettings {
  return {
    keepInMenuBar: patch.keepInMenuBar ?? current.keepInMenuBar,
    localAiModelConsent: patch.localAiModelConsent ?? current.localAiModelConsent,
    localAiWarmCallMs:
      patch.localAiWarmCallMs !== undefined ? patch.localAiWarmCallMs : current.localAiWarmCallMs
  }
}
