import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CaptureCommitInput,
  CaptureConfirmResult,
  CaptureKind,
  CaptureSubmitResult
} from '@shared/capture'
import { currentDateKey } from '@shared/calendar'
import { classifyCapture } from '@shared/captureClassify'
import { formatMoneyUserError } from '@shared/money'

export type CapturePhase =
  | { name: 'idle' }
  | { name: 'busy' }
  | { name: 'thinking' }
  | { name: 'confirm'; draft: CaptureConfirmResult }
  | { name: 'done'; message: string; leaving?: boolean }
  | { name: 'notice'; message: string }

export const CAPTURE_PLACEHOLDER_CYCLE_MS = 3200
export const CAPTURE_PLACEHOLDER_FADE_MS = 280
const FADE_START_MS = 1300
const HIDE_MS = 1750

function captureNeedsLlmRoute(text: string): boolean {
  return classifyCapture(text, currentDateKey()).kind === 'none'
}

function confirmPayloadForDraft(draft: CaptureConfirmResult): CaptureCommitInput | null {
  if (draft.kind === 'money') return { kind: 'money', money: draft.money }
  if (draft.kind === 'calendar') return { kind: 'calendar', calendar: draft.calendar }
  if (draft.kind === 'note') return { kind: 'note', note: draft.note }
  return null
}

export type CaptureFlowVariant = 'window' | 'dashboard'

export interface UseCaptureFlowOptions {
  locked: boolean
  placeholderExamples: readonly string[]
  variant: CaptureFlowVariant
  placeholderCycling: boolean
  onLogged?: (kind: CaptureKind) => void
}

export interface UseCaptureFlowResult {
  text: string
  setText: (value: string) => void
  handleTextChange: (value: string) => void
  phase: CapturePhase
  lastLoggedKind: CaptureKind | null
  placeholderIndex: number
  placeholderFading: boolean
  placeholder: string
  inputRef: React.RefObject<HTMLInputElement | null>
  submit: () => Promise<void>
  confirmDraft: (draft: CaptureConfirmResult) => Promise<void>
  reset: () => void
  hideWindow: () => void
  leaving: boolean
}

export function useCaptureFlow({
  locked,
  placeholderExamples,
  variant,
  placeholderCycling,
  onLogged
}: UseCaptureFlowOptions): UseCaptureFlowResult {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<CapturePhase>({ name: 'idle' })
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [placeholderFading, setPlaceholderFading] = useState(false)
  const [lastLoggedKind, setLastLoggedKind] = useState<CaptureKind | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<number[]>([])
  const submitGenerationRef = useRef(0)

  const placeholderStatic = placeholderExamples.join(' · ')

  const clearTimers = useCallback((): void => {
    for (const id of timersRef.current) {
      window.clearTimeout(id)
    }
    timersRef.current = []
  }, [])

  const hideWindow = useCallback((): void => {
    if (variant !== 'window') return
    submitGenerationRef.current += 1
    clearTimers()
    void window.moss.capture.hide()
    setText('')
    setPhase({ name: 'idle' })
    setLastLoggedKind(null)
  }, [clearTimers, variant])

  const reset = useCallback((): void => {
    submitGenerationRef.current += 1
    clearTimers()
    setText('')
    setPhase({ name: 'idle' })
    setLastLoggedKind(null)
    if (variant === 'window') {
      inputRef.current?.focus()
    }
  }, [clearTimers, variant])

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    if (!placeholderCycling || phase.name !== 'idle' || text.trim() || locked) {
      setPlaceholderFading(false)
      return
    }

    let fadeTimer = 0
    const cycleTimer = window.setInterval(() => {
      setPlaceholderFading(true)
      fadeTimer = window.setTimeout(() => {
        setPlaceholderIndex((index) => (index + 1) % placeholderExamples.length)
        setPlaceholderFading(false)
      }, CAPTURE_PLACEHOLDER_FADE_MS)
    }, CAPTURE_PLACEHOLDER_CYCLE_MS)

    return () => {
      window.clearInterval(cycleTimer)
      window.clearTimeout(fadeTimer)
    }
  }, [locked, phase.name, placeholderCycling, placeholderExamples.length, text])

  const scheduleFadeOut = useCallback(
    (message: string, kind: CaptureKind): void => {
      clearTimers()
      setLastLoggedKind(kind)
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

  const finishLogged = useCallback(
    (message: string, kind: CaptureKind): void => {
      onLogged?.(kind)
      setLastLoggedKind(kind)
      if (variant === 'window') {
        scheduleFadeOut(message, kind)
      } else {
        setPhase({ name: 'done', message })
      }
    },
    [onLogged, scheduleFadeOut, variant]
  )

  const applyResult = useCallback(
    (result: CaptureSubmitResult): void => {
      if (result.status === 'logged') {
        finishLogged(result.message, result.kind)
      } else if (result.status === 'confirm') {
        setPhase({ name: 'confirm', draft: result })
      } else {
        setPhase({ name: 'notice', message: result.message })
      }
    },
    [finishLogged]
  )

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || locked) return
    const generation = submitGenerationRef.current + 1
    submitGenerationRef.current = generation
    setPhase(captureNeedsLlmRoute(trimmed) ? { name: 'thinking' } : { name: 'busy' })
    try {
      const result = await window.moss.capture.submit(trimmed)
      if (generation !== submitGenerationRef.current) return
      applyResult(result)
    } catch (err) {
      if (generation !== submitGenerationRef.current) return
      setPhase({ name: 'notice', message: formatMoneyUserError(err) })
    }
  }, [applyResult, locked, text])

  const confirmDraft = useCallback(
    async (draft: CaptureConfirmResult): Promise<void> => {
      const generation = submitGenerationRef.current + 1
      submitGenerationRef.current = generation
      setPhase({ name: 'busy' })
      try {
        if (draft.kind === 'nutrition') {
          await window.moss.nutrition.commitDescribePlate(draft.plate)
          if (generation !== submitGenerationRef.current) return
          finishLogged(`Logged ${draft.message}`, 'nutrition')
          return
        }

        const payload = confirmPayloadForDraft(draft)
        if (!payload) return

        const result = await window.moss.capture.confirm(payload)
        if (generation !== submitGenerationRef.current) return
        finishLogged(result.message, payload.kind)
      } catch (err) {
        if (generation !== submitGenerationRef.current) return
        setPhase({ name: 'notice', message: formatMoneyUserError(err) })
      }
    },
    [finishLogged]
  )

  const placeholder =
    placeholderCycling && phase.name === 'idle' && !text.trim()
      ? placeholderExamples[placeholderIndex]
      : placeholderStatic

  const leaving = phase.name === 'done' && Boolean(phase.leaving)

  const handleTextChange = useCallback(
    (value: string): void => {
      setText(value)
      if (phase.name === 'notice') setPhase({ name: 'idle' })
    },
    [phase.name]
  )

  return {
    text,
    setText,
    handleTextChange,
    phase,
    lastLoggedKind,
    placeholderIndex,
    placeholderFading,
    placeholder,
    inputRef,
    submit,
    confirmDraft,
    reset,
    hideWindow,
    leaving
  }
}
