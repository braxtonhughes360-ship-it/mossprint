import type { HTMLAttributes, ReactNode } from 'react'
import { MossButton, type MossButtonProps } from './MossButton'

export interface MossEmptyStateAction extends Omit<MossButtonProps, 'children' | 'busyLabel'> {
  label: ReactNode
  busyLabel?: ReactNode
}

export interface MossEmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  kicker?: ReactNode
  title: ReactNode
  body: ReactNode
  /** The primitive owns exactly one action and always renders it as MossButton. */
  action: MossEmptyStateAction
}

/** A calm zero-data explanation contained by a quiet threshold surface. */
export function MossEmptyState({
  icon,
  kicker,
  title,
  body,
  action,
  className,
  ...props
}: MossEmptyStateProps): React.JSX.Element {
  const { label, ...buttonProps } = action

  return (
    <div
      {...props}
      className={[
        'moss-empty-state',
        'moss-threshold',
        'moss-threshold-surface',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon ? <div className="moss-empty-state__icon">{icon}</div> : null}
      {kicker ? <p className="moss-empty-state__kicker">{kicker}</p> : null}
      <h3 className="moss-empty-state__title">{title}</h3>
      <div className="moss-empty-state__body">{body}</div>
      <div className="moss-empty-state__action">
        <MossButton variant="quiet" size="sm" {...buttonProps}>
          {label}
        </MossButton>
      </div>
    </div>
  )
}
