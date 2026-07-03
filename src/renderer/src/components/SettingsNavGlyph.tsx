import { useEffect, useState, type CSSProperties } from 'react'

interface SettingsNavGlyphProps {
  active?: boolean
  burstTick?: number
}

/** Tune instrument — cog; little gears spin out on tap. */
const SET = {
  metal: '#CFC8B2',
  metalDeep: '#8A8468',
  ink: '#2F3D34',
  hub: '#6AB04C',
  hubDeep: '#3D8B40'
}

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315]

const BURST_PARTICLES = [
  { tx: 2, ty: -27, rot: 120, delay: 0 },
  { tx: 24, ty: -13, rot: -140, delay: 55 },
  { tx: 22, ty: 12, rot: 160, delay: 85 },
  { tx: -19, ty: 19, rot: -120, delay: 30 },
  { tx: -25, ty: -5, rot: 140, delay: 60 }
]

const BURST_DURATION_MS = 820

function MiniCog({
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
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect
            key={a}
            x="7"
            y="1.6"
            width="2"
            height="3.4"
            rx="0.7"
            fill={SET.metal}
            stroke={SET.metalDeep}
            strokeWidth="0.4"
            transform={`rotate(${a} 8 8)`}
          />
        ))}
        <circle cx="8" cy="8" r="3.6" fill={SET.metal} stroke={SET.metalDeep} strokeWidth="0.6" />
        <circle cx="8" cy="8" r="1.5" fill={SET.hub} />
      </svg>
    </span>
  )
}

export function SettingsNavGlyph({ active = false, burstTick = 0 }: SettingsNavGlyphProps): React.JSX.Element {
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
            <MiniCog key={`${burstId}-${index}`} {...particle} />
          ))}
        </span>
      )}

      <svg
        key={burstId}
        viewBox="0 0 32 32"
        fill="none"
        className={['moss-nav-glyph-svg moss-char-mark', burstId > 0 ? 'moss-char-mark--spin' : ''].filter(Boolean).join(' ')}
        aria-hidden
      >
        <ellipse cx="16" cy="28" rx="8" ry="1.5" fill="#000" opacity="0.1" />
        {TEETH.map((a) => (
          <rect
            key={a}
            x="14"
            y="3.4"
            width="4"
            height="6"
            rx="1.4"
            fill={SET.metal}
            stroke={SET.metalDeep}
            strokeWidth="0.7"
            transform={`rotate(${a} 16 16)`}
          />
        ))}
        <circle cx="16" cy="16" r="7.2" fill={SET.metal} stroke={SET.metalDeep} strokeWidth="1.3" />
        <circle cx="16" cy="16" r="3" fill={SET.hub} stroke={SET.hubDeep} strokeWidth="0.8" />
      </svg>
    </span>
  )
}
