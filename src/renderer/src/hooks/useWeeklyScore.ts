import { useCallback, useEffect, useState } from 'react'
import type { WeeklyScoreSnapshot } from '@shared/weeklyScore'

export function useWeeklyScore(): {
  snapshot: WeeklyScoreSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<WeeklyScoreSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.goals) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await window.moss.goals.getWeeklyScore()
      setSnapshot(next)
    } catch {
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, refresh }
}
