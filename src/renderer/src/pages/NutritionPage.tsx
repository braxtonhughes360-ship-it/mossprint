import '../NutritionPage.css'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentDateKey,
  formatDateKeyLabel,
  shiftDateKey
} from '@shared/nutrition'
import { MODULE_VISUAL } from '@shared/modules'
import { NutritionDiaryPanel } from '../components/NutritionDiaryPanel'
import { NutritionFoodsPanel } from '../components/NutritionFoodsPanel'
import { NutritionGoalsPanel } from '../components/NutritionGoalsPanel'
import { NutritionMacroStrip } from '../components/NutritionMacroStrip'
import { MossPanelTransition } from '../components/MossPanelTransition'

type NutritionTab = 'diary' | 'foods' | 'goals'

export function NutritionPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.nutrition
  const [dateKey, setDateKey] = useState(() => currentDateKey())
  const [tab, setTab] = useState<NutritionTab>('diary')
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  // Day-scoped diary — refetched when the date changes.
  const diaryQuery = useQuery({
    queryKey: ['nutrition', dateKey],
    queryFn: () => window.moss.nutrition.getDiary(dateKey),
    enabled: Boolean(window.moss?.nutrition)
  })

  // Date-independent lookup/provider state.
  const lookupQuery = useQuery({
    queryKey: ['nutrition', 'lookup'],
    queryFn: () => window.moss.nutrition.getLookupState(),
    enabled: Boolean(window.moss?.nutrition)
  })

  const diary = diaryQuery.data ?? null
  const lookupState = lookupQuery.data ?? null

  const loadError = diaryQuery.error ?? lookupQuery.error
  const queryError = !window.moss?.nutrition
    ? 'Nutrition storage unavailable'
    : loadError
      ? loadError instanceof Error
        ? loadError.message
        : 'Failed to load nutrition data'
      : null
  const error = mutationError ?? queryError

  async function runMutation(task: () => Promise<void>, successMessage?: string): Promise<void> {
    setBusy(true)
    try {
      await task()
      await queryClient.invalidateQueries({ queryKey: ['nutrition'] })
      setMutationError(null)
      if (successMessage) {
        setFlash(successMessage)
      }
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(timer)
  }, [flash])

  const isToday = dateKey === currentDateKey()
  const lookupHint =
    lookupState && lookupState.usdaFoundationCount === 0
      ? 'Import USDA foundation foods under Foods for offline generic matches — no API key needed.'
      : null

  return (
    <div className="moss-arrival moss-arrival-nutrition" data-module="nutrition" data-texture={visual.texture}>
      <header className="moss-arrival-band nutrition-arrival-band">
        <div className="moss-arrival-band-inner module-arrival-head nutrition-arrival-head">
          <div className="module-arrival-title-block nutrition-arrival-title-block">
            <p className="nutrition-arrival-kicker">{visual.tag}</p>
            <h1 className="display-arrival">Nutrition</h1>
          </div>

          <div className="module-arrival-meta-block nutrition-arrival-date-block">
            <div className="nutrition-date-nav">
              <button
                type="button"
                className="nutrition-date-button"
                aria-label="Previous day"
                onClick={() => setDateKey((key) => shiftDateKey(key, -1))}
              >
                ←
              </button>
              <p className="nutrition-arrival-date nutrition-mono">{formatDateKeyLabel(dateKey)}</p>
              <button
                type="button"
                className="nutrition-date-button"
                aria-label="Next day"
                disabled={isToday}
                onClick={() => setDateKey((key) => shiftDateKey(key, 1))}
              >
                →
              </button>
            </div>
            {!isToday && (
              <button
                type="button"
                className="nutrition-date-today"
                onClick={() => setDateKey(currentDateKey())}
              >
                Back to today
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="moss-arrival-body nutrition-arrival-body">
        {diary && <NutritionMacroStrip diary={diary} />}

        <div className="nutrition-tab-bar" role="tablist" aria-label="Nutrition views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'diary'}
            className={['nutrition-tab', tab === 'diary' ? 'nutrition-tab--active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('diary')}
          >
            Diary
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'foods'}
            className={['nutrition-tab', tab === 'foods' ? 'nutrition-tab--active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('foods')}
          >
            Foods
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'goals'}
            className={['nutrition-tab', tab === 'goals' ? 'nutrition-tab--active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('goals')}
          >
            Goals
          </button>
        </div>

        {flash && <p className="nutrition-flash">{flash}</p>}
        {error && <p className="nutrition-error">{error}</p>}

        <MossPanelTransition transitionKey={tab}>
          {tab === 'diary' && diary && (
            <NutritionDiaryPanel
              diary={diary}
              dateKey={dateKey}
              busy={busy}
              lookupHint={lookupHint}
              llmModel={lookupState?.describeLlmModel ?? null}
              onMutate={runMutation}
            />
          )}

          {tab === 'foods' && <NutritionFoodsPanel busy={busy} onMutate={runMutation} />}

          {tab === 'goals' && diary && (
            <NutritionGoalsPanel goals={diary.goals} busy={busy} onMutate={runMutation} />
          )}
        </MossPanelTransition>
      </div>
    </div>
  )
}
