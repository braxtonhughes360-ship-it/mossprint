import { useCallback, useEffect, useRef, useState } from 'react'

export interface DoorSnapshotResult<T> {
  snapshot: T | null
  loading: boolean
  refresh: () => Promise<void>
}

export interface DoorSnapshotOptions<TChannel, T> {
  loadSnapshot: (channel: TChannel) => Promise<T>
  refreshOnMount?: boolean
}

/** Shared lifecycle boundary for door data; module-specific reads stay in typed loaders. */
export function useDoorSnapshot<T, TChannel>(
  channel: TChannel | null | undefined,
  { loadSnapshot, refreshOnMount = true }: DoorSnapshotOptions<TChannel, T>
): DoorSnapshotResult<T> {
  const [snapshot, setSnapshot] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const snapshotRef = useRef<T | null>(null)

  const refresh = useCallback(async () => {
    if (!channel) {
      setLoading(false)
      return
    }

    // Only the first unresolved read is a loading surface. Background refresh
    // keeps last-good content visible and must never regress to a skeleton.
    setLoading(snapshotRef.current === null)
    try {
      const next = await loadSnapshot(channel)
      snapshotRef.current = next
      setSnapshot(next)
    } catch {
      // Keep last-good data during a failed background refresh. On the first
      // read the ref is already null, so the caller naturally shows its empty/error fallback.
    } finally {
      setLoading(false)
    }
  }, [channel, loadSnapshot])

  useEffect(() => {
    if (refreshOnMount) void refresh()
  }, [refresh, refreshOnMount])

  return { snapshot, loading, refresh }
}
