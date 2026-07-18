import { useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { CaptureKind } from '@shared/capture'
import { useProfile } from '../context/ProfileProvider'
import { useCaptureFlow } from '../hooks/useCaptureFlow'
import { useMotionGates } from '../hooks/useMotionGates'
import { captureModuleNav } from '../lib/captureModuleNav'
import { isEditableTarget } from '../lib/isEditableTarget'

const DASHBOARD_CAPTURE_PLACEHOLDERS = [
  '$12 chipotle',
  '2 eggs and toast',
  'dentist tuesday 2pm',
  'remember: call mom'
] as const

/** Warm the local model once per app session, on first focus (plan §2 rule 5). */
let warmedThisSession = false

function warmOnFirstFocus(): void {
  if (warmedThisSession) return
  warmedThisSession = true
  void window.moss.localai.warm().catch(() => undefined)
}

export interface DashboardCaptureBarProps {
  enterClassName?: string
  onModuleLogged?: (kind: CaptureKind) => void
}

export function DashboardCaptureBar({
  enterClassName = '',
  onModuleLogged
}: DashboardCaptureBarProps): React.JSX.Element {
  const { phase: profilePhase } = useProfile()
  const locked = profilePhase !== 'active'
  const { motionEnabled } = useMotionGates()
  const placeholderCycling = motionEnabled

  const {
    text,
    handleTextChange,
    phase,
    lastLoggedKind,
    placeholderFading,
    placeholder,
    inputRef,
    submit,
    confirmDraft,
    reset,
    leaving
  } = useCaptureFlow({
    locked,
    placeholderExamples: DASHBOARD_CAPTURE_PLACEHOLDERS,
    variant: 'dashboard',
    placeholderCycling,
    onLogged: onModuleLogged
  })

  const handleFocus = useCallback((): void => {
    warmOnFirstFocus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget(event.target)) return
        if (locked) return
        event.preventDefault()
        inputRef.current?.focus()
        return
      }

      if (event.key === 'Escape') {
        if (document.activeElement !== inputRef.current && phase.name === 'idle') return
        event.preventDefault()
        reset()
        inputRef.current?.blur()
        return
      }

      if (event.key !== 'Enter') return
      if (isEditableTarget(event.target) && document.activeElement !== inputRef.current) return
      if (locked) return

      if (phase.name === 'confirm') {
        event.preventDefault()
        void confirmDraft(phase.draft)
      } else if (phase.name === 'idle' || phase.name === 'notice') {
        if (document.activeElement === inputRef.current || phase.name === 'notice') {
          event.preventDefault()
          void submit()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDraft, inputRef, locked, phase, reset, submit])

  const showKeycap = phase.name === 'idle' && !text.trim() && !locked
  const moduleLink =
    phase.name === 'done' && lastLoggedKind ? captureModuleNav(lastLoggedKind) : null

  return (
    <div
      className={['dashboard-capture-bar', enterClassName].filter(Boolean).join(' ')}
      data-phase={phase.name}
    >
      {locked ? (
        <p className="dashboard-capture-locked capture-status capture-status--muted" role="status">
          MOSS is locked — unlock your profile first.
        </p>
      ) : (
        <>
          <div className={`dashboard-capture-field${leaving ? ' dashboard-capture-field--leaving' : ''}`}>
            <input
              ref={inputRef}
              className={[
                'dashboard-capture-input',
                placeholderCycling && placeholderFading ? 'dashboard-capture-input--placeholder-fade' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              type="text"
              value={text}
              onChange={(event) => handleTextChange(event.target.value)}
              onFocus={handleFocus}
              placeholder={placeholder}
              aria-label="Describe anything — money, meals, events, notes"
              readOnly={
                phase.name === 'busy' || phase.name === 'thinking' || phase.name === 'confirm'
              }
              spellCheck={false}
              autoComplete="off"
            />
            {showKeycap && (
              <kbd className="dashboard-capture-keycap money-mono" aria-hidden="true">
                /
              </kbd>
            )}
          </div>

          <div className="dashboard-capture-status capture-status-row" role="status" aria-live="polite">
            {phase.name === 'idle' && (
              <span className="capture-status capture-status--muted">
                Enter to log · Esc to clear
              </span>
            )}
            {phase.name === 'busy' && (
              <span className="capture-status capture-status--muted">Working…</span>
            )}
            {phase.name === 'thinking' && (
              <span className="capture-status capture-status--muted capture-status--thinking">
                Thinking…
              </span>
            )}
            {phase.name === 'confirm' && (
              <span className="capture-status">
                {phase.draft.message}
                <span className="capture-status-hint"> — Enter to log · Esc to cancel</span>
              </span>
            )}
            {phase.name === 'done' && (
              <span className="dashboard-capture-done">
                <span className="capture-status">{phase.message}</span>
                {moduleLink && (
                  <Link className="dashboard-capture-view-link" to={moduleLink.path}>
                    View in {moduleLink.label}
                  </Link>
                )}
              </span>
            )}
            {phase.name === 'notice' && (
              <span className="capture-status capture-status--notice">{phase.message}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
