import { useEffect, useRef, useState } from 'react'

function useDevFpsEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('perf') === '1'
}

/** Dev-only DOM FPS readout — opt-in via `?perf=1`. Never inside hero canvas. */
export function DevPerfOverlay(): React.JSX.Element | null {
  const enabled = useDevFpsEnabled()
  const [fps, setFps] = useState(0)
  const framesRef = useRef(0)
  const lastRef = useRef(performance.now())

  useEffect(() => {
    if (!enabled) return

    let raf = 0
    const tick = (t: number): void => {
      framesRef.current += 1
      if (t - lastRef.current >= 1000) {
        setFps(framesRef.current)
        framesRef.current = 0
        lastRef.current = t
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled])

  if (!enabled) return null

  return (
    <div className="moss-dev-perf" aria-hidden>
      <span>{fps} fps</span>
    </div>
  )
}
