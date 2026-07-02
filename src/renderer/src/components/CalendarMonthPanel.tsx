import type { CalendarMonthGlance, CalendarMonthGlanceDay } from '@shared/calendar'
import { currentDateKey, formatDayStamp, monthGridCells } from '@shared/calendar'

interface CalendarMonthPanelProps {
  glance: CalendarMonthGlance
  /** Jump into the week view focused on the chosen day. */
  onSelectDay: (dateKey: string) => void
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Compact month overview — a 7-column grid with per-day event density. */
export function CalendarMonthPanel({ glance, onSelectDay }: CalendarMonthPanelProps): React.JSX.Element {
  const cells = monthGridCells(glance.monthKey)
  const today = currentDateKey()
  const byKey = new Map<string, CalendarMonthGlanceDay>(glance.days.map((day) => [day.dateKey, day]))

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
          const day = byKey.get(dateKey)
          const count = day?.count ?? 0
          const dayNum = Number(dateKey.slice(8, 10))
          const isToday = dateKey === today
          return (
            <button
              key={dateKey}
              type="button"
              className={[
                'calendar-month-cell',
                isToday ? 'calendar-month-cell--today' : '',
                count > 0 ? 'calendar-month-cell--has' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDay(dateKey)}
              aria-label={`${formatDayStamp(dateKey)} — ${count} event${count === 1 ? '' : 's'}`}
            >
              <span className="calendar-month-cell-num nutrition-mono">{dayNum}</span>
              {count > 0 && (
                <span
                  className={[
                    'calendar-month-cell-marks',
                    day?.hasAcademic ? 'calendar-month-cell-marks--academic' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {count <= 3 ? (
                    Array.from({ length: count }, (_, dot) => (
                      <span key={dot} className="calendar-month-dot" />
                    ))
                  ) : (
                    <span className="calendar-month-count nutrition-mono">{count}</span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
