import { useState } from 'react'
import type { CalendarEventKind, CalendarEventRecord } from '@shared/calendar'
import { CALENDAR_EVENT_KINDS, formatEventKindLabel } from '@shared/calendar'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'
import { MossDateField } from './MossDateField'
import { MossCheckbox } from './MossCheckbox'
import { MossButton } from './MossButton'

function isoToDateKey(iso: string): string {
  const date = new Date(iso)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isoToTimeValue(iso: string): string {
  const date = new Date(iso)
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function buildIso(dateKey: string, time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new Error('Invalid date')
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

interface CalendarEventEditModalProps {
  event: CalendarEventRecord
  busy: boolean
  /** Opt-in student layer — when off, the academic kinds are hidden from the picker. */
  academicsEnabled?: boolean
  onClose: () => void
  onSave: (patch: {
    title: string
    startAt: string
    endAt: string
    kind: CalendarEventKind
    location: string
  }) => Promise<void>
}

export function CalendarEventEditModal({
  event,
  busy,
  academicsEnabled = false,
  onClose,
  onSave
}: CalendarEventEditModalProps): React.JSX.Element {
  const [title, setTitle] = useState(event.title)
  const [dateKey, setDateKey] = useState(isoToDateKey(event.startAt))
  const [startTime, setStartTime] = useState(isoToTimeValue(event.startAt))
  const [endTime, setEndTime] = useState(isoToTimeValue(event.endAt))
  const [kind, setKind] = useState<CalendarEventKind>(event.kind)
  const [location, setLocation] = useState(event.location)

  return (
    <MossModal
      onClose={onClose}
      backdropClassName="calendar-event-modal-backdrop"
      ariaLabelledBy="calendar-event-edit-title"
    >
      <form
        className="calendar-event-modal"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          const startAt = buildIso(dateKey, startTime)
          const endAt = buildIso(dateKey, endTime)
          if (new Date(endAt) <= new Date(startAt)) return
          void onSave({ title: title.trim(), startAt, endAt, kind, location: location.trim() }).then(
            onClose
          )
        }}
      >
        <header className="calendar-event-modal-head">
          <h2 id="calendar-event-edit-title" className="calendar-event-modal-title">
            Edit event
          </h2>
        </header>
        <label className="calendar-class-time-field">
          <span className="calendar-quick-add-label nutrition-mono">Title</span>
          <input
            type="text"
            className="preference-input"
            value={title}
            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
            disabled={busy}
            required
          />
        </label>
        <label className="calendar-class-time-field">
          <span className="calendar-quick-add-label nutrition-mono">Date</span>
          <MossDateField
            type="date"
            value={dateKey}
            onChange={(changeEvent) => setDateKey(changeEvent.target.value)}
            disabled={busy}
            required
          />
        </label>
        <div className="calendar-class-time-row">
          <label className="calendar-class-time-field">
            <span className="calendar-quick-add-label nutrition-mono">Starts</span>
            <MossDateField
              type="time"
              value={startTime}
              onChange={(changeEvent) => setStartTime(changeEvent.target.value)}
              disabled={busy}
              required
            />
          </label>
          <label className="calendar-class-time-field">
            <span className="calendar-quick-add-label nutrition-mono">Ends</span>
            <MossDateField
              type="time"
              value={endTime}
              onChange={(changeEvent) => setEndTime(changeEvent.target.value)}
              disabled={busy}
              required
            />
          </label>
        </div>
        {academicsEnabled && (
          <>
            <MossCheckbox
              label="Academic event"
              description="Add a class, exam, assignment, or office-hours category."
              checked={kind !== 'general'}
              disabled={busy}
              onChange={(changeEvent) => setKind(changeEvent.target.checked ? 'class' : 'general')}
            />
            {kind !== 'general' && (
              <div className="calendar-class-time-field">
                <span className="calendar-quick-add-label nutrition-mono">Kind</span>
                <MossSelect
                  className="moss-select--block"
                  value={kind}
                  options={CALENDAR_EVENT_KINDS.filter((entry) => entry !== 'general').map(
                    (entry) => ({
                      value: entry,
                      label: formatEventKindLabel(entry)
                    })
                  )}
                  onChange={(next) => setKind(next as CalendarEventKind)}
                  disabled={busy}
                  ariaLabel="Event kind"
                />
              </div>
            )}
          </>
        )}
        <label className="calendar-class-time-field">
          <span className="calendar-quick-add-label nutrition-mono">Location</span>
          <input
            type="text"
            className="preference-input"
            value={location}
            onChange={(changeEvent) => setLocation(changeEvent.target.value)}
            disabled={busy}
          />
        </label>
        <div className="calendar-event-modal-actions">
          <MossButton type="button" variant="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </MossButton>
          <MossButton type="submit" disabled={busy || !title.trim()}>
            Save
          </MossButton>
        </div>
      </form>
    </MossModal>
  )
}
