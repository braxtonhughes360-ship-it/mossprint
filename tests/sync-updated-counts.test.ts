import { beforeEach, describe, expect, it, vi } from 'vitest'
// The app's better-sqlite3 build targets Electron's ABI, so unit tests use Node's built-in
// sqlite instead — the sync paths only touch prepare/get/all/run/exec, shared by both.
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../src/main/sqlite'
import type { ParsedFeedEntry, ParsedFeedMeta } from '../src/main/newsFetch'

const testDbRef = vi.hoisted(() => ({ db: null as SqliteDatabase | null }))

const feedRef = vi.hoisted(() => ({
  entries: [] as Array<{
    externalId: string
    title: string
    url: string
    summary: string
    imageUrl: string
    publishedAt: string
  }>,
  notModified: false
}))

vi.mock('../src/main/database', () => ({
  getDb: () => {
    if (!testDbRef.db) throw new Error('test database not initialized')
    return testDbRef.db
  }
}))

vi.mock('../src/main/newsFetch', () => ({
  fetchAndParseFeed: async (): Promise<{
    meta: ParsedFeedMeta
    entries: ParsedFeedEntry[]
    notModified: boolean
  }> => ({
    meta: { title: 'Example News', etag: null, lastModified: null },
    entries: feedRef.entries,
    notModified: feedRef.notModified
  }),
  deriveSourceName: (url: string) => new URL(url).hostname,
  upgradeImageUrl: (url: string) => url,
  discoverFeedUrl: async (url: string) => url
}))

import { importIcsFromString } from '../src/main/calendarIcs'
import { syncNewsSource } from '../src/main/news'

const CALENDAR_SCHEMA = `
  CREATE TABLE calendar_sources (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    sync_token TEXT,
    last_sync_at TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT REFERENCES calendar_sources(id) ON DELETE SET NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'local',
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'general',
    course_id TEXT,
    recurrence_rule TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`

const NEWS_SCHEMA = `
  CREATE TABLE news_sources (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    trust INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    etag TEXT,
    last_modified TEXT,
    last_fetched_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE news_items (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL REFERENCES news_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(source_id, external_id)
  );
`

/** DTSTART/DTEND values inside the importer's -90/+365 day window, ICS basic format. */
function icsUtc(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function buildIcs(events: Array<{ uid: string; summary: string; day: number }>): string {
  const blocks = events.map(
    (event) => `BEGIN:VEVENT
UID:${event.uid}
DTSTART:${icsUtc(event.day)}
DTEND:${icsUtc(event.day + 0.05)}
SUMMARY:${event.summary}
END:VEVENT`
  )
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MOSS test//EN
${blocks.join('\n')}
END:VCALENDAR`
}

function eventRows(): Array<Record<string, unknown>> {
  return testDbRef.db!
    .prepare('SELECT * FROM calendar_events ORDER BY external_id')
    .all() as Array<Record<string, unknown>>
}

describe('calendar ICS sync — honest updated counts (W4f)', () => {
  beforeEach(() => {
    const raw = new DatabaseSync(':memory:')
    raw.exec(CALENDAR_SCHEMA)
    testDbRef.db = raw as unknown as SqliteDatabase
  })

  it('re-importing an unchanged feed counts 0 updated and writes nothing', () => {
    const ics = buildIcs([
      { uid: 'evt-1', summary: 'Dentist', day: 2 },
      { uid: 'evt-2', summary: 'Standup', day: 3 }
    ])

    const first = importIcsFromString(ics, 'Test cal')
    expect(first.imported).toBe(2)
    expect(first.updated).toBe(0)
    const stampsAfterFirst = eventRows().map((row) => row.updated_at)

    const second = importIcsFromString(ics, 'Test cal')
    expect(second.imported).toBe(0)
    expect(second.updated).toBe(0)
    expect(eventRows().map((row) => row.updated_at)).toEqual(stampsAfterFirst)
  })

  it('a changed event counts as exactly 1 updated', () => {
    importIcsFromString(buildIcs([{ uid: 'evt-1', summary: 'Dentist', day: 2 }]), 'Test cal')

    const result = importIcsFromString(
      buildIcs([{ uid: 'evt-1', summary: 'Dentist — moved', day: 2 }]),
      'Test cal'
    )
    expect(result.imported).toBe(0)
    expect(result.updated).toBe(1)
    expect(eventRows()[0]!.title).toBe('Dentist — moved')
  })

  it('a soft-deleted event coming back counts as updated (resurrect is a real write)', () => {
    const both = buildIcs([
      { uid: 'evt-1', summary: 'Dentist', day: 2 },
      { uid: 'evt-2', summary: 'Standup', day: 3 }
    ])
    const onlyFirst = buildIcs([{ uid: 'evt-1', summary: 'Dentist', day: 2 }])

    importIcsFromString(both, 'Test cal')
    importIcsFromString(onlyFirst, 'Test cal')
    expect(eventRows().filter((row) => row.deleted_at !== null)).toHaveLength(1)

    const result = importIcsFromString(both, 'Test cal')
    expect(result.imported).toBe(0)
    expect(result.updated).toBe(1)
    expect(eventRows().filter((row) => row.deleted_at !== null)).toHaveLength(0)
  })
})

describe('news sync — honest updated counts (W4f)', () => {
  const sourceId = 'src-1'

  function seedSource(): void {
    testDbRef.db!
      .prepare(
        `INSERT INTO news_sources (id, url, title, created_at)
         VALUES (?, 'https://example.com/feed', 'Example News', '2026-07-01T00:00:00.000Z')`
      )
      .run(sourceId)
  }

  function entry(overrides: Partial<ParsedFeedEntry> = {}): ParsedFeedEntry {
    return {
      externalId: 'item-1',
      title: 'Headline',
      url: 'https://example.com/story-1',
      summary: 'Summary',
      imageUrl: '',
      publishedAt: '2026-07-10T08:00:00.000Z',
      ...overrides
    }
  }

  function itemRows(): Array<Record<string, unknown>> {
    return testDbRef.db!
      .prepare('SELECT * FROM news_items ORDER BY external_id')
      .all() as Array<Record<string, unknown>>
  }

  beforeEach(() => {
    const raw = new DatabaseSync(':memory:')
    raw.exec(NEWS_SCHEMA)
    testDbRef.db = raw as unknown as SqliteDatabase
    feedRef.notModified = false
    seedSource()
  })

  it('re-syncing unchanged entries counts 0 updated', async () => {
    feedRef.entries = [entry(), entry({ externalId: 'item-2', url: 'https://example.com/story-2' })]

    const first = await syncNewsSource(sourceId)
    expect(first.imported).toBe(2)
    expect(first.updated).toBe(0)

    const second = await syncNewsSource(sourceId)
    expect(second.imported).toBe(0)
    expect(second.updated).toBe(0)
  })

  it('a fabricated publishedAt alone (AP fallback) neither counts nor re-freshens the story', async () => {
    feedRef.entries = [entry({ publishedAt: '2026-07-10T08:00:00.000Z' })]
    await syncNewsSource(sourceId)

    feedRef.entries = [entry({ publishedAt: new Date().toISOString() })]
    const result = await syncNewsSource(sourceId)

    expect(result.updated).toBe(0)
    expect(itemRows()[0]!.published_at).toBe('2026-07-10T08:00:00.000Z')
  })

  it('a changed entry counts as exactly 1 updated', async () => {
    feedRef.entries = [entry(), entry({ externalId: 'item-2', url: 'https://example.com/story-2' })]
    await syncNewsSource(sourceId)

    feedRef.entries = [
      entry({ title: 'Headline — corrected' }),
      entry({ externalId: 'item-2', url: 'https://example.com/story-2' })
    ]
    const result = await syncNewsSource(sourceId)

    expect(result.imported).toBe(0)
    expect(result.updated).toBe(1)
    expect(itemRows()[0]!.title).toBe('Headline — corrected')
  })
})
