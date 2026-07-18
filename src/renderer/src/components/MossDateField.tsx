import type { InputHTMLAttributes, Ref } from 'react'

export type MossDateFieldType = 'date' | 'time' | 'datetime-local' | 'month' | 'week'

export interface MossDateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  ref?: Ref<HTMLInputElement>
  type?: MossDateFieldType
}

/**
 * Token-styled native date/time input. The browser keeps locale-aware display,
 * direct keyboard entry, validation, and platform accessibility semantics.
 */
export function MossDateField({
  type = 'date',
  className,
  ref,
  ...props
}: MossDateFieldProps): React.JSX.Element {
  return (
    <input
      {...props}
      ref={ref}
      type={type}
      className={['moss-date-field', className].filter(Boolean).join(' ')}
    />
  )
}
