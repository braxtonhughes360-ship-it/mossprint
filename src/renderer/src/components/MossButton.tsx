import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type MossButtonVariant = 'primary' | 'quiet' | 'danger' | 'icon'
export type MossButtonSize = 'xs' | 'sm' | 'md' | 'lg'

// Keep class names literal so Tailwind retains every documented variant/size
// even before every route has adopted it.
const VARIANT_CLASS: Record<MossButtonVariant, string> = {
  primary: 'moss-button--primary',
  quiet: 'moss-button--quiet',
  danger: 'moss-button--danger',
  icon: 'moss-button--icon'
}

const SIZE_CLASS: Record<MossButtonSize, string> = {
  xs: 'moss-button--xs',
  sm: 'moss-button--sm',
  md: 'moss-button--md',
  lg: 'moss-button--lg'
}

export interface MossButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>
  variant?: MossButtonVariant
  size?: MossButtonSize
  /** Uses neutral chassis color and border tokens instead of the climate accent at rest. */
  tone?: 'accent' | 'neutral'
  /** Applies the shared persistent selected treatment and matching pressed semantics. */
  pressed?: boolean
  /** Uses the quiet surface while retaining the variant's semantic color. */
  subtle?: boolean
  /** Replaces the visible label while also making the control inert. */
  busy?: boolean
  /** Spinner-free progress copy. Defaults to “Working…” when `busy` is true. */
  busyLabel?: ReactNode
}

/**
 * Shared MOSS action control. Visual state, keyboard focus, motion-tier behavior,
 * disabled treatment, and progress copy belong here rather than in module CSS.
 */
export function MossButton({
  variant = 'primary',
  size = 'md',
  tone = 'accent',
  pressed,
  subtle = false,
  busy = false,
  busyLabel = 'Working…',
  disabled = false,
  className,
  ref,
  children,
  type = 'button',
  ...props
}: MossButtonProps): React.JSX.Element {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[
        'moss-button',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        tone === 'neutral' ? 'moss-button--neutral' : undefined,
        pressed ? 'moss-button--pressed' : undefined,
        subtle ? 'moss-button--quiet' : undefined,
        className
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || busy}
      aria-pressed={pressed ?? props['aria-pressed']}
      aria-busy={busy || undefined}
    >
      {busy ? busyLabel : children}
    </button>
  )
}
