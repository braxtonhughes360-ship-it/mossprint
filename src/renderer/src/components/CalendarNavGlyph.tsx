import { useEffect, useState, type CSSProperties } from 'react'

interface CalendarNavGlyphProps {
  active?: boolean
  burstTick?: number
}

/** Schedule instrument — calendar pad; day tiles flutter out on tap. */
const CAL = {
  paper: '#ECE7D6',
  ink: '#2F3D34',
  header: '#6AB04C',
  headerDeep: '#3D8B40',
  today: '#E8704A'
}

const BURST_PARTICLES = [
  { tx: 0, ty: -28, rot: -12, delay: 0, today: false },
  { tx: 22, ty: -16, rot: 16, delay: 45, today: true },
  { tx: 26, ty: 6, rot: -20, delay: 80, today: false },
  { tx: -16, ty: 22, rot: 18, delay: 25, today: false },
  { tx: -26, ty: -2, rot: -10, delay: 55, today: false },
  { tx: 12, ty: 24, rot: 22, delay: 15, today: false }
]

const BURST_DURATION_MS = 820

function DayTile({
  tx,
  ty,
  rot,
  delay,
  today
}: {
  tx: number
  ty: number
  rot: number
  delay: number
  today: boolean
}): React.JSX.Element {
  return (
    <span
      className="moss-char-burst-bit"
      style={
        {
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          '--rot': `${rot}deg`,
          animationDelay: `${delay}ms`
        } as CSSProperties
      }
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="3" y="3" width="10" height="10" rx="2.6" fill={CAL.paper} stroke={CAL.ink} strokeWidth="0.8" />
        {today ? (
          <circle cx="8" cy="8" r="2.1" fill={CAL.today} />
        ) : (
          <path d="M5.5 7.5 H10.5 M5.5 9.5 H9" stroke={CAL.ink} strokeWidth="0.8" strokeLinecap="round" opacity="0.55" />
        )}
      </svg>
    </span>
  )
}

export function CalendarNavGlyph({ active = false, burstTick = 0 }: CalendarNavGlyphProps): React.JSX.Element {
  const [burstId, setBurstId] = useState(0)

  useEffect(() => {
    if (burstTick === 0) return
    setBurstId(burstTick)
    const id = window.setTimeout(() => setBurstId(0), BURST_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [burstTick])

  return (
    <span
      className={['moss-char-glyph-slot', active ? 'moss-char-glyph-slot--active' : ''].filter(Boolean).join(' ')}
      aria-hidden
    >
      {burstId > 0 && (
        <span key={burstId} className="moss-char-burst">
          {BURST_PARTICLES.map((particle, index) => (
            <DayTile key={`${burstId}-${index}`} {...particle} />
          ))}
        </span>
      )}

      <svg viewBox="0 0 32 32" fill="none" className="moss-nav-glyph-svg moss-char-mark" aria-hidden>
        <ellipse cx="16" cy="27.5" rx="9" ry="1.6" fill="#000" opacity="0.1" />
        <rect x="6" y="8.5" width="20" height="18" rx="3.5" fill={CAL.paper} stroke={CAL.ink} strokeWidth="1.4" />
        <path
          d="M6 12 a3.5 3.5 0 0 1 3.5 -3.5 h13 a3.5 3.5 0 0 1 3.5 3.5 v1.4 h-20 Z"
          fill={CAL.header}
          stroke={CAL.headerDeep}
          strokeWidth="0.6"
        />
        <path d="M11 6 V10.2 M21 6 V10.2" stroke={CAL.ink} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="18.8" r="2.1" fill={CAL.today} />
        <path d="M17.5 18.8 H22 M11 23.2 H21" stroke={CAL.ink} strokeWidth="1" strokeLinecap="round" opacity="0.42" />
      </svg>
    </span>
  )
}
