import { useMemo } from 'react'
import type {
  CalendarEventRecord,
  CalendarMonthGlance,
  CalendarSourceRecord
} from '@shared/calendar'
import {
  currentDateKey,
  eventOnDateKey,
  formatDayStamp,
  formatTimeLabel,
  monthGridCells
} from '@shared/calendar'
import {
  calendarSourceLabel,
  compactMonthDotsLabel,
  eventsForDay,
  formatMonthEventDetail,
  isAcademicEventKind,
  partitionMonthDayEvents
} from '@shared/calendarMonthView'

interface CalendarMonthPanelProps {
  glance: CalendarMonthGlance
  events: CalendarEventRecord[]
  sources: CalendarSourceRecord[]
  academicsEnabled?: boolean
  /** Jump into the week view focused on the chosen day. */
  onSelectDay: (dateKey: string) => void
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function openDay(
  event: React.MouseEvent | React.KeyboardEvent,
  dateKey: string,
  onSelectDay: (dateKey: string) => void
): void {
  event.stopPropagation()
  onSelectDay(dateKey)
}

/** Compact month overview — a 7-column grid with per-day event chips or density dots. */
export function CalendarMonthPanel({
  glance,
  events,
  sources,
  academicsEnabled = false,
  onSelectDay
}: CalendarMonthPanelProps): React.JSX.Element {
  const cells = monthGridCells(glance.monthKey)
  const today = currentDateKey()
  const sourceLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of sources) {
      map.set(source.id, source.label)
    }
    return map
  }, [sources])

  function labelForEvent(event: CalendarEventRecord): string {
    const sourceLabel = event.sourceId
      ? (sourceLabels.get(event.sourceId) ?? calendarSourceLabel(event.sourceId, sources))
      : calendarSourceLabel(null, sources)
    return formatMonthEventDetail(event, sourceLabel, academicsEnabled)
  }

  return (
    <section className="calendar-month" aria-label="Month overview">
      <div className="calendar-month-grid calendar-month-head" aria-hidden>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="calendar-month-weekday nutrition-mono">
            {label}
          </span>
        ))}
      </div>
      <div className="calendar-month-grid">
        {cells.map((dateKey, index) => {
          if (!dateKey) {
            return (
              <span
                key={`pad-${index}`}
                className="calendar-month-cell calendar-month-cell--pad"
                aria-hidden
              />
            )
          }

          const dayEvents = eventsForDay(events, dateKey, eventOnDateKey)
          const count = dayEvents.length
          const { visible, overflow } = partitionMonthDayEvents(dayEvents)
          const dayNum = Number(dateKey.slice(8, 10))
          const isToday = dateKey === today
          const hasAcademic = dayEvents.some((event) => isAcademicEventKind(event.kind))
          const dotsLabel = compactMonthDotsLabel(count, dayEvents[0]?.title)
          const firstDetail = dayEvents[0] ? labelForEvent(dayEvents[0]) : undefined

          return (
            <div
              key={dateKey}
              className={[
                'calendar-month-cell',
                isToday ? 'calendar-month-cell--today' : '',
                count > 0 ? 'calendar-month-cell--has' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              role="group"
              aria-label={`${formatDayStamp(dateKey)} — ${count} event${count === 1 ? '' : 's'}`}
            >
              <button
                type="button"
                className="calendar-month-cell-day"
                aria-label={`Open ${formatDayStamp(dateKey)}`}
                onClick={() => onSelectDay(dateKey)}
              >
                <span className="calendar-month-cell-num nutrition-mono">{dayNum}</span>
              </button>

              {count > 0 && (
                <>
                  <div
                    className={[
                      'calendar-month-cell-events calendar-month-cell-events--chips',
                      hasAcademic ? 'calendar-month-cell-events--academic' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {visible.map((event) => {
                      const detail = labelForEvent(event)
                      const academic = isAcademicEventKind(event.kind)
                      return (
                        <button
                          key={event.id}
                          type="button"
                          className={[
                            'calendar-month-event-chip',
                            academic ? 'calendar-month-event-chip--academic' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={detail}
                          aria-label={detail}
                          onClick={(eventClick) => openDay(eventClick, dateKey, onSelectDay)}
                          onKeyDown={(keyEvent) => {
                            if (keyEvent.key === 'Enter') {
                              openDay(keyEvent, dateKey, onSelectDay)
                            }
                          }}
                        >
                          <span className="calendar-month-event-chip-time nutrition-mono">
                            {formatTimeLabel(event.startAt)}
                          </span>
                          <span className="calendar-month-event-chip-title">{event.title}</span>
                        </button>
                      )
                    })}
                    {overflow > 0 && (
                      <button
                        type="button"
                        className="calendar-month-more nutrition-mono"
                        onClick={(eventClick) => openDay(eventClick, dateKey, onSelectDay)}
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key === 'Enter') {
                            openDay(keyEvent, dateKey, onSelectDay)
                          }
                        }}
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>

                  <div
                    className={[
                      'calendar-month-cell-events calendar-month-cell-events--compact',
                      hasAcademic ? 'calendar-month-cell-events--academic' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button
                      type="button"
                      className="calendar-month-cell-dots"
                      title={firstDetail}
                      aria-label={dotsLabel}
                      onClick={() => onSelectDay(dateKey)}
                    >
                      {count <= 3 ? (
                        Array.from({ length: count }, (_, dot) => (
                          <span key={dot} className="calendar-month-dot" aria-hidden />
                        ))
                      ) : (
                        <span className="calendar-month-count nutrition-mono">{count}</span>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
