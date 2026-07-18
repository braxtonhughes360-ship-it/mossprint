import type { HTMLAttributes, KeyboardEvent } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export interface MossToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'aria-label'> {
  label: string
  tone?: 'default' | 'document'
}

export interface MossToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  overflow?: 'wrap' | 'scroll'
}

function handleToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return

  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((control) => control.getAttribute('aria-hidden') !== 'true')
  const currentIndex = controls.indexOf(target)
  if (currentIndex < 0 || controls.length === 0) return

  let nextIndex = currentIndex
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = controls.length - 1
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % controls.length
  if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + controls.length) % controls.length

  event.preventDefault()
  controls[nextIndex]?.focus()
}

/** Grouped actions in DOM/Tab order, with supplemental arrow/Home/End navigation. */
function MossToolbarRoot({
  label,
  tone = 'default',
  className,
  children,
  onKeyDown,
  ...props
}: MossToolbarProps): React.JSX.Element {
  return (
    <div
      {...props}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={[
        'moss-toolbar',
        tone === 'document' ? 'moss-toolbar--document' : undefined,
        className
      ]
        .filter(Boolean)
        .join(' ')}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) handleToolbarKeyDown(event)
      }}
    >
      {children}
    </div>
  )
}

function MossToolbarGroup({
  label,
  overflow = 'wrap',
  className,
  children,
  ...props
}: MossToolbarGroupProps): React.JSX.Element {
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      data-overflow={overflow}
      className={['moss-toolbar__group', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

function MossToolbarSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      {...props}
      className={['moss-toolbar__separator', className].filter(Boolean).join(' ')}
      role="separator"
      aria-orientation="vertical"
      aria-hidden="true"
    />
  )
}

export const MossToolbar = Object.assign(MossToolbarRoot, {
  Group: MossToolbarGroup,
  Separator: MossToolbarSeparator
})
