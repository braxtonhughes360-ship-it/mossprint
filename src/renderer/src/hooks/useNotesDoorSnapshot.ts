import { useCallback, useEffect, useState } from 'react'
import type { NotesDoorSnapshot } from '@shared/notes'

export function useNotesDoorSnapshot(): {
  snapshot: NotesDoorSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<NotesDoorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.notes) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await window.moss.notes.getDoorSnapshot()
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
