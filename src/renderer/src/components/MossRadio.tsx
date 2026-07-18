import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

export interface MossRadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  ref?: Ref<HTMLInputElement>
  label: ReactNode
  description?: ReactNode
  inputClassName?: string
}

/** A native radio with its full copy block inside the pointer/touch hit target. */
export function MossRadio({
  label,
  description,
  className,
  inputClassName,
  ref,
  disabled,
  ...props
}: MossRadioProps): React.JSX.Element {
  return (
    <label className={['moss-choice', 'moss-radio', className].filter(Boolean).join(' ')}>
      <input
        {...props}
        ref={ref}
        type="radio"
        disabled={disabled}
        className={['moss-choice__native', inputClassName].filter(Boolean).join(' ')}
      />
      <span className="moss-choice__indicator moss-radio__indicator" aria-hidden="true">
        <span />
      </span>
      <span className="moss-choice__copy">
        <span className="moss-choice__label">{label}</span>
        {description && <span className="moss-choice__description">{description}</span>}
      </span>
    </label>
  )
}
