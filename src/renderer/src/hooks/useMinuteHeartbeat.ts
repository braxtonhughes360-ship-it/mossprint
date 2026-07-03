import { useEffect, useRef, useState } from 'react'

/** Increments each time the local clock minute changes (59→00 included). */
export function useMinuteHeartbeat(): number {
  const [pulse, setPulse] = useState(0)
  const lastMinute = useRef(new Date().getMinutes())

  useEffect(() => {
    const id = window.setInterval(() => {
      const minute = new Date().getMinutes()
      if (minute === lastMinute.current) return
      lastMinute.current = minute
      setPulse((value) => value + 1)
    }, 1_000)

    return () => window.clearInterval(id)
  }, [])

  return pulse
}
