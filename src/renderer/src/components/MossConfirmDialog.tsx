import { useId, type ReactNode } from 'react'
import { MossModal } from './MossModal'

interface MossConfirmDialogProps {
  title: string
  /** Optional supporting copy under the title. */
  body?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** `danger` paints the confirm button with the destructive accent. */
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Shared confirm dialog — replaces native window.confirm with the on-brand
 * MossModal surface (focus trap, escape/backdrop close, motion-tier choreography).
 * Reuses the proven calendar-event-modal confirm styling already used for the
 * Money delete-group flow, so confirms read identically across modules.
 */
export function MossConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onClose
}: MossConfirmDialogProps): React.JSX.Element {
  const titleId = useId()

  return (
    <MossModal
      onClose={onClose}
      backdropClassName="calendar-event-modal-backdrop"
      ariaLabelledBy={titleId}
    >
      <div className="calendar-event-modal">
        <h2 id={titleId} className="calendar-event-modal-title">
          {title}
        </h2>
        {body && <p className="money-group-modal-help">{body}</p>}
        <div className="calendar-event-modal-actions">
          <button
            type="button"
            className="money-button money-button--ghost money-button--compact"
            onClick={onClose}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={[
              'money-button money-button--compact',
              tone === 'danger' ? 'money-button--danger' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </MossModal>
  )
}
