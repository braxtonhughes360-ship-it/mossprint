import '../CapturePage.css'
import { useCallback, useEffect, useState } from 'react'
import { loadPreferencesFromStore } from '@shared/preferences'
import { applyPreferencesToDocument } from '../context/PreferencesProvider'
import { useCaptureFlow } from '../hooks/useCaptureFlow'

const CAPTURE_PLACEHOLDER_EXAMPLES = [
  '$12 chipotle',
  '2 eggs and toast',
  'dentist tuesday 2pm',
  'remember: renew passport'
] as const

export function CapturePage(): React.JSX.Element {
  const [locked, setLocked] = useState(false)
  const [placeholderCycling, setPlaceholderCycling] = useState(false)

  const syncProfileState = useCallback(async (): Promise<void> => {
    try {
      const active = await window.moss.profiles.getActive()
      setLocked(!active)
      if (active) {
        applyPreferencesToDocument(await loadPreferencesFromStore(active.profile.id))
        setPlaceholderCycling(document.documentElement.getAttribute('data-motion') === 'full')
      }
    } catch {
      setLocked(true)
    }
  }, [])

  const {
    text,
    handleTextChange,
    phase,
    placeholderFading,
    placeholder,
    inputRef,
    submit,
    confirmDraft,
    reset,
    hideWindow,
    leaving
  } = useCaptureFlow({
    locked,
    placeholderExamples: CAPTURE_PLACEHOLDER_EXAMPLES,
    variant: 'window',
    placeholderCycling
  })

  // The OS window is transparent; only the card should paint, and nothing scrolls.
  useEffect(() => {
    document.documentElement.classList.add('capture-transparent-root')
    document.body.classList.add('capture-transparent-body')
    return () => {
      document.documentElement.classList.remove('capture-transparent-root')
      document.body.classList.remove('capture-transparent-body')
    }
  }, [])

  // The window is hidden (not destroyed) between captures — reset and re-sync
  // lock state + theme prefs whenever it reappears. Main pushes capture:shown
  // on every show because visibilitychange doesn't fire reliably in the
  // hidden transparent pre-warm window (QA2-07: stale "profile locked").
  useEffect(() => {
    const resync = (): void => {
      reset()
      void syncProfileState().then(() => inputRef.current?.focus())
    }
    const unsubscribe = window.moss?.capture?.onShown?.(resync)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unsubscribe?.()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [inputRef, reset, syncProfileState])

  useEffect(() => {
    inputRef.current?.focus()
    void syncProfileState()
  }, [inputRef, syncProfileState])

  // Window-level so Enter/Esc keep working while the input is read-only
  // (confirm / done states) and focus may have left the field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        hideWindow()
        return
      }
      if (event.key !== 'Enter') return
      event.preventDefault()
      if (phase.name === 'confirm') {
        void confirmDraft(phase.draft)
      } else if (phase.name === 'idle' || phase.name === 'notice') {
        void submit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDraft, hideWindow, phase, submit])

  return (
    <div className="capture-stage">
      <div className={`capture-card${leaving ? ' capture-card--leaving' : ''}`}>
        <div className="moss-window-drag" aria-hidden="true" />
        <div className="capture-kicker">Quick capture</div>

        {locked ? (
          <p className="capture-status capture-status--muted" role="status">
            MOSS is locked — unlock your profile first.
          </p>
        ) : (
          <>
            <input
              ref={inputRef}
              className={[
                'capture-input',
                placeholderCycling && placeholderFading ? 'capture-input--placeholder-fade' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              type="text"
              value={text}
              onChange={(event) => handleTextChange(event.target.value)}
              placeholder={placeholder}
              aria-label="Quick capture"
              readOnly={
                phase.name === 'busy' || phase.name === 'thinking' || phase.name === 'confirm'
              }
              spellCheck={false}
              autoComplete="off"
            />

            <div className="capture-status-row" role="status" aria-live="polite">
              {phase.name === 'idle' && (
                <span className="capture-status capture-status--muted">
                  Enter to log · Esc to close
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
              {phase.name === 'done' && <span className="capture-status">{phase.message}</span>}
              {phase.name === 'notice' && (
                <span className="capture-status capture-status--notice">{phase.message}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
