import { useMemo, useRef, useState } from 'react'
import type { CaptureSubmitResult } from '@shared/capture'
import type { CalendarEventKind, CalendarEventRecord } from '@shared/calendar'
import {
  CALENDAR_EVENT_KINDS,
  currentDateKey,
  eventOnDateKey,
  eventsOverlap,
  formatDayShortLabel,
  formatEventKindLabel,
  formatTimeLabel,
  isManualCalendarEvent,
  weekDayKeys
} from '@shared/calendar'
import { parseQuickEventText, resolveQuickEventInput } from '@shared/calendarEventParse'
import { CalendarEventEditModal } from './CalendarEventEditModal'
import { MossSelect } from './MossSelect'

const DURATION_OPTIONS = [
  { value: '30', label: '30m' },
  { value: '60', label: '1h' },
  { value: '90', label: '1.5h' },
  { value: '120', label: '2h' }
]

/** Warm the local model once per app session, on first focus (LocalAI plan §2 rule 5). */
let warmedThisSession = false

function warmOnFirstFocus(): void {
  if (warmedThisSession) return
  warmedThisSession = true
  void window.moss.localai.warm().catch(() => undefined)
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDurationLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
}

interface CalendarWeekPanelProps {
  weekStartKey: string
  events: CalendarEventRecord[]
  busy: boolean
  /** Opt-in student layer — when off, no academic kinds in quick-add and no kind badges. */
  academicsEnabled?: boolean
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, patch: {
    title: string
    startAt: string
    endAt: string
    kind: CalendarEventKind
    location: string
  }) => Promise<void>
  onCreate: (input: {
    title: string
    startAt: string
    endAt: string
    kind: CalendarEventKind
    dateKey: string
  }) => Promise<void>
}

function conflictingIdsForDay(dayEvents: CalendarEventRecord[]): Set<string> {
  const ids = new Set<string>()
  for (let i = 0; i < dayEvents.length; i += 1) {
    for (let j = i + 1; j < dayEvents.length; j += 1) {
      if (eventsOverlap(dayEvents[i], dayEvents[j])) {
        ids.add(dayEvents[i].id)
        ids.add(dayEvents[j].id)
      }
    }
  }
  return ids
}

export function CalendarWeekPanel({
  weekStartKey,
  events,
  busy,
  academicsEnabled = false,
  onDelete,
  onUpdate,
  onCreate
}: CalendarWeekPanelProps): React.JSX.Element {
  const todayKey = currentDateKey()
  const days = weekDayKeys(weekStartKey)
  const [addDateKey, setAddDateKey] = useState(todayKey)
  const [query, setQuery] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [kind, setKind] = useState<CalendarEventKind>('general')
  const [editingEvent, setEditingEvent] = useState<CalendarEventRecord | null>(null)
  const [thinking, setThinking] = useState(false)
  // Set after the LLM populates the override fields — the next Add submits as
  // today instead of asking the model again. Cleared when the user edits.
  const llmPopulatedRef = useRef(false)

  const preview = useMemo(() => {
    if (!query.trim()) return null
    return resolveQuickEventInput({
      text: query,
      dateKey: addDateKey,
      startTime,
      durationMinutes,
      kind,
      weekStartKey,
      todayKey
    })
  }, [query, addDateKey, startTime, durationMinutes, kind, weekStartKey, todayKey])

  const parsedHints = useMemo(() => {
    if (!query.trim()) return null
    return parseQuickEventText(query, {
      weekStartKey,
      fallbackDateKey: addDateKey,
      todayKey
    })
  }, [query, weekStartKey, addDateKey, todayKey])

  // The LLM may land a date outside the visible week or an off-list duration —
  // surface those honestly as extra options instead of showing a blank select.
  const dayOptions = useMemo(() => {
    const base = days.map((dayKey) => ({
      value: dayKey,
      label: `${formatDayShortLabel(dayKey)} ${dayKey.slice(5)}`
    }))
    if (!days.includes(addDateKey)) {
      base.push({
        value: addDateKey,
        label: `${formatDayShortLabel(addDateKey)} ${addDateKey.slice(5)}`
      })
    }
    return base
  }, [days, addDateKey])

  const durationOptions = useMemo(() => {
    if (DURATION_OPTIONS.some((option) => option.value === String(durationMinutes))) {
      return DURATION_OPTIONS
    }
    return [
      ...DURATION_OPTIONS,
      { value: String(durationMinutes), label: formatDurationLabel(durationMinutes) }
    ]
  }, [durationMinutes])

  function createResolvedEvent(): void {
    const resolved = resolveQuickEventInput({
      text: query,
      dateKey: addDateKey,
      startTime,
      durationMinutes,
      kind,
      weekStartKey,
      todayKey
    })
    if (!resolved) return

    void onCreate({
      title: resolved.title,
      startAt: resolved.startAt,
      endAt: resolved.endAt,
      kind: academicsEnabled ? resolved.kind : 'general',
      dateKey: resolved.dateKey
    }).then(() => {
      llmPopulatedRef.current = false
      setQuery('')
      setStartTime('09:00')
      setDurationMinutes(60)
      setKind('general')
      setAddDateKey(todayKey)
    })
  }

  async function submitQuickAdd(): Promise<void> {
    if (busy || thinking || !query.trim()) return

    // LLM fallthrough ONLY on a full parse miss (plan §LA2 D): phrases where
    // parseQuickEventText finds a date or a time behave byte-identically to
    // today. The model's guess lands in the override fields — they are the
    // correction surface — and the user submits again (LLM writes confirm).
    const fullMiss = parsedHints !== null && parsedHints.dateKey === null && parsedHints.hour === null
    if (fullMiss && !llmPopulatedRef.current) {
      setThinking(true)
      let result: CaptureSubmitResult | null = null
      try {
        result = await window.moss.localai.describePreview(query.trim(), 'calendar')
      } catch {
        result = null
      }
      setThinking(false)

      if (result && result.status === 'confirm' && result.kind === 'calendar') {
        const start = new Date(result.calendar.startAt)
        const end = new Date(result.calendar.endAt)
        if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
          llmPopulatedRef.current = true
          setQuery(result.calendar.title)
          setAddDateKey(localDateKey(start))
          setStartTime(
            `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
          )
          const minutes = Math.round((end.getTime() - start.getTime()) / 60_000)
          if (minutes > 0) setDurationMinutes(minutes)
          return
        }
      }
      // No model / non-calendar read → exactly today's behavior: create from
      // the override fields. The input never gets worse than it is now.
    }

    createResolvedEvent()
  }

  return (
    <section className="calendar-week-panel" aria-label="Week schedule">
      {editingEvent && isManualCalendarEvent(editingEvent) && (
        <CalendarEventEditModal
          event={editingEvent}
          busy={busy}
          academicsEnabled={academicsEnabled}
          onClose={() => setEditingEvent(null)}
          onSave={(patch) => onUpdate(editingEvent.id, patch)}
        />
      )}

      <form
        className="calendar-quick-add calendar-quick-add--toolbar"
        onSubmit={(event) => {
          event.preventDefault()
          void submitQuickAdd()
        }}
      >
        <label className="calendar-quick-add-field calendar-quick-add-field--primary">
          <span className="calendar-quick-add-label nutrition-mono">Add event</span>
          <input
            name="query"
            type="text"
            className="calendar-quick-add-input calendar-quick-add-input--primary"
            placeholder="Beach next Saturday at 6pm · dentist in 2 weeks on Tuesday at 5pm"
            aria-label="Event description"
            value={query}
            onChange={(event) => {
              llmPopulatedRef.current = false
              setQuery(event.target.value)
            }}
            onFocus={warmOnFirstFocus}
            disabled={busy}
          />
        </label>
        <label className="calendar-quick-add-field calendar-quick-add-field--compact">
          <span className="calendar-quick-add-label nutrition-mono">Time</span>
          <input
            name="startTime"
            type="time"
            className="calendar-quick-add-select calendar-quick-add-time"
            disabled={busy}
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            aria-label="Start time"
          />
        </label>
        <div className="calendar-quick-add-field calendar-quick-add-field--compact">
          <span className="calendar-quick-add-label nutrition-mono">Day</span>
          <MossSelect
            className="moss-select--calendar"
            value={addDateKey}
            options={dayOptions}
            onChange={setAddDateKey}
            disabled={busy}
            ariaLabel="Event day"
          />
        </div>
        <div className="calendar-quick-add-field calendar-quick-add-field--compact">
          <span className="calendar-quick-add-label nutrition-mono">Length</span>
          <MossSelect
            className="moss-select--calendar"
            value={String(durationMinutes)}
            options={durationOptions}
            onChange={(next) => setDurationMinutes(Number(next))}
            disabled={busy}
            ariaLabel="Event duration"
          />
        </div>
        {academicsEnabled && (
          <div className="calendar-quick-add-field calendar-quick-add-field--compact">
            <span className="calendar-quick-add-label nutrition-mono">Kind</span>
            <MossSelect
              className="moss-select--calendar"
              value={kind}
              options={CALENDAR_EVENT_KINDS.map((entry) => ({
                value: entry,
                label: formatEventKindLabel(entry)
              }))}
              onChange={(next) => setKind(next as CalendarEventKind)}
              disabled={busy}
              ariaLabel="Event kind"
            />
          </div>
        )}
        <button
          type="submit"
          className="calendar-quick-add-submit"
          disabled={busy || thinking || !query.trim()}
        >
          {thinking ? 'Thinking…' : 'Add'}
        </button>
        {(preview || parsedHints) && query.trim() && (
          <p className="calendar-quick-add-preview nutrition-mono" aria-live="polite">
            {thinking
              ? 'Thinking…'
              : preview
                ? `${preview.title} · ${formatDayShortLabel(preview.dateKey)} ${formatTimeLabel(preview.startAt)}`
                : 'Parsing…'}
            {!thinking && parsedHints && parsedHints.hour !== null && parsedHints.dateKey
              ? ' · from text'
              : ''}
          </p>
        )}
      </form>

      <div className="calendar-week-grid">
        {days.map((dayKey) => {
          const dayEvents = events.filter((event) => eventOnDateKey(event, dayKey))
          const conflicts = conflictingIdsForDay(dayEvents)
          const isToday = dayKey === todayKey

          return (
            <div
              key={dayKey}
              className={[
                'calendar-week-day',
                isToday ? 'calendar-week-day--today' : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <header className="calendar-week-day-head">
                <div className="calendar-week-day-head-main">
                  <span className="calendar-week-day-label nutrition-mono">
                    {formatDayShortLabel(dayKey)}
                  </span>
                  {isToday && (
                    <span className="calendar-week-day-today-badge nutrition-mono">Today</span>
                  )}
                </div>
                <span className="calendar-week-day-date nutrition-mono">{dayKey.slice(5)}</span>
              </header>

              <ul className="calendar-week-day-events" aria-label={`Events on ${dayKey}`}>
                {dayEvents.length === 0 ? (
                  <li className="calendar-week-day-empty nutrition-mono">Open</li>
                ) : (
                  dayEvents.map((event) => {
                    const editable = isManualCalendarEvent(event)
                    return (
                      <li
                        key={event.id}
                        className={[
                          'calendar-week-event',
                          conflicts.has(event.id) ? 'calendar-week-event--conflict' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <button
                          type="button"
                          className="calendar-week-event-main calendar-week-event-open"
                          disabled={busy}
                          onClick={() => {
                            if (editable) {
                              setEditingEvent(event)
                            }
                          }}
                          title={
                            editable
                              ? 'Edit event'
                              : 'Synced from calendar — edit in Google/ICS source, then Sync now'
                          }
                        >
                          <span className="calendar-week-event-time nutrition-mono">
                            {formatTimeLabel(event.startAt)}
                          </span>
                          <span className="calendar-week-event-title">{event.title}</span>
                          {event.location && (
                            <span className="calendar-week-event-location nutrition-mono">
                              {event.location}
                            </span>
                          )}
                          {academicsEnabled && event.kind !== 'general' && (
                            <span
                              className={[
                                'calendar-week-event-kind nutrition-mono',
                                `calendar-week-event-kind--${event.kind}`
                              ].join(' ')}
                            >
                              {formatEventKindLabel(event.kind)}
                            </span>
                          )}
                          {conflicts.has(event.id) && (
                            <span className="calendar-week-event-conflict nutrition-mono">Overlap</span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="calendar-week-event-delete"
                          aria-label={`Delete ${event.title}`}
                          disabled={busy || !editable}
                          onClick={() => void onDelete(event.id)}
                        >
                          ×
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
