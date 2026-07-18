import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

export interface MossCheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  ref?: Ref<HTMLInputElement>
  label: ReactNode
  description?: ReactNode
  inputClassName?: string
}

/** A native checkbox with the label inside the hit target and MOSS-owned chrome. */
export function MossCheckbox({
  label,
  description,
  className,
  inputClassName,
  ref,
  disabled,
  ...props
}: MossCheckboxProps): React.JSX.Element {
  return (
    <label className={['moss-choice', 'moss-checkbox', className].filter(Boolean).join(' ')}>
      <input
        {...props}
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className={['moss-choice__native', inputClassName].filter(Boolean).join(' ')}
      />
      <span className="moss-choice__indicator moss-checkbox__indicator" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="m3.5 8.2 2.8 2.7 6.2-6.1" />
        </svg>
      </span>
      <span className="moss-choice__copy">
        <span className="moss-choice__label">{label}</span>
        {description && <span className="moss-choice__description">{description}</span>}
      </span>
    </label>
  )
}
