import { useEffect, useState } from 'react'
import { useMinuteHeartbeat } from '../hooks/useMinuteHeartbeat'
import { useMotionGates } from '../hooks/useMotionGates'
import { useTimePhase } from '../hooks/useTimePhase'

interface MossBrandLockupProps {
  /** Typographic monogram only — collapsed nav (44px touch target). */
  iconOnly?: boolean
}

export function MossBrandLockup({ iconOnly = false }: MossBrandLockupProps): React.JSX.Element {
  const phase = useTimePhase()
  const minutePulse = useMinuteHeartbeat()
  const { presenceEnabled } = useMotionGates()
  const [sweep, setSweep] = useState(false)
  const [creditPulse, setCreditPulse] = useState(false)

  useEffect(() => {
    if (!presenceEnabled || minutePulse === 0) return

    setSweep(true)
    setCreditPulse(true)
    const sweepId = window.setTimeout(() => setSweep(false), 2_000)
    const pulseId = window.setTimeout(() => setCreditPulse(false), 480)
    return () => {
      window.clearTimeout(sweepId)
      window.clearTimeout(pulseId)
    }
  }, [minutePulse, presenceEnabled])

  useEffect(() => {
    if (!presenceEnabled) return

    let sweepId: number | undefined
    let pulseId: number | undefined
    const mountId = window.setTimeout(() => {
      setSweep(true)
      setCreditPulse(true)
      sweepId = window.setTimeout(() => setSweep(false), 2_000)
      pulseId = window.setTimeout(() => setCreditPulse(false), 480)
    }, 2_000)

    return () => {
      window.clearTimeout(mountId)
      if (sweepId !== undefined) window.clearTimeout(sweepId)
      if (pulseId !== undefined) window.clearTimeout(pulseId)
    }
  }, [presenceEnabled])

  const presenceActive = sweep || creditPulse

  if (iconOnly) {
    return (
      <div
        className="moss-brand-lockup moss-lockup moss-brand-lockup--icon-only"
        data-phase={phase}
        data-presence={presenceActive ? 'pulse' : undefined}
        aria-label="MOSS"
      >
        <span className="moss-wordmark-monogram" aria-hidden>
          M
        </span>
      </div>
    )
  }

  return (
    <div
      className="moss-brand-lockup moss-lockup moss-lockup--monolith"
      data-phase={phase}
      data-presence={presenceActive ? 'pulse' : undefined}
      aria-label="MOSS, product by State Zero"
    >
      <div className="moss-lockup-plate">
        <span className="moss-lockup-plate-spine" aria-hidden />
        <span className="moss-lockup-plate-ambient" aria-hidden />
        <span className="moss-lockup-plate-scan" aria-hidden />

        <div className="moss-lockup-plate-body moss-lockup-plate-body--type">
          <span
            className={['moss-wordmark', sweep ? 'moss-wordmark--sweep' : '']
              .filter(Boolean)
              .join(' ')}
          >
            MOSS
          </span>

          <span className="moss-lockup-rule" aria-hidden />

          <p
            className={[
              'moss-lockup-credit',
              creditPulse ? 'moss-lockup-credit--pulse' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="moss-lockup-credit-kicker">product</span>
            <span className="moss-lockup-credit-line">
              <span className="moss-lockup-credit-lead">by</span>{' '}
              <span className="moss-lockup-credit-name">
                State <span className="moss-lockup-credit-accent">Zero</span>
              </span>
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
