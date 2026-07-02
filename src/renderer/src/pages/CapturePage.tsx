import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureConfirmResult, CaptureSubmitResult } from '@shared/capture'
import { formatMoneyUserError } from '@shared/money'
import { loadPreferencesFromStore } from '@shared/preferences'
import { applyPreferencesToDocument } from '../context/PreferencesProvider'

type CapturePhase =
  | { name: 'idle' }
  | { name: 'busy' }
  | { name: 'confirm'; draft: CaptureConfirmResult }
  | { name: 'done'; message: string; leaving: boolean }
  | { name: 'notice'; message: string }

const FADE_START_MS = 1300
const HIDE_MS = 1750

export function CapturePage(): React.JSX.Element {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<CapturePhase>({ name: 'idle' })
  // This window has its own renderer: profile phase from ProfileProvider never
  // reaches 'active' here (that happens through the main window's picker), so
  // ask main directly and pull the profile's theme/motion prefs while at it.
  const [locked, setLocked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<number[]>([])

  const syncProfileState = useCallback(async (): Promise<void> => {
    try {
      const active = await window.moss.profiles.getActive()
      setLocked(!active)
      if (active) {
        applyPreferencesToDocument(await loadPreferencesFromStore(active.profile.id))
      }
    } catch {
      setLocked(true)
    }
  }, [])

  const clearTimers = useCallback((): void => {
    for (const id of timersRef.current) {
      window.clearTimeout(id)
    }
    timersRef.current = []
  }, [])

  const reset = useCallback((): void => {
    clearTimers()
    setText('')
    setPhase({ name: 'idle' })
    inputRef.current?.focus()
  }, [clearTimers])

  const hideWindow = useCallback((): void => {
    clearTimers()
    void window.moss.capture.hide()
    setText('')
    setPhase({ name: 'idle' })
  }, [clearTimers])

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
  // lock state + theme prefs whenever it reappears.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        reset()
        void syncProfileState()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [reset, syncProfileState])

  useEffect(() => {
    inputRef.current?.focus()
    void syncProfileState()
  }, [syncProfileState])

  useEffect(() => clearTimers, [clearTimers])

  const scheduleFadeOut = useCallback(
    (message: string): void => {
      clearTimers()
      setPhase({ name: 'done', message, leaving: false })
      timersRef.current.push(
        window.setTimeout(() => {
          setPhase({ name: 'done', message, leaving: true })
        }, FADE_START_MS),
        window.setTimeout(() => {
          hideWindow()
        }, HIDE_MS)
      )
    },
    [clearTimers, hideWindow]
  )

  const applyResult = useCallback(
    (result: CaptureSubmitResult): void => {
      if (result.status === 'logged') {
        scheduleFadeOut(result.message)
      } else if (result.status === 'confirm') {
        setPhase({ name: 'confirm', draft: result })
      } else {
        setPhase({ name: 'notice', message: result.message })
      }
    },
    [scheduleFadeOut]
  )

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    setPhase({ name: 'busy' })
    try {
      applyResult(await window.moss.capture.submit(trimmed))
    } catch (err) {
      setPhase({ name: 'notice', message: formatMoneyUserError(err) })
    }
  }, [applyResult, text])

  const confirmDraft = useCallback(async (draft: CaptureConfirmResult): Promise<void> => {
    setPhase({ name: 'busy' })
    try {
      await window.moss.nutrition.commitDescribePlate(draft.plate)
      scheduleFadeOut(`Logged ${draft.message}`)
    } catch (err) {
      setPhase({ name: 'notice', message: formatMoneyUserError(err) })
    }
  }, [scheduleFadeOut])

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

  const leaving = phase.name === 'done' && phase.leaving

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
              className="capture-input"
              type="text"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                if (phase.name === 'notice') setPhase({ name: 'idle' })
              }}
              placeholder="$12 chipotle · 2 eggs and toast · dentist tuesday 2pm"
              aria-label="Quick capture"
              readOnly={phase.name === 'busy' || phase.name === 'confirm' || phase.name === 'done'}
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
