import type { MoneyDataTrustKind } from '@shared/moneyTrust'
import { MONEY_DATA_TRUST_SHORT, trustChipClass } from '@shared/moneyTrust'

interface MoneyTrustBadgeProps {
  kind: MoneyDataTrustKind
  /** Tooltip / screen-reader detail — the deterministic why string. */
  why?: string
  /** Use long label instead of short chip text. */
  long?: boolean
  className?: string
  /** When false, the badge is not a separate tab stop (parent trigger carries focus). */
  focusable?: boolean
}

interface MoneyWhyTriggerProps {
  /** Plain-language explanation shown on hover/focus. */
  why: string
  children: React.ReactNode
  className?: string
}

function whyTriggerProps(why: string, label?: string): {
  title: string
  tabIndex: 0
  'aria-label': string
  onClick: (event: React.MouseEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
} {
  return {
    title: why,
    tabIndex: 0,
    'aria-label': label ? `${label}. ${why}` : why,
    onClick: (event) => {
      event.preventDefault()
      event.stopPropagation()
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
  }
}

/** Focusable wrapper — same hover/title pattern as MoneyTrustBadge, for hero readouts. */
export function MoneyWhyTrigger({
  why,
  children,
  className = ''
}: MoneyWhyTriggerProps): React.JSX.Element {
  return (
    <span
      className={['money-trust-why-trigger', className].filter(Boolean).join(' ')}
      {...whyTriggerProps(why)}
    >
      {children}
    </span>
  )
}

export function MoneyTrustBadge({
  kind,
  why,
  long = false,
  className = '',
  focusable = true
}: MoneyTrustBadgeProps): React.JSX.Element {
  const label = long
    ? ({ manual: 'You entered this', derived: 'Calculated', imported: 'Imported', estimated: 'Estimated', current: 'Up to date', reconciled: 'Reconciled', stale: 'May be stale' } as const)[kind]
    : MONEY_DATA_TRUST_SHORT[kind]

  const interactive = why && focusable

  return (
    <span
      className={[
        trustChipClass(kind),
        interactive ? 'money-trust-badge--interactive' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...(interactive
        ? whyTriggerProps(why, label)
        : { title: why, 'aria-label': why ? `${label}. ${why}` : label })}
    >
      {label}
    </span>
  )
}
