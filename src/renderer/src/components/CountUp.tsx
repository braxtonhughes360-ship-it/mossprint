import { useEffect, useRef, useState } from 'react'
import { useMotionGates } from '../hooks/useMotionGates'
import { MOSS_DURATION, MOSS_EASE_EDITORIAL } from '../lib/mossMotion'

/** Cubic-bezier(0.16, 1, 0.3, 1) sampled for rAF count-up tweens. */
function editorialEase(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const steps = 12
  let lo = 0
  let hi = 1
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2
    const x = 3 * (1 - mid) * (1 - mid) * mid * 0.16 + 3 * (1 - mid) * mid * mid * 1 + mid * mid * mid
    if (x < t) lo = mid
    else hi = mid
  }
  const u = (lo + hi) / 2
  return 3 * (1 - u) * (1 - u) * u * 0.3 + 3 * (1 - u) * u * u * 1 + u * u * u
}

interface CountUpProps {
  value: number
  format?: (value: number) => string
  /** Seconds; defaults to MOSS_DURATION.countUp */
  duration?: number
  className?: string
}

/**
 * Animated number roll — rAF tween with editorial easing.
 * Reduced/off motion tiers snap instantly (no decorative roll).
 */
export function CountUp({
  value,
  format = String,
  duration = MOSS_DURATION.countUp,
  className
}: CountUpProps): React.JSX.Element {
  const { motionEnabled } = useMotionGates()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (!motionEnabled) {
      fromRef.current = value
      setDisplay(value)
      return
    }

    const from = fromRef.current
    const to = value
    if (from === to) return

    const ms = duration * 1000
    const start = performance.now()

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / ms)
      const eased = editorialEase(t)
      const next = Math.round(from + (to - from) * eased)
      setDisplay(next)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
        setDisplay(to)
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [value, motionEnabled, duration])

  return (
    <span
      className={['moss-count-up', className].filter(Boolean).join(' ')}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {format(display)}
    </span>
  )
}

/** Re-export for callers that need the same easing curve elsewhere. */
export { MOSS_EASE_EDITORIAL }
