import { useEffect, useState } from 'react'
import { useMotionGates } from './useMotionGates'

let doorEntrancePlayed = false

/** Door stagger runs once per app session on first dashboard visit only. */
export function useDoorEntranceOnce(): boolean {
  const { motionEnabled } = useMotionGates()
  const [shouldPlay] = useState(() => motionEnabled && !doorEntrancePlayed)

  useEffect(() => {
    if (shouldPlay) {
      doorEntrancePlayed = true
    }
  }, [shouldPlay])

  return shouldPlay
}
