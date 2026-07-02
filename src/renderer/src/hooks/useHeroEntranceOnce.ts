import { useEffect, useState } from 'react'
import { useMotionGates } from './useMotionGates'

let heroEntrancePlayed = false

/** Hero stagger runs once per app session on first dashboard visit only. */
export function useHeroEntranceOnce(): boolean {
  const { motionEnabled } = useMotionGates()
  const [shouldPlay] = useState(() => motionEnabled && !heroEntrancePlayed)

  useEffect(() => {
    if (shouldPlay) {
      heroEntrancePlayed = true
    }
  }, [shouldPlay])

  return shouldPlay
}
