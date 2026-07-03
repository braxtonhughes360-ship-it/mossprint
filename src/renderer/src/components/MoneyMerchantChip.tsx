import { useMemo, useState } from 'react'
import { resolveMerchantChip } from '@shared/merchantChip'

export interface MoneyMerchantChipProps {
  label: string
  className?: string
}

/** Offline merchant chip — bundled brand icon or hashed monogram fallback. */
export function MoneyMerchantChip({ label, className = '' }: MoneyMerchantChipProps): React.JSX.Element {
  const resolved = useMemo(() => resolveMerchantChip(label), [label])
  const [iconFailed, setIconFailed] = useState(false)

  if (resolved.iconUrl && !iconFailed) {
    const utility = resolved.iconUrl.includes('utility-')
    return (
      <span
        className={[
          'money-merchant-chip',
          utility ? 'money-merchant-chip--utility' : 'money-merchant-chip--brand',
          className
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden
      >
        <img
          className="money-merchant-chip-icon"
          src={resolved.iconUrl}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setIconFailed(true)}
        />
      </span>
    )
  }

  return (
    <span
      className={['money-merchant-chip', className].filter(Boolean).join(' ')}
      data-color={resolved.color}
      aria-hidden
    >
      {resolved.monogram}
    </span>
  )
}
