import { useCallback, useEffect, useState } from 'react'
import type { MoneySummary } from '@shared/money'
import { currentPeriodKey } from '@shared/money'

export function useMoneySummary(): {
  summary: MoneySummary | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [summary, setSummary] = useState<MoneySummary | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.money) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await window.moss.money.getSummary(currentPeriodKey())
      setSummary(next)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { summary, loading, refresh }
}
