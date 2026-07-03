import type { CalendarSourceRecord, CalendarSyncAllResult } from '@shared/calendar'
import { listCalendarSources } from './calendar'
import { syncIcsSource } from './calendarIcs'
import { syncCaldavSource } from './calendarCaldav'
import { syncGoogleSource } from './calendarGoogle'

export interface CalendarSourceSyncResult {
  sourceId: string
  label: string
  kind: CalendarSourceRecord['kind']
  imported: number
  updated: number
  stale: boolean
  error?: string
}

export async function syncAllCalendarSources(): Promise<CalendarSyncAllResult> {
  const sources = listCalendarSources().filter((source) => source.enabled)
  const results: CalendarSourceSyncResult[] = []

  for (const source of sources) {
    if (source.kind !== 'google' && source.kind !== 'ics_url' && source.kind !== 'caldav') {
      continue
    }

    try {
      if (source.kind === 'google') {
        const sync = await syncGoogleSource(source.id)
        results.push({
          sourceId: source.id,
          label: source.label,
          kind: source.kind,
          imported: sync.imported,
          updated: sync.updated,
          stale: sync.stale
        })
      } else {
        const sync =
          source.kind === 'caldav'
            ? await syncCaldavSource(source.id)
            : await syncIcsSource(source.id)
        results.push({
          sourceId: source.id,
          label: source.label,
          kind: source.kind,
          imported: sync.imported,
          updated: sync.updated,
          stale: false
        })
      }
    } catch (err) {
      results.push({
        sourceId: source.id,
        label: source.label,
        kind: source.kind,
        imported: 0,
        updated: 0,
        stale: true,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return {
    results,
    staleCount: results.filter((entry) => entry.stale).length
  }
}
