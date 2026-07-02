import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  DEFAULT_PREFERENCES,
  clonePreferences,
  loadPreferencesFromStore,
  mergePreferences,
  persistPreferences,
  resolveColorMode,
  type MossPreferences,
  type ModulePreferences
} from '@shared/preferences'
import { useProfile } from './ProfileProvider'

interface PreferencesContextValue {
  preferences: MossPreferences
  ready: boolean
  setPreferences: (
    patch: Partial<Omit<MossPreferences, 'modules' | 'profile' | 'setup'>> & {
      modules?: Partial<ModulePreferences>
      profile?: Partial<MossPreferences['profile']>
      setup?: Partial<MossPreferences['setup']>
    }
  ) => void
  /**
   * Authoritatively replace the in-memory preferences for a known profile and
   * persist them, bypassing the store-reload effect. Used at the end of setup so
   * the freshly-completed prefs (theme/modules/completedAt) survive a new profile's
   * empty-DB load instead of being clobbered back to defaults.
   */
  hydratePreferences: (prefs: MossPreferences, forProfileId: string) => void
  /** Mark a profile as hydrated before activate() so the store-reload effect skips. */
  prepareProfileHydration: (forProfileId: string) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function applyPreferencesToDocument(prefs: MossPreferences): void {
  const root = document.documentElement
  const resolved = resolveColorMode(prefs.colorMode)

  root.dataset.colorMode = resolved
  root.dataset.colorModePref = prefs.colorMode
  root.dataset.motion = prefs.motionIntensity
  root.dataset.density = prefs.density
  root.dataset.ambient = prefs.ambientIntensity
  root.dataset.accent = prefs.accentPalette
  root.style.colorScheme = resolved
}

export function PreferencesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { activeProfile, phase } = useProfile()
  const profileId = activeProfile?.id ?? null

  const [preferences, setPreferencesState] = useState<MossPreferences>(() => {
    const prefs = clonePreferences(DEFAULT_PREFERENCES)
    applyPreferencesToDocument(prefs)
    return prefs
  })
  const [ready, setReady] = useState(false)

  // Profile we've authoritatively hydrated (e.g. right after finishing setup).
  // The store-reload effect must not clobber it back to the empty-DB defaults.
  const hydratedProfileRef = useRef<string | null>(null)

  useEffect(() => {
    if (phase !== 'active' || !profileId) {
      setReady(false)
      return
    }

    if (hydratedProfileRef.current === profileId) {
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)

    void loadPreferencesFromStore(profileId).then((stored) => {
      if (cancelled || hydratedProfileRef.current === profileId) return
      setPreferencesState((current) => {
        const loaded = clonePreferences(stored)
        const currentName = current.profile.displayName.trim()
        const loadedName = loaded.profile.displayName.trim()
        if (currentName && !loadedName) {
          return mergePreferences(loaded, { profile: { displayName: currentName } })
        }
        return loaded
      })
      setReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [phase, profileId])

  const setPreferences = useCallback(
    (
      patch: Partial<Omit<MossPreferences, 'modules' | 'profile' | 'setup'>> & {
        modules?: Partial<ModulePreferences>
        profile?: Partial<MossPreferences['profile']>
        setup?: Partial<MossPreferences['setup']>
      }
    ) => {
      setPreferencesState((current) => {
        const next = mergePreferences(current, patch)
        applyPreferencesToDocument(next)
        void persistPreferences(next, profileId)
        return next
      })
    },
    [profileId]
  )

  const prepareProfileHydration = useCallback((forProfileId: string) => {
    hydratedProfileRef.current = forProfileId
  }, [])

  const hydratePreferences = useCallback(
    (prefs: MossPreferences, forProfileId: string) => {
      hydratedProfileRef.current = forProfileId
      const next = clonePreferences(prefs)
      applyPreferencesToDocument(next)
      setPreferencesState(next)
      setReady(true)
      void persistPreferences(next, forProfileId)
    },
    []
  )

  const resetPreferences = useCallback(() => {
    const next = clonePreferences(DEFAULT_PREFERENCES)
    applyPreferencesToDocument(next)
    setPreferencesState(next)
    void persistPreferences(next, profileId)
  }, [profileId])

  useEffect(() => {
    applyPreferencesToDocument(preferences)
  }, [preferences])

  useEffect(() => {
    if (preferences.colorMode !== 'auto') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyPreferencesToDocument(preferences)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preferences])

  const value = useMemo(
    () => ({
      preferences,
      ready,
      setPreferences,
      hydratePreferences,
      prepareProfileHydration,
      resetPreferences
    }),
    [preferences, ready, setPreferences, hydratePreferences, prepareProfileHydration, resetPreferences]
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider')
  }
  return ctx
}
