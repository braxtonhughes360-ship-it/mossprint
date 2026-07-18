import { m } from 'motion/react'
import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { DismissableLayer } from '@radix-ui/react-dismissable-layer'
import { useMotionGates } from '../hooks/useMotionGates'
import {
  mossModalBackdropVariants,
  mossModalPanelVariants,
  mossModalSpring
} from '../lib/mossMotion'

interface MossModalProps {
  onClose: () => void
  /** Backdrop surface — e.g. `mail-composer-overlay`, `calendar-event-modal-backdrop` */
  backdropClassName?: string
  /** Panel surface — e.g. `mail-composer`, `calendar-event-modal` */
  panelClassName?: string
  ariaLabel?: string
  ariaLabelledBy?: string
  children: ReactNode
}

/**
 * Shared modal choreography — backdrop fade + panel scale/lift spring.
 * Mount/unmount controlled by parent; entrance runs on mount.
 *
 * Accessibility is delegated to Radix headless primitives *under* the MOSS skin
 * (the locked 7-0 direction): FocusScope traps + restores focus, DismissableLayer
 * handles Escape and outside-pointer dismissal. All styling, portalling, and
 * mossMotion choreography stay ours.
 */
function modalPortalRoot(): HTMLElement {
  return document.getElementById('root') ?? document.body
}

export function MossModal({
  onClose,
  backdropClassName,
  panelClassName,
  ariaLabel,
  ariaLabelledBy,
  children
}: MossModalProps): React.JSX.Element {
  const { motionEnabled } = useMotionGates()
  const transition = mossModalSpring(motionEnabled)

  const backdropClass = ['moss-modal-backdrop', backdropClassName].filter(Boolean).join(' ')
  const panelClass = ['moss-modal-panel', panelClassName].filter(Boolean).join(' ')

  const panelA11y = {
    className: panelClass,
    role: 'dialog' as const,
    'aria-modal': true,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy
  }

  // Portals to body so fixed positioning isn't trapped by moss-threshold panels
  // (transform + overflow:hidden on money instrument surfaces clip in-place modals).
  const overlay = (
    <FocusScope asChild loop trapped>
      <DismissableLayer
        asChild
        onEscapeKeyDown={() => onClose()}
        onPointerDownOutside={() => onClose()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        {motionEnabled ? (
          <m.div
            {...panelA11y}
            initial="hidden"
            animate="visible"
            variants={mossModalPanelVariants}
            transition={transition}
          >
            {children}
          </m.div>
        ) : (
          <div {...panelA11y}>{children}</div>
        )}
      </DismissableLayer>
    </FocusScope>
  )

  const modal = motionEnabled ? (
    <m.div
      className={backdropClass}
      role="presentation"
      initial="hidden"
      animate="visible"
      variants={mossModalBackdropVariants}
      transition={transition}
    >
      {overlay}
    </m.div>
  ) : (
    <div className={backdropClass} role="presentation">
      {overlay}
    </div>
  )

  return createPortal(modal, modalPortalRoot())
}
