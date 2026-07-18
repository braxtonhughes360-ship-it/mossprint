import type { CalendarWeekGlance } from '@shared/calendar'
import {
  currentDateKey,
  formatEventScheduleLabel,
  formatWeekLabel
} from '@shared/calendar'

interface CalendarWeekStripProps {
  glance: CalendarWeekGlance
}

export function CalendarWeekStrip({ glance }: CalendarWeekStripProps): React.JSX.Element {
  const todayKey = currentDateKey()
  const next = glance.nextEvent

  return (
    <section className="calendar-week-instrument" aria-label="Week summary">
      <div className="calendar-week-instrument-head">
        <div className="calendar-week-instrument-summary">
          <span className="calendar-week-instrument-kicker nutrition-mono">This week</span>
          <span className="calendar-week-instrument-line nutrition-mono">
            {glance.eventCount === 0
              ? 'Open week'
              : `${glance.eventCount} event${glance.eventCount === 1 ? '' : 's'}`}
          </span>
          <span className="calendar-week-instrument-week nutrition-mono">
            {formatWeekLabel(glance.weekStartKey)}
          </span>
        </div>

        <div className="calendar-week-instrument-next">
          <span className="calendar-week-instrument-kicker nutrition-mono">
            {next ? 'Next event' : 'Upcoming'}
          </span>
          {next ? (
            <>
              <span className="calendar-week-instrument-next-time nutrition-mono">
                {formatEventScheduleLabel(next.startAt, todayKey)}
              </span>
              <span className="calendar-week-instrument-next-title">{next.title}</span>
            </>
          ) : (
            <span className="calendar-week-instrument-next-empty">
              Nothing scheduled ahead
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
