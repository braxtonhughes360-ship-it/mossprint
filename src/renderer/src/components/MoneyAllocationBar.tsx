import { useState } from 'react'

export interface AllocationBarSegment {
  /** Stable key. */
  id: string
  /** Short label, e.g. "Rent". */
  name: string
  /** Share of the whole (0–100). */
  percent: number
  /** Formatted amount, e.g. "$1,450". */
  valueLabel: string
  /** Inline background (oklch/hex). */
  color: string
  /** Optional extra class for themed colors (e.g. asset-class color classes). */
  className?: string
}

interface MoneyAllocationBarProps {
  segments: AllocationBarSegment[]
  /** Accessible name for the whole bar. */
  ariaLabel: string
  /** Extra class on the wrapper (keeps existing layout modifiers like spacing variants). */
  className?: string
}

/**
 * Stacked allocation bar with an always-visible, clean legend beneath — every band's name, share
 * and amount is readable at rest (a color dot ties each row to its band, so placement is never
 * ambiguous). Hovering or keyboard-focusing a band highlights its legend row and vice-versa, so
 * "which color is which" is obvious without hiding any information.
 */
export function MoneyAllocationBar({
  segments,
  ariaLabel,
  className
}: MoneyAllocationBarProps): React.JSX.Element {
  const [active, setActive] = useState<number | null>(null)
  const clear = (index: number): void => setActive((cur) => (cur === index ? null : cur))

  return (
    <div className={['money-allocation-bar', className].filter(Boolean).join(' ')}>
      <div className="money-portfolio-allocation-track" role="group" aria-label={ariaLabel}>
        {segments.map((seg, index) => (
          <span
            key={seg.id}
            className={[
              'money-portfolio-allocation-segment',
              seg.className,
              active === index ? 'money-portfolio-allocation-segment--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ width: `${Math.max(seg.percent, 1)}%`, background: seg.color }}
            tabIndex={0}
            role="img"
            aria-label={`${seg.name} · ${seg.percent}% · ${seg.valueLabel}`}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => clear(index)}
            onFocus={() => setActive(index)}
            onBlur={() => clear(index)}
          />
        ))}
      </div>
      <ul className="money-allocation-legend money-mono">
        {segments.map((seg, index) => (
          <li
            key={seg.id}
            className={[
              'money-allocation-legend-row',
              active === index ? 'money-allocation-legend-row--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => clear(index)}
          >
            <span className="money-allocation-legend-dot" style={{ background: seg.color }} aria-hidden />
            <span className="money-allocation-legend-name">{seg.name}</span>
            <span className="money-allocation-legend-value">
              {seg.percent}% · {seg.valueLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
