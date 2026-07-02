import { useState } from 'react'
import type { ClassWeekday } from '@shared/calendar'
import { CLASS_WEEKDAYS, currentDateKey } from '@shared/calendar'

const DAY_LABELS: Record<ClassWeekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setDate(date.getDate() + deltaDays)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Rough default for a 16-week term when user hasn't picked dates yet. */
function defaultTermEndKey(termStartKey: string): string {
  return shiftDateKey(termStartKey, 16 * 7 - 1)
}

interface CalendarClassSchedulePanelProps {
  busy: boolean
  bridgeReady: boolean
  onFlash: (message: string) => void
  onError: (message: string) => void
  onCreated: () => Promise<void>
}

/** Schools whose portals don't export .ics — bulk recurring class meetings in MOSS. */
export function CalendarClassSchedulePanel({
  busy,
  bridgeReady,
  onFlash,
  onError,
  onCreated
}: CalendarClassSchedulePanelProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [days, setDays] = useState<ClassWeekday[]>(['mon', 'wed', 'fri'])
  const [startTime, setStartTime] = useState('10:10')
  const [endTime, setEndTime] = useState('11:00')
  const [termStartKey, setTermStartKey] = useState(currentDateKey())
  const [termEndKey, setTermEndKey] = useState(() => defaultTermEndKey(currentDateKey()))

  function toggleDay(day: ClassWeekday): void {
    setDays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day]
    )
  }

  return (
    <div className="settings-subsection calendar-class-schedule">
      <p className="settings-subsection-label nutrition-mono">Class schedule</p>
      <p className="preference-hint">
        For schools whose portal has no calendar export. Add each course once — MOSS creates
        meetings from semester start through end (your school&apos;s academic calendar has the
        exact dates).
      </p>
      <form
        className="calendar-settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!window.moss?.calendar) return
          void window.moss.calendar
            .createClassSchedule({
              title,
              location: location.trim() || undefined,
              days,
              startTime,
              endTime,
              termStartKey,
              termEndKey
            })
            .then(async (result) => {
              onFlash(`Added ${result.created} class meetings`)
              setTitle('')
              setLocation('')
              await onCreated()
            })
            .catch((err) => {
              onError(err instanceof Error ? err.message : 'Failed to add class schedule')
            })
        }}
      >
        <input
          type="text"
          className="preference-input"
          placeholder="Course — e.g. CHEM 105"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy || !bridgeReady}
          required
        />
        <input
          type="text"
          className="preference-input"
          placeholder="Room — e.g. Sloan 123"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          disabled={busy || !bridgeReady}
        />
        <div className="calendar-class-days" role="group" aria-label="Class days">
          {CLASS_WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={[
                'calendar-class-day-toggle',
                days.includes(day) ? 'calendar-class-day-toggle--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={busy || !bridgeReady}
              onClick={() => toggleDay(day)}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
        </div>
        <div className="calendar-class-time-row">
          <label className="calendar-class-time-field">
            <span className="calendar-quick-add-label nutrition-mono">Starts</span>
            <input
              type="time"
              className="preference-input"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              disabled={busy || !bridgeReady}
              required
            />
          </label>
          <label className="calendar-class-time-field">
            <span className="calendar-quick-add-label nutrition-mono">Ends</span>
            <input
              type="time"
              className="preference-input"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              disabled={busy || !bridgeReady}
              required
            />
          </label>
        </div>
        <div className="calendar-class-time-row">
          <label className="calendar-class-time-field">
            <span className="calendar-quick-add-label nutrition-mono">Semester starts</span>
            <input
              type="date"
              className="preference-input"
              value={termStartKey}
              onChange={(event) => setTermStartKey(event.target.value)}
              disabled={busy || !bridgeReady}
              required
            />
          </label>
          <label className="calendar-class-time-field">
            <span className="calendar-quick-add-label nutrition-mono">Semester ends</span>
            <input
              type="date"
              className="preference-input"
              value={termEndKey}
              min={termStartKey}
              onChange={(event) => setTermEndKey(event.target.value)}
              disabled={busy || !bridgeReady}
              required
            />
          </label>
        </div>
        <button
          type="submit"
          className="calendar-settings-button calendar-settings-button--primary"
          disabled={busy || !bridgeReady || !title.trim() || days.length === 0}
        >
          Add class schedule
        </button>
      </form>
    </div>
  )
}
