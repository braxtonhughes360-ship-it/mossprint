import { useEffect, useState, type CSSProperties } from 'react'

interface NutritionNavGlyphProps {
  active?: boolean
  burstTick?: number
}

const VEG = {
  basket: 'var(--moss-glyph-basket)',
  basketDark: 'var(--moss-glyph-basket-deep)',
  carrot: 'var(--moss-glyph-carrot)',
  carrotDeep: 'var(--moss-glyph-carrot-deep)',
  leaf: 'var(--moss-glyph-accent)',
  leafDeep: 'var(--moss-glyph-accent-deep)',
  tomato: 'var(--moss-glyph-tomato)',
  tomatoDeep: 'var(--moss-glyph-tomato-deep)'
}

const BURST_PARTICLES = [
  { tx: 0, ty: -28, rot: -10, delay: 0, kind: 'carrot' as const },
  { tx: 20, ty: -18, rot: 14, delay: 40, kind: 'tomato' as const },
  { tx: 26, ty: 4, rot: -18, delay: 70, kind: 'leaf' as const },
  { tx: 14, ty: 22, rot: 22, delay: 25, kind: 'carrot' as const },
  { tx: -14, ty: 20, rot: -14, delay: 55, kind: 'tomato' as const },
  { tx: -24, ty: 0, rot: 8, delay: 15, kind: 'leaf' as const }
]

const BURST_DURATION_MS = 820

function BurstVeg({
  kind,
  tx,
  ty,
  rot,
  delay
}: {
  kind: 'carrot' | 'tomato' | 'leaf'
  tx: number
  ty: number
  rot: number
  delay: number
}): React.JSX.Element {
  return (
    <span
      className="nutrition-nav-burst-bit"
      style={
        {
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          '--rot': `${rot}deg`,
          animationDelay: `${delay}ms`
        } as CSSProperties
      }
    >
      {kind === 'carrot' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <path
            d="M8 14 C7 11 7.5 8 8 5.5 C8.5 8 9 11 8 14 Z"
            fill={VEG.carrot}
            stroke={VEG.carrotDeep}
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
          <path d="M7 5.5 L6 3.5 M8 5 L8 3 M9 5.5 L10 3.5" stroke={VEG.leaf} strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      ) : null}
      {kind === 'tomato' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="9" r="4.5" fill={VEG.tomato} stroke={VEG.tomatoDeep} strokeWidth="0.6" />
          <path d="M6 5.5 Q8 4 10 5.5" stroke={VEG.leaf} strokeWidth="0.8" fill="none" strokeLinecap="round" />
        </svg>
      ) : null}
      {kind === 'leaf' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <path
            d="M8 13 C5 11 4 8 5 5.5 C7 6 9 5.5 11 5.5 C10 8 9 11 8 13 Z"
            fill={VEG.leaf}
            stroke={VEG.leafDeep}
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  )
}

/** Moss fuel instrument — produce silhouettes on rim + burst. */
export function NutritionNavGlyph({ active = false, burstTick = 0 }: NutritionNavGlyphProps): React.JSX.Element {
  const [burstId, setBurstId] = useState(0)

  useEffect(() => {
    if (burstTick === 0) return
    setBurstId(burstTick)
    const id = window.setTimeout(() => setBurstId(0), BURST_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [burstTick])

  return (
    <span
      className={['nutrition-nav-glyph-slot', active ? 'nutrition-nav-glyph-slot--active' : '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    >
      {burstId > 0 && (
        <span key={burstId} className="nutrition-nav-burst">
          {BURST_PARTICLES.map((particle, index) => (
            <BurstVeg key={`${burstId}-${index}`} {...particle} />
          ))}
        </span>
      )}

      <svg viewBox="0 0 32 32" fill="none" className="moss-nav-glyph-svg nutrition-nav-mark" aria-hidden>
        <ellipse cx="16" cy="24" rx="9" ry="2" fill="var(--moss-glyph-shadow)" opacity="0.1" />
        {/* Rim only — instrument, not wicker illustration */}
        <path
          d="M9 20 C9 20 10.5 25 16 25 C21.5 25 23 20 23 20"
          stroke={VEG.basket}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M9 20 L10 17 H22 L23 20" stroke={VEG.basketDark} strokeWidth="1.2" strokeLinejoin="round" fill="none" />
        {/* Carrot */}
        <path
          d="M11.5 19 C11 15.5 12.5 12 14 10 C15 12.5 15.5 15.5 15 19"
          fill={VEG.carrot}
          stroke={VEG.carrotDeep}
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path d="M14 10 L13 7.5 M14.5 9.5 L15.5 7" stroke={VEG.leaf} strokeWidth="0.85" strokeLinecap="round" />
        {/* Tomato */}
        <circle cx="20.5" cy="14.5" r="3.5" fill={VEG.tomato} stroke={VEG.tomatoDeep} strokeWidth="0.85" />
        <path d="M18.5 12.5 Q20.5 11 22.5 12.5" stroke={VEG.leaf} strokeWidth="0.75" fill="none" strokeLinecap="round" />
        {/* Leaf accent */}
        <path
          d="M18 19 C17.2 17.5 17.8 15.5 18.8 14.5 C19.2 16 19.3 17.5 18.8 19"
          fill={VEG.leaf}
          stroke={VEG.leafDeep}
          strokeWidth="0.65"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
