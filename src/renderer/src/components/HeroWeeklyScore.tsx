import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WeeklyScoreSnapshot } from '@shared/weeklyScore'

interface HeroWeeklyScoreProps {
  snapshot: WeeklyScoreSnapshot | null
  loading?: boolean
  enterClassName?: string
}

const PANEL_VIEWPORT_MARGIN = 8

/**
 * Weekly score's dashboard home (QA-07/QA-23): a quiet chip in the hero —
 * no new door, no shell geometry. One tap opens the plain-words breakdown.
 * Empty weeks say "not enough logged" — never a fake number.
 *
 * The breakdown panel portals to the app root with fixed positioning: the
 * hero is overflow:hidden (rounded-corner ambient mask), so an in-place
 * absolute panel clipped at the hero's bottom edge (QA2-11). The panel flips
 * above the chip when the viewport below is too short and clamps horizontally.
 */
export function HeroWeeklyScore({
  snapshot,
  loading = false,
  enterClassName = ''
}: HeroWeeklyScoreProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  const positionPanel = useCallback((): void => {
    const chip = chipRef.current
    const panel = panelRef.current
    if (!chip || !panel) return
    const rect = chip.getBoundingClientRect()
    const fitsBelow =
      rect.bottom + PANEL_VIEWPORT_MARGIN + panel.offsetHeight <=
      window.innerHeight - PANEL_VIEWPORT_MARGIN
    const top = fitsBelow
      ? rect.bottom + PANEL_VIEWPORT_MARGIN
      : Math.max(PANEL_VIEWPORT_MARGIN, rect.top - PANEL_VIEWPORT_MARGIN - panel.offsetHeight)
    const left = Math.min(
      Math.max(PANEL_VIEWPORT_MARGIN, rect.left),
      Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - panel.offsetWidth - PANEL_VIEWPORT_MARGIN)
    )
    setPanelPos({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (open) positionPanel()
    else setPanelPos(null)
  }, [open, positionPanel])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        chipRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', positionPanel)
    window.addEventListener('scroll', positionPanel, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', positionPanel)
      window.removeEventListener('scroll', positionPanel, true)
    }
  }, [open, positionPanel])

  if (!snapshot && !loading) return null

  const ready = snapshot?.status === 'ready' && snapshot.score !== null
  const chipValue = loading && !snapshot ? '—' : ready ? `${snapshot!.score} / 100` : 'not enough logged'

  const panel =
    open && snapshot ? (
      <div
        id={panelId}
        ref={panelRef}
        className="hero-weekly-score-panel"
        role="group"
        aria-label="Weekly score breakdown"
        style={
          panelPos
            ? { top: panelPos.top, left: panelPos.left }
            : { top: 0, left: 0, visibility: 'hidden' }
        }
      >
        <p className="hero-weekly-score-headline">{snapshot.headline}</p>
        <ul className="hero-weekly-score-pillars">
          {snapshot.pillars.map((pillar) => (
            <li key={pillar.id} className="hero-weekly-score-pillar">
              <span className="hero-weekly-score-pillar-label">{pillar.label}</span>
              <span className="hero-weekly-score-pillar-value">
                {pillar.trustworthy && pillar.score !== null ? pillar.score : '—'}
              </span>
              <span className="hero-weekly-score-pillar-summary">{pillar.summary}</span>
            </li>
          ))}
        </ul>
        <p className="hero-weekly-score-hint">{snapshot.hint}</p>
      </div>
    ) : null

  return (
    <div className={['hero-weekly-score', enterClassName].filter(Boolean).join(' ')} ref={rootRef}>
      <button
        ref={chipRef}
        type="button"
        className="hero-weekly-score-chip"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          loading && !snapshot
            ? 'Weekly score: loading'
            : ready
            ? `Weekly score: ${snapshot!.score} out of 100. Open breakdown`
            : 'Weekly score: not enough logged. Open breakdown'
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="hero-weekly-score-chip-label">Weekly score</span>
        <span
          className={[
            'hero-weekly-score-chip-value',
            ready ? '' : 'hero-weekly-score-chip-value--empty'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {chipValue}
        </span>
      </button>

      {panel ? createPortal(panel, document.getElementById('root') ?? document.body) : null}
    </div>
  )
}
