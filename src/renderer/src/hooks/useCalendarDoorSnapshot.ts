import { useCallback, useEffect, useState } from 'react'
import type { CalendarDoorSnapshot } from '@shared/calendar'

export function useCalendarDoorSnapshot(): {
  snapshot: CalendarDoorSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<CalendarDoorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.calendar?.getDoorSnapshot) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await window.moss.calendar.getDoorSnapshot()
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
