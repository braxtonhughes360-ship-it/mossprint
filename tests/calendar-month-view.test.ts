import { describe, expect, it } from 'vitest'
import type { CalendarEventRecord } from '@shared/calendar'
import {
  CALENDAR_MONTH_MAX_VISIBLE_CHIPS,
  calendarSourceLabel,
  compactMonthDotsLabel,
  eventsForDay,
  formatMonthEventDetail,
  partitionMonthDayEvents
} from '@shared/calendarMonthView'
import { eventOnDateKey } from '@shared/calendar'

function sampleEvent(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: 'evt-1',
    sourceId: null,
    externalId: null,
    title: 'Team standup',
    startAt: '2026-07-15T14:00:00.000Z',
    endAt: '2026-07-15T14:30:00.000Z',
    timezone: 'UTC',
    location: '',
    notes: '',
    kind: 'general',
    courseId: null,
    recurrenceRule: null,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('calendarMonthView', () => {
  it('sorts day events by start time then title', () => {
    const events = [
      sampleEvent({ id: 'b', title: 'Beta', startAt: '2026-07-15T16:00:00.000Z' }),
      sampleEvent({ id: 'a', title: 'Alpha', startAt: '2026-07-15T09:00:00.000Z' }),
      sampleEvent({ id: 'c', title: 'Charlie', startAt: '2026-07-15T09:00:00.000Z' })
    ]
    const dayEvents = eventsForDay(events, '2026-07-15', eventOnDateKey)
    expect(dayEvents.map((event) => event.id)).toEqual(['a', 'c', 'b'])
  })

  it('partitions overflow for dense days', () => {
    const dayEvents = Array.from({ length: 4 }, (_, index) =>
      sampleEvent({ id: `evt-${index}`, title: `Event ${index}` })
    )
    const { visible, overflow } = partitionMonthDayEvents(dayEvents)
    expect(visible).toHaveLength(CALENDAR_MONTH_MAX_VISIBLE_CHIPS)
    expect(overflow).toBe(1)
  })

  it('formats tooltip detail with source and kind', () => {
    const detail = formatMonthEventDetail(
      sampleEvent({ kind: 'exam', sourceId: 'src-1' }),
      'Work Google',
      true
    )
    expect(detail).toContain('Team standup')
    expect(detail).toContain('Work Google')
    expect(detail).toContain('Exam')
  })

  it('labels MOSS events without a source id', () => {
    expect(calendarSourceLabel(null, [])).toBe('MOSS')
  })

  it('builds compact dot aria labels', () => {
    expect(compactMonthDotsLabel(4, 'Dentist')).toBe('4 events. First: Dentist')
    expect(compactMonthDotsLabel(1, undefined)).toBe('1 event')
  })
})
