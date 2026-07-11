import '../CalendarPage.css'
import '../ShellPlaceholderPage.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarEventKind } from '@shared/calendar'
import {
  currentDateKey,
  currentMonthKey,
  formatMonthLabel,
  formatWeekLabel,
  monthRangeIso,
  shiftMonthKey,
  shiftWeekKey,
  startOfWeekKey,
  weekRangeIso
} from '@shared/calendar'
import { MODULE_VISUAL } from '@shared/modules'
import { usePreferences } from '../context/PreferencesProvider'
import { CalendarMonthPanel } from '../components/CalendarMonthPanel'
import { CalendarWeekPanel } from '../components/CalendarWeekPanel'
import { CalendarWeekStrip } from '../components/CalendarWeekStrip'
import { GoalsWeekPanel } from '../components/GoalsWeekPanel'

type CalendarView = 'week' | 'month' | 'goals'

export function CalendarPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.calendar
  const { preferences } = usePreferences()
  const academicsEnabled = preferences.modules.calendar.academicsEnabled
  const [view, setView] = useState<CalendarView>('week')
  const [weekStartKey, setWeekStartKey] = useState(() => startOfWeekKey(currentDateKey()))
  const [monthKey, setMonthKey] = useState(() => currentMonthKey())
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const bridgeReady = Boolean(window.moss?.calendar)
  const didSyncRef = useRef(false)

  const isCurrentWeek = weekStartKey === startOfWeekKey(currentDateKey())

  // Week-scoped events + glance — refetched when the week changes.
  const weekQuery = useQuery({
    queryKey: ['calendar', 'week', weekStartKey],
    queryFn: async () => {
      const range = weekRangeIso(weekStartKey)
      const [events, glance] = await Promise.all([
        window.moss.calendar.listEvents(range),
        window.moss.calendar.getWeekGlance(weekStartKey)
      ])
      return { events, glance }
    },
    enabled: bridgeReady
  })

  const sourcesQuery = useQuery({
    queryKey: ['calendar', 'sources'],
    queryFn: () => window.moss.calendar.listSources(),
    enabled: bridgeReady
  })

  const monthQuery = useQuery({
    queryKey: ['calendar', 'month', monthKey],
    queryFn: () => window.moss.calendar.getMonthGlance(monthKey),
    enabled: Boolean(window.moss?.calendar?.getMonthGlance) && view === 'month'
  })

  const monthEventsQuery = useQuery({
    queryKey: ['calendar', 'month-events', monthKey],
    queryFn: () => window.moss.calendar.listEvents(monthRangeIso(monthKey)),
    enabled: bridgeReady && view === 'month'
  })

  const events = weekQuery.data?.events ?? []
  const glance = weekQuery.data?.glance ?? null
  const monthGlance = monthQuery.data ?? null
  const monthEvents = monthEventsQuery.data ?? []
  const staleCount = (sourcesQuery.data ?? []).filter(
    (source) => source.enabled && source.stale
  ).length

  const loadError =
    weekQuery.error ?? sourcesQuery.error ?? monthQuery.error ?? monthEventsQuery.error
  const queryError = !bridgeReady
    ? 'Calendar storage unavailable — open MOSS via npm run dev (Electron window), not localhost in a browser tab alone.'
    : loadError
      ? loadError instanceof Error
        ? loadError.message
        : 'Failed to load calendar'
      : null
  const error = mutationError ?? queryError

  const syncSources = useCallback(async () => {
    if (!window.moss?.calendar?.syncAllSources) return
    setSyncing(true)
    try {
      const result = await window.moss.calendar.syncAllSources()
      if (result.results.length > 0) {
        const imported = result.results.reduce((sum, entry) => sum + entry.imported, 0)
        const errors = result.results.filter((entry) => entry.error)
        if (errors.length > 0) {
          setMutationError(
            errors.map((entry) => `${entry.label}: ${entry.error}`).join(' · ')
          )
        }
        if (imported > 0) {
          setFlash(`Synced · ${imported} new event${imported === 1 ? '' : 's'}`)
        } else if (errors.length === 0) {
          // Existing events get refreshed every sync; that count isn't meaningful
          // to surface — only genuinely new events are worth flagging.
          setFlash('Synced — up to date')
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['calendar'] })
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Calendar sync failed')
    } finally {
      setSyncing(false)
    }
  }, [queryClient])

  const isCurrentMonth = monthKey === currentMonthKey()

  const selectDayFromMonth = useCallback((dateKey: string) => {
    setWeekStartKey(startOfWeekKey(dateKey))
    setView('week')
  }, [])

  useEffect(() => {
    if (!bridgeReady || didSyncRef.current) return
    didSyncRef.current = true
    // Let route arrival finish before sync work — avoids banner layout shift on entry.
    const id = window.setTimeout(() => void syncSources(), 340)
    return () => window.clearTimeout(id)
  }, [bridgeReady, syncSources])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(timer)
  }, [flash])

  async function runMutation(task: () => Promise<void>): Promise<void> {
    if (!window.moss?.calendar) return
    setBusy(true)
    try {
      await task()
      await queryClient.invalidateQueries({ queryKey: ['calendar'] })
      setMutationError(null)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="moss-arrival moss-arrival-calendar"
      data-module="calendar"
      data-texture={visual.texture}
    >
      <header className="moss-arrival-band calendar-arrival-band">
        <div className="moss-arrival-band-inner module-arrival-head calendar-arrival-head">
          <div className="module-arrival-title-block">
            <h1 className="display-arrival">Calendar</h1>
          </div>

          <div className="module-arrival-meta-block calendar-arrival-week-block">
            <div className="calendar-view-toggle" role="tablist" aria-label="Calendar view">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'week'}
                className={['calendar-view-toggle-btn', view === 'week' ? 'calendar-view-toggle-btn--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setView('week')}
              >
                Week
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'month'}
                className={['calendar-view-toggle-btn', view === 'month' ? 'calendar-view-toggle-btn--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setView('month')}
              >
                Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'goals'}
                className={['calendar-view-toggle-btn', view === 'goals' ? 'calendar-view-toggle-btn--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setView('goals')}
              >
                Goals
              </button>
            </div>
            {view !== 'goals' && (
            <div className="calendar-week-nav">
              {view === 'week' ? (
                <>
                  <button
                    type="button"
                    className="calendar-week-nav-button"
                    aria-label="Previous week"
                    onClick={() => setWeekStartKey((key) => shiftWeekKey(key, -1))}
                  >
                    ←
                  </button>
                  <p className="calendar-arrival-week nutrition-mono">{formatWeekLabel(weekStartKey)}</p>
                  <button
                    type="button"
                    className="calendar-week-nav-button"
                    aria-label="Next week"
                    onClick={() => setWeekStartKey((key) => shiftWeekKey(key, 1))}
                  >
                    →
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="calendar-week-nav-button"
                    aria-label="Previous month"
                    onClick={() => setMonthKey((key) => shiftMonthKey(key, -1))}
                  >
                    ←
                  </button>
                  <p className="calendar-arrival-week nutrition-mono">{formatMonthLabel(monthKey)}</p>
                  <button
                    type="button"
                    className="calendar-week-nav-button"
                    aria-label="Next month"
                    onClick={() => setMonthKey((key) => shiftMonthKey(key, 1))}
                  >
                    →
                  </button>
                </>
              )}
              {(syncing || staleCount > 0) && (
                <button
                  type="button"
                  className={[
                    'calendar-sync-indicator',
                    syncing ? 'calendar-sync-indicator--syncing' : '',
                    staleCount > 0 && !syncing ? 'calendar-sync-indicator--stale' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={
                    syncing
                      ? 'Syncing calendars'
                      : `Sync now — ${staleCount} source${staleCount === 1 ? '' : 's'} need attention`
                  }
                  title={
                    syncing
                      ? 'Syncing calendars…'
                      : `${staleCount} source${staleCount === 1 ? '' : 's'} need attention — sync now`
                  }
                  disabled={syncing || busy}
                  onClick={() => void syncSources()}
                >
                  <span className="calendar-sync-glyph" aria-hidden />
                </button>
              )}
            </div>
            )}
            {view === 'week' && !isCurrentWeek && (
              <button
                type="button"
                className="calendar-week-today"
                onClick={() => setWeekStartKey(startOfWeekKey(currentDateKey()))}
              >
                Back to this week
              </button>
            )}
            {view === 'month' && !isCurrentMonth && (
              <button
                type="button"
                className="calendar-week-today"
                onClick={() => setMonthKey(currentMonthKey())}
              >
                Back to this month
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="moss-arrival-body calendar-arrival-body">
        {view === 'week' && glance && <CalendarWeekStrip glance={glance} />}

        {flash && <p className="calendar-flash">{flash}</p>}
        {error && (
          <div className="calendar-error-banner" role="alert">
            <p className="calendar-error">{error}</p>
            {!bridgeReady && (
              <p className="calendar-error-hint">
                After pulling updates, fully quit and restart the MOSS app so the calendar bridge
                reloads.
              </p>
            )}
          </div>
        )}

        {view === 'week' ? (
          <CalendarWeekPanel
            weekStartKey={weekStartKey}
            events={events}
            busy={busy || syncing || !bridgeReady}
            academicsEnabled={academicsEnabled}
            onDelete={(id) =>
              runMutation(async () => {
                await window.moss.calendar.deleteEvent(id)
                setFlash('Event removed')
              })
            }
            onUpdate={(id, patch) =>
              runMutation(async () => {
                await window.moss.calendar.updateEvent(id, patch)
                setFlash('Event updated')
              })
            }
            onCreate={(input) =>
              runMutation(async () => {
                await window.moss.calendar.createEvent({
                  title: input.title,
                  startAt: input.startAt,
                  endAt: input.endAt,
                  kind: input.kind as CalendarEventKind
                })
                setWeekStartKey(startOfWeekKey(input.dateKey))
                setFlash('Event added')
              })
            }
          />
        ) : view === 'month' && monthGlance ? (
          <CalendarMonthPanel
            glance={monthGlance}
            events={monthEvents}
            sources={sourcesQuery.data ?? []}
            academicsEnabled={academicsEnabled}
            onSelectDay={selectDayFromMonth}
          />
        ) : view === 'goals' ? (
          <div className="calendar-goals-view">
            <GoalsWeekPanel weekStartKey={weekStartKey} onWeekChange={setWeekStartKey} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
