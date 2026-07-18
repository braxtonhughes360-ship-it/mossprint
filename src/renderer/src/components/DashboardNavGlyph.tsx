import { useEffect, useState, type CSSProperties } from 'react'

interface DashboardNavGlyphProps {
  active?: boolean
  burstTick?: number
}

/** Overview instrument — control tiles; tiles pop out on tap. */
const DASH = {
  tile: 'var(--moss-glyph-accent)',
  tileDeep: 'var(--moss-glyph-accent-deep)',
  paper: 'var(--moss-glyph-paper)',
  ink: 'var(--moss-glyph-ink)',
  warm: 'var(--moss-glyph-warm)'
}

const BURST_PARTICLES = [
  { tx: 0, ty: -27, rot: -12, delay: 0, accent: true },
  { tx: 23, ty: -15, rot: 16, delay: 50, accent: false },
  { tx: 25, ty: 8, rot: -18, delay: 80, accent: false },
  { tx: -17, ty: 21, rot: 18, delay: 28, accent: true },
  { tx: -25, ty: -3, rot: -10, delay: 58, accent: false },
  { tx: 11, ty: 24, rot: 22, delay: 16, accent: false }
]

const BURST_DURATION_MS = 820

function Tile({
  tx,
  ty,
  rot,
  delay,
  accent
}: {
  tx: number
  ty: number
  rot: number
  delay: number
  accent: boolean
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
        <rect
          x="3.5"
          y="3.5"
          width="9"
          height="9"
          rx="2.4"
          fill={accent ? DASH.tile : DASH.paper}
          stroke={accent ? DASH.tileDeep : DASH.ink}
          strokeWidth="0.8"
        />
      </svg>
    </span>
  )
}

export function DashboardNavGlyph({ active = false, burstTick = 0 }: DashboardNavGlyphProps): React.JSX.Element {
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
            <Tile key={`${burstId}-${index}`} {...particle} />
          ))}
        </span>
      )}

      <svg viewBox="0 0 32 32" fill="none" className="moss-nav-glyph-svg moss-char-mark" aria-hidden>
        <ellipse cx="16" cy="27.5" rx="8.5" ry="1.5" fill="var(--moss-glyph-shadow)" opacity="0.1" />
        <rect x="6.5" y="6.5" width="9.5" height="9.5" rx="2.8" fill={DASH.tile} stroke={DASH.tileDeep} strokeWidth="1.2" />
        <rect x="18" y="6.5" width="7.5" height="9.5" rx="2.6" fill={DASH.paper} stroke={DASH.ink} strokeWidth="1.3" />
        <rect x="6.5" y="18" width="7.5" height="7.5" rx="2.4" fill={DASH.paper} stroke={DASH.ink} strokeWidth="1.3" />
        <rect x="16" y="18" width="9.5" height="7.5" rx="2.6" fill={DASH.warm} stroke={DASH.ink} strokeWidth="1.3" opacity="0.92" />
      </svg>
    </span>
  )
}
