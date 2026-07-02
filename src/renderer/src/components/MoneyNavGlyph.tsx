import { useEffect, useState, type CSSProperties } from 'react'

interface MoneyNavGlyphProps {
  active?: boolean
  burstTick?: number
}

/** Bold sticker bill — high viewBox density for crisp nav scale. */
const INK = '#1A3028'
const PAPER = '#B8D8A0'
const PORTRAIT = '#9CC488'

const BURST_PARTICLES = [
  { tx: 0, ty: -30, rot: -16, delay: 0, scale: 0.94 },
  { tx: 22, ty: -20, rot: 20, delay: 45, scale: 0.88 },
  { tx: 30, ty: 2, rot: -24, delay: 80, scale: 1 },
  { tx: 16, ty: 22, rot: 26, delay: 25, scale: 0.86 },
  { tx: -16, ty: 24, rot: -20, delay: 55, scale: 0.9 },
  { tx: -28, ty: 0, rot: 14, delay: 15, scale: 0.92 },
  { tx: -20, ty: -16, rot: -10, delay: 65, scale: 0.82 },
  { tx: 8, ty: -26, rot: 12, delay: 35, scale: 0.78 }
]

const BURST_DURATION_MS = 820

function BillFace({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 80 34"
      fill="none"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <rect x="2" y="2" width="76" height="30" rx="4" fill={PAPER} stroke={INK} strokeWidth="3" />
      <ellipse cx="40" cy="17" rx="11" ry="8.5" fill={PORTRAIT} stroke={INK} strokeWidth="2.5" />
      <circle cx="14" cy="11" r="3.5" fill="none" stroke={INK} strokeWidth="2" />
      <circle cx="66" cy="23" r="3.5" fill="none" stroke={INK} strokeWidth="2" />
    </svg>
  )
}

function BurstBill({
  tx,
  ty,
  rot,
  delay,
  scale
}: {
  tx: number
  ty: number
  rot: number
  delay: number
  scale: number
}): React.JSX.Element {
  return (
    <span
      className="money-nav-burst-bit"
      style={
        {
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          '--rot': `${rot}deg`,
          '--burst-scale': scale,
          animationDelay: `${delay}ms`
        } as CSSProperties
      }
    >
      <BillFace className="money-nav-burst-bill" />
    </span>
  )
}

/** Moss finance instrument — bill face; bills burst on click. */
export function MoneyNavGlyph({ active = false, burstTick = 0 }: MoneyNavGlyphProps): React.JSX.Element {
  const [burstId, setBurstId] = useState(0)

  useEffect(() => {
    if (burstTick === 0) return
    setBurstId(burstTick)
    const id = window.setTimeout(() => setBurstId(0), BURST_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [burstTick])

  return (
    <span
      className={['money-nav-glyph-slot', active ? 'money-nav-glyph-slot--active' : ''].filter(Boolean).join(' ')}
      aria-hidden
    >
      {burstId > 0 && (
        <span key={burstId} className="money-nav-burst">
          {BURST_PARTICLES.map((particle, index) => (
            <BurstBill key={`${burstId}-${index}`} {...particle} />
          ))}
        </span>
      )}

      <BillFace className="moss-nav-glyph-svg money-nav-mark" />
    </span>
  )
}
