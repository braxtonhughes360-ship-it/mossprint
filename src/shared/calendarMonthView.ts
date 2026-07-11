import type { CalendarEventKind, CalendarEventRecord, CalendarSourceRecord } from './calendar'
import { formatEventKindLabel, formatTimeLabel } from './calendar'

/** Max event chips shown in a month cell before "+N more". */
export const CALENDAR_MONTH_MAX_VISIBLE_CHIPS = 3

export function eventsForDay(
  events: CalendarEventRecord[],
  dateKey: string,
  eventOnDateKey: (event: CalendarEventRecord, key: string) => boolean
): CalendarEventRecord[] {
  return events
    .filter((event) => eventOnDateKey(event, dateKey))
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title))
}

export function partitionMonthDayEvents(
  dayEvents: CalendarEventRecord[],
  maxVisible = CALENDAR_MONTH_MAX_VISIBLE_CHIPS
): { visible: CalendarEventRecord[]; overflow: number } {
  if (dayEvents.length <= maxVisible) {
    return { visible: dayEvents, overflow: 0 }
  }
  return {
    visible: dayEvents.slice(0, maxVisible),
    overflow: dayEvents.length - maxVisible
  }
}

export function calendarSourceLabel(
  sourceId: string | null,
  sources: CalendarSourceRecord[]
): string {
  if (!sourceId) return 'MOSS'
  return sources.find((source) => source.id === sourceId)?.label ?? 'Calendar'
}

export function formatMonthEventDetail(
  event: CalendarEventRecord,
  sourceLabel: string,
  academicsEnabled: boolean
): string {
  const timeRange = `${formatTimeLabel(event.startAt)} – ${formatTimeLabel(event.endAt)}`
  const parts = [event.title, timeRange, sourceLabel]
  if (academicsEnabled && event.kind !== 'general') {
    parts.push(formatEventKindLabel(event.kind))
  }
  return parts.join(' · ')
}

export function compactMonthDotsLabel(count: number, firstTitle: string | undefined): string {
  const countLabel = `${count} event${count === 1 ? '' : 's'}`
  if (!firstTitle) return countLabel
  return `${countLabel}. First: ${firstTitle}`
}

export function isAcademicEventKind(kind: CalendarEventKind): boolean {
  return kind !== 'general'
}
