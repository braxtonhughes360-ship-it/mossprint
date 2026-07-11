import { useCallback, useEffect, useState } from 'react'
import type { MailDoorSnapshot } from '@shared/mail'

export function useInboxDoorSnapshot(): {
  snapshot: MailDoorSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<MailDoorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.mail?.getDoorSnapshot) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await window.moss.mail.getDoorSnapshot()
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
