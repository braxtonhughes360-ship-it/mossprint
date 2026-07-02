import { useEffect, useState } from 'react'
import { getTimePhase, type TimePhase } from '@shared/preferences'

/** Re-evaluates time phase every minute for identity atmosphere shifts. */
export function useTimePhase(): TimePhase {
  const [phase, setPhase] = useState<TimePhase>(() => getTimePhase())

  useEffect(() => {
    const tick = (): void => setPhase(getTimePhase())
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])

  return phase
}
