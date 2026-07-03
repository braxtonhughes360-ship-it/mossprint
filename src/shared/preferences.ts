export type ColorMode = 'light' | 'dark' | 'auto'
export type MotionIntensity = 'full' | 'reduced' | 'off'
export type InterfaceDensity = 'compact' | 'comfortable' | 'spacious'
export type AmbientIntensity = 'off' | 'low' | 'standard'
export type AccentPalette = 'moss' | 'ember' | 'slate'

export interface ModulePreferences {
  /** `academicsEnabled` gates the opt-in student layer (classes/exams/assignments) — off by default. */
  calendar: { enabled: boolean; academicsEnabled: boolean }
  money: { enabled: boolean; investmentsEnabled: boolean; advancedToolsEnabled: boolean }
  nutrition: { enabled: boolean }
  inbox: { enabled: boolean }
  notes: { enabled: boolean }
  news: {
    enabled: boolean
    maxItems: number
    widgetLayout: NewsWidgetLayout
    briefingMode: NewsBriefingMode
    maxPerSource: number
  }
}

export interface ProfilePreferences {
  displayName: string
}

export const SETUP_MANAGER_VERSION = 1

export interface SetupPreferences {
  completedAt: string | null
  version: number | null
}

export interface MossPreferences {
  colorMode: ColorMode
  motionIntensity: MotionIntensity
  density: InterfaceDensity
  ambientIntensity: AmbientIntensity
  accentPalette: AccentPalette
  profile: ProfilePreferences
  setup: SetupPreferences
  modules: ModulePreferences
}

export const PREFERENCES_STORAGE_KEY = 'moss.preferences.v1'

export function preferencesStorageKey(profileId?: string | null): string {
  if (profileId) return `${PREFERENCES_STORAGE_KEY}.${profileId}`
  return PREFERENCES_STORAGE_KEY
}

/** Step 1 climates — each hue is emotionally distinct. */
export const DENSITY_PRESETS: Record<
  InterfaceDensity,
  { label: string; description: string; preview: 'cockpit' | 'studio' | 'gallery' }
> = {
  compact: {
    label: 'Cockpit',
    description: 'Dense instrument panel — smaller type, tighter gaps.',
    preview: 'cockpit'
  },
  comfortable: {
    label: 'Studio',
    description: 'Balanced daily default.',
    preview: 'studio'
  },
  spacious: {
    label: 'Gallery',
    description: 'Editorial spread — larger hero, taller doors.',
    preview: 'gallery'
  }
}

export const ACCENT_PALETTES: Record<
  AccentPalette,
  { label: string; hue: number; description: string }
> = {
  moss: {
    label: 'Moss',
    hue: 145,
    description: 'Mineral living green — default identity'
  },
  ember: {
    label: 'Ember',
    hue: 32,
    description: 'Rust copper warmth'
  },
  slate: {
    label: 'Slate',
    hue: 220,
    description: 'Cold stone precision'
  }
}

export const DEFAULT_MODULE_PREFERENCES: ModulePreferences = {
  calendar: { enabled: true, academicsEnabled: false },
  money: { enabled: true, investmentsEnabled: false, advancedToolsEnabled: false },
  nutrition: { enabled: true },
  inbox: { enabled: true },
  notes: { enabled: true },
  news: { enabled: true, maxItems: 9, widgetLayout: 'split', briefingMode: 'balanced', maxPerSource: 2 }
}

export const DEFAULT_SETUP_PREFERENCES: SetupPreferences = {
  completedAt: null,
  version: null
}

export const DEFAULT_PREFERENCES: MossPreferences = {
  colorMode: 'light',
  motionIntensity: 'full',
  density: 'comfortable',
  ambientIntensity: 'low',
  accentPalette: 'moss',
  profile: { displayName: '' },
  setup: { ...DEFAULT_SETUP_PREFERENCES },
  modules: { ...DEFAULT_MODULE_PREFERENCES }
}

function normalizeProfile(value: unknown): ProfilePreferences {
  const parsed = (value && typeof value === 'object' ? value : {}) as Partial<ProfilePreferences>
  const displayName =
    typeof parsed.displayName === 'string' ? parsed.displayName.trim().slice(0, 64) : ''
  return { displayName }
}

function normalizeSetup(value: unknown): SetupPreferences {
  const parsed = (value && typeof value === 'object' ? value : {}) as Partial<SetupPreferences>
  const completedAt =
    typeof parsed.completedAt === 'string' && parsed.completedAt.trim()
      ? parsed.completedAt.trim()
      : null
  const version =
    typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : null
  return { completedAt, version }
}

/** Deep-enough clone for React state — avoids mutating DEFAULT_PREFERENCES.profile. */
export function clonePreferences(prefs: MossPreferences): MossPreferences {
  return {
    ...prefs,
    profile: { ...prefs.profile },
    setup: { ...(prefs.setup ?? DEFAULT_SETUP_PREFERENCES) },
    modules: mergeModulePreferences(DEFAULT_MODULE_PREFERENCES, prefs.modules)
  }
}

function normalizeModulePreferences(value: unknown): ModulePreferences {
  const parsed = (value && typeof value === 'object' ? value : {}) as Partial<ModulePreferences>

  return {
    calendar: {
      enabled: parsed.calendar?.enabled ?? DEFAULT_MODULE_PREFERENCES.calendar.enabled,
      academicsEnabled:
        parsed.calendar?.academicsEnabled ?? DEFAULT_MODULE_PREFERENCES.calendar.academicsEnabled
    },
    money: {
      enabled: parsed.money?.enabled ?? DEFAULT_MODULE_PREFERENCES.money.enabled,
      investmentsEnabled:
        parsed.money?.investmentsEnabled ?? DEFAULT_MODULE_PREFERENCES.money.investmentsEnabled,
      advancedToolsEnabled:
        parsed.money?.advancedToolsEnabled ?? DEFAULT_MODULE_PREFERENCES.money.advancedToolsEnabled
    },
    nutrition: {
      enabled: parsed.nutrition?.enabled ?? DEFAULT_MODULE_PREFERENCES.nutrition.enabled
    },
    inbox: {
      enabled: parsed.inbox?.enabled ?? DEFAULT_MODULE_PREFERENCES.inbox.enabled
    },
    notes: {
      enabled: parsed.notes?.enabled ?? DEFAULT_MODULE_PREFERENCES.notes.enabled
    },
    news: {
      enabled: parsed.news?.enabled ?? DEFAULT_MODULE_PREFERENCES.news.enabled,
      maxItems:
        parsed.news?.maxItems === 5 ||
        parsed.news?.maxItems === 6 ||
        parsed.news?.maxItems === 7 ||
        parsed.news?.maxItems === 8
          ? 9
          : [9, 10, 11, 12].includes(parsed.news?.maxItems ?? 0)
            ? (parsed.news!.maxItems as 9 | 10 | 11 | 12)
            : DEFAULT_MODULE_PREFERENCES.news.maxItems,
      widgetLayout:
        parsed.news?.widgetLayout === 'compact' ||
        parsed.news?.widgetLayout === 'split' ||
        parsed.news?.widgetLayout === 'full'
          ? parsed.news.widgetLayout
          : DEFAULT_MODULE_PREFERENCES.news.widgetLayout,
      briefingMode:
        parsed.news?.briefingMode === 'latest' ||
        parsed.news?.briefingMode === 'priority' ||
        parsed.news?.briefingMode === 'balanced'
          ? parsed.news.briefingMode
          : DEFAULT_MODULE_PREFERENCES.news.briefingMode,
      maxPerSource:
        parsed.news?.maxPerSource === 1 || parsed.news?.maxPerSource === 3
          ? 2
          : parsed.news?.maxPerSource === 2
            ? 2
            : DEFAULT_MODULE_PREFERENCES.news.maxPerSource,
    }
  }
}

export function mergeModulePreferences(
  current: ModulePreferences,
  patch: Partial<ModulePreferences>
): ModulePreferences {
  return {
    calendar: { ...current.calendar, ...patch.calendar },
    money: { ...current.money, ...patch.money },
    nutrition: { ...current.nutrition, ...patch.nutrition },
    inbox: { ...current.inbox, ...patch.inbox },
    notes: { ...current.notes, ...patch.notes },
    news: { ...current.news, ...patch.news }
  }
}

export function mergePreferences(
  current: MossPreferences,
  patch: Partial<Omit<MossPreferences, 'modules' | 'profile' | 'setup'>> & {
    modules?: Partial<ModulePreferences>
    profile?: Partial<ProfilePreferences>
    setup?: Partial<SetupPreferences>
  }
): MossPreferences {
  const baseProfile = current.profile ?? DEFAULT_PREFERENCES.profile
  const baseSetup = current.setup ?? DEFAULT_SETUP_PREFERENCES
  return {
    ...current,
    ...patch,
    profile: patch.profile
      ? { ...baseProfile, ...patch.profile }
      : { ...baseProfile },
    setup: patch.setup ? { ...baseSetup, ...patch.setup } : { ...baseSetup },
    modules: patch.modules ? mergeModulePreferences(current.modules, patch.modules) : current.modules
  }
}

import type { AppRouteId } from '@shared/types'
import type { NewsBriefingMode, NewsWidgetLayout } from '@shared/news'

export type ModuleNavId = keyof Pick<
  ModulePreferences,
  'calendar' | 'money' | 'nutrition' | 'inbox' | 'notes'
>

export function isModuleNavEnabled(modules: ModulePreferences, moduleId: AppRouteId): boolean {
  if (moduleId === 'dashboard' || moduleId === 'settings') {
    return true
  }

  return modules[moduleId].enabled
}

type LegacyMotion = 'standard' | 'expressive' | MotionIntensity
type LegacyAccent = 'sage' | 'dust' | 'mineral' | 'chalk' | AccentPalette

function normalizeMotionIntensity(value: unknown): MotionIntensity {
  if (value === 'full' || value === 'reduced' || value === 'off') return value
  if (value === 'standard' || value === 'expressive') return 'full'
  return DEFAULT_PREFERENCES.motionIntensity
}

function normalizeDensity(value: unknown): InterfaceDensity {
  if (value === 'compact' || value === 'comfortable' || value === 'spacious') return value
  return DEFAULT_PREFERENCES.density
}

function normalizeAccentPalette(value: unknown): AccentPalette {
  if (value === 'moss' || value === 'ember' || value === 'slate') return value
  if (value === 'sage') return 'moss'
  if (value === 'mineral') return 'slate'
  if (value === 'dust' || value === 'chalk') return 'moss'
  return DEFAULT_PREFERENCES.accentPalette
}

export function parsePreferences(raw: string | null | undefined): MossPreferences {
  if (!raw) return clonePreferences(DEFAULT_PREFERENCES)

  try {
    const parsed = JSON.parse(raw) as Partial<MossPreferences> & {
      motionIntensity?: LegacyMotion
      accentPalette?: LegacyAccent
    }

    const legacyInstall = !('setup' in parsed)

    return clonePreferences({
      ...DEFAULT_PREFERENCES,
      ...parsed,
      motionIntensity: normalizeMotionIntensity(parsed.motionIntensity),
      accentPalette: normalizeAccentPalette(parsed.accentPalette),
      density: normalizeDensity(parsed.density),
      profile: normalizeProfile(parsed.profile),
      setup: legacyInstall
        ? { completedAt: new Date(0).toISOString(), version: null }
        : normalizeSetup(parsed.setup),
      modules: normalizeModulePreferences(parsed.modules)
    })
  } catch {
    return clonePreferences(DEFAULT_PREFERENCES)
  }
}

export function loadPreferences(profileId?: string | null): MossPreferences {
  try {
    const raw = localStorage.getItem(preferencesStorageKey(profileId))
    return parsePreferences(raw)
  } catch {
    return clonePreferences(DEFAULT_PREFERENCES)
  }
}

export function savePreferences(prefs: MossPreferences, profileId?: string | null): void {
  localStorage.setItem(preferencesStorageKey(profileId), JSON.stringify(prefs))
}

export async function loadPreferencesFromStore(profileId?: string | null): Promise<MossPreferences> {
  const fromLocal = loadPreferences(profileId)

  try {
    if (window.moss?.db) {
      const record = await window.moss.db.getSetting(PREFERENCES_STORAGE_KEY)
      if (record?.value) {
        const fromDb = parsePreferences(record.value)
        const displayName =
          fromDb.profile.displayName.trim() || fromLocal.profile.displayName.trim()
        return mergePreferences(fromDb, { profile: { displayName } })
      }
    }
  } catch {
    // fall through to local fallback
  }

  return fromLocal
}

export async function persistPreferences(
  prefs: MossPreferences,
  profileId?: string | null
): Promise<void> {
  const payload = JSON.stringify(prefs)
  savePreferences(prefs, profileId)

  if (window.moss?.db) {
    await window.moss.db.setSetting(PREFERENCES_STORAGE_KEY, payload)
  }
}

export type TimePhase = 'morning' | 'day' | 'evening' | 'night'

export type GreetingPhase = 'morning' | 'afternoon' | 'evening' | 'night'

export function getTimePhase(date = new Date()): TimePhase {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

/** Dashboard hero greeting phase (morning / afternoon / evening / night). */
export function getGreetingPhase(date = new Date()): GreetingPhase {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'night'
}

export function getGreetingBase(phase: GreetingPhase): string {
  switch (phase) {
    case 'morning':
      return 'Good morning'
    case 'afternoon':
      return 'Good afternoon'
    case 'evening':
      return 'Good evening'
    case 'night':
      return 'Good night'
  }
}

export function getGreetingPhrase(phase: GreetingPhase, displayName?: string): string {
  const base = getGreetingBase(phase)
  const name = displayName?.trim()
  return name ? `${base}, ${name}` : base
}

export function resolveColorMode(mode: ColorMode): 'light' | 'dark' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function resolveAccentHue(palette: AccentPalette): number {
  return ACCENT_PALETTES[palette].hue
}
