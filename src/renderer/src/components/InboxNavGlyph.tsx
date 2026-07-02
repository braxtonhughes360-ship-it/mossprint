import { useEffect, useState, type CSSProperties } from 'react'

interface InboxNavGlyphProps {
  active?: boolean
  burstTick?: number
}

/** Comms instrument — envelope; little letters fly out on tap. */
const MAIL = {
  paper: '#ECE7D6',
  paperDeep: '#D8D2BC',
  ink: '#2F3D34',
  flap: '#E0A951',
  flapDeep: '#C98A2E',
  dot: '#E8704A'
}

const BURST_PARTICLES = [
  { tx: 2, ty: -28, rot: -10, delay: 0 },
  { tx: 24, ty: -14, rot: 14, delay: 50 },
  { tx: 24, ty: 10, rot: -16, delay: 85 },
  { tx: -18, ty: 20, rot: 16, delay: 30 },
  { tx: -26, ty: -4, rot: -12, delay: 60 },
  { tx: 10, ty: 24, rot: 20, delay: 18 }
]

const BURST_DURATION_MS = 820

function Letter({
  tx,
  ty,
  rot,
  delay
}: {
  tx: number
  ty: number
  rot: number
  delay: number
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
        <rect x="2.5" y="4" width="11" height="8" rx="1.6" fill={MAIL.paper} stroke={MAIL.ink} strokeWidth="0.8" />
        <path d="M4.5 6.5 H11.5 M4.5 8.3 H10 M4.5 10 H8.5" stroke={MAIL.ink} strokeWidth="0.7" strokeLinecap="round" opacity="0.5" />
      </svg>
    </span>
  )
}

export function InboxNavGlyph({ active = false, burstTick = 0 }: InboxNavGlyphProps): React.JSX.Element {
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
            <Letter key={`${burstId}-${index}`} {...particle} />
          ))}
        </span>
      )}

      <svg viewBox="0 0 32 32" fill="none" className="moss-nav-glyph-svg moss-char-mark" aria-hidden>
        <ellipse cx="16" cy="26.5" rx="9.5" ry="1.6" fill="#000" opacity="0.1" />
        <rect x="5" y="9.5" width="22" height="14.5" rx="3" fill={MAIL.paper} stroke={MAIL.ink} strokeWidth="1.4" />
        <path d="M5.6 11 L16 18.5 L26.4 11" fill={MAIL.flap} stroke={MAIL.flapDeep} strokeWidth="0.6" />
        <path d="M5.6 11 L16 18.5 L26.4 11" stroke={MAIL.ink} strokeWidth="1.4" strokeLinejoin="round" fill="none" opacity="0.85" />
        <path d="M5.4 23.6 L12.5 17.5 M26.6 23.6 L19.5 17.5" stroke={MAIL.ink} strokeWidth="1.1" strokeLinecap="round" opacity="0.4" />
        <circle cx="25.5" cy="9.5" r="3.4" fill={MAIL.dot} stroke="#fff" strokeWidth="1" />
      </svg>
    </span>
  )
}
