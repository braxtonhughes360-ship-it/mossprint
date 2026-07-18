import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { ActivateProfileResponse, CreateProfileResult, ProfileSummary } from '@shared/profiles'
import { queryClient } from '../queryClient'

type ProfilePhase = 'loading' | 'picker' | 'active' | 'none'

interface ProfileContextValue {
  phase: ProfilePhase
  profiles: ProfileSummary[]
  activeProfile: ProfileSummary | null
  databasePath: string | null
  ready: boolean
  activate: (profileId: string, password?: string) => Promise<ActivateProfileResponse>
  lock: () => Promise<void>
  createProfile: (displayName: string) => Promise<CreateProfileResult>
  refreshProfiles: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

async function fetchProfiles(): Promise<ProfileSummary[]> {
  return window.moss.profiles.list()
}

export function ProfileProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [phase, setPhase] = useState<ProfilePhase>('loading')
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(null)
  const [databasePath, setDatabasePath] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const refreshProfiles = useCallback(async (): Promise<void> => {
    const list = await fetchProfiles()
    setProfiles(list)
    // Keep the active summary in sync so flags like passwordEnabled update
    // immediately (e.g. right after password setup in Settings) instead of
    // waiting for a remount.
    setActiveProfile((current) => {
      if (!current) return current
      return list.find((profile) => profile.id === current.id) ?? current
    })
  }, [])

  const applyActive = useCallback(
    (profile: ProfileSummary, path: string): void => {
      setActiveProfile(profile)
      setDatabasePath(path)
      setPhase('active')
    },
    []
  )

  const activate = useCallback(
    async (profileId: string, password?: string): Promise<ActivateProfileResponse> => {
      const result = await window.moss.profiles.activate(profileId, password)
      if (result.ok) {
        // Never show one profile's cached data inside another profile's session.
        queryClient.clear()
        applyActive(result.profile, result.databasePath)
        await refreshProfiles()
      }
      return result
    },
    [applyActive, refreshProfiles]
  )

  const lock = useCallback(async (): Promise<void> => {
    await window.moss.profiles.lock()
    queryClient.clear()
    setActiveProfile(null)
    setDatabasePath(null)
    setPhase('picker')
    await refreshProfiles()
  }, [refreshProfiles])

  const createProfile = useCallback(
    async (displayName: string): Promise<CreateProfileResult> => {
      const created = await window.moss.profiles.create({ displayName })
      await refreshProfiles()
      return created
    },
    [refreshProfiles]
  )

  useEffect(() => {
    if (!window.moss?.profiles?.onIdleLocked) return
    return window.moss.profiles.onIdleLocked(() => {
      queryClient.clear()
      setActiveProfile(null)
      setDatabasePath(null)
      setPhase('picker')
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('profile_ipc_timeout')), ms)
        promise
          .then((value) => {
            window.clearTimeout(timer)
            resolve(value)
          })
          .catch((err: unknown) => {
            window.clearTimeout(timer)
            reject(err)
          })
      })

    void (async () => {
      try {
        if (!window.moss?.profiles) {
          throw new Error('moss_bridge_unavailable')
        }

        const list = await withTimeout(fetchProfiles(), 12_000)
        if (cancelled) return
        setProfiles(list)

        if (list.length === 0) {
          setPhase('none')
          setReady(true)
          return
        }

        setPhase('picker')
        setReady(true)
      } catch {
        if (!cancelled) {
          setPhase('picker')
          setReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyActive])

  const value = useMemo(
    () => ({
      phase,
      profiles,
      activeProfile,
      databasePath,
      ready,
      activate,
      lock,
      createProfile,
      refreshProfiles
    }),
    [
      phase,
      profiles,
      activeProfile,
      databasePath,
      ready,
      activate,
      lock,
      createProfile,
      refreshProfiles
    ]
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) {
    throw new Error('useProfile must be used within ProfileProvider')
  }
  return ctx
}
