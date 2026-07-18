import type { HTMLAttributes, ReactNode } from 'react'

export interface MossCardProps extends HTMLAttributes<HTMLElement> {
  /** Content rendered before the card body. Prefer a semantic heading wrapper. */
  header?: ReactNode
  /** Content rendered after the card body. */
  footer?: ReactNode
}

/**
 * Shared threshold card shell. Layout and module character stay with the caller;
 * the surface, border, interaction states, and motion contract live here.
 */
export function MossCard({
  header,
  footer,
  className,
  children,
  ...props
}: MossCardProps): React.JSX.Element {
  return (
    <section
      {...props}
      className={['moss-card', 'moss-threshold', 'moss-threshold-surface', className]
        .filter(Boolean)
        .join(' ')}
    >
      {header}
      {children}
      {footer}
    </section>
  )
}
