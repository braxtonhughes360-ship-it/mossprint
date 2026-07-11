import { randomUUID } from 'node:crypto'
import type {
  AddNewsSourceInput,
  NewsBriefing,
  NewsBriefingMode,
  NewsBriefingOptions,
  NewsBriefingSection,
  NewsBriefingSourceHealth,
  NewsBriefingStory,
  NewsDoorSnapshot,
  NewsItemRecord,
  NewsSourceRecord,
  NewsSyncAllResult,
  NewsSyncResult,
  NewsWidgetLayout
} from '@shared/news'
import { formatNewsAgeLabel, briefNewsSummary, dedupeNewsItemsByTitle, normalizeNewsStoryTitle } from '@shared/news'
import { getDb } from './database'
import { fetchAndParseFeed, deriveSourceName, upgradeImageUrl, discoverFeedUrl } from './newsFetch'
import { categoryForFeedUrl } from '@shared/newsBundles'
import { resolveSourceLogoUrl } from '@shared/newsBranding'

const MAX_STORED_ITEMS_PER_SOURCE = 40

/** Known-bad catalog URLs → working replacements (auto-fixed on sync). */
const FEED_URL_UPGRADES: Record<string, string> = {
  'https://www.columbian.com/rss/': 'https://www.columbian.com/feed/',
  'https://www.opb.org/rss/': 'https://www.opb.org/arc/outboundfeeds/rss/?outputType=xml',
  'https://www.kgw.com/arc/outboundfeeds/rss/?outputType=xml': 'https://www.kgw.com/rss/'
}

function upgradeFeedUrlIfKnown(sourceId: string, url: string): string {
  const next = FEED_URL_UPGRADES[url]
  if (!next || next === url) return url
  getDb().prepare('UPDATE news_sources SET url = ? WHERE id = ?').run(next, sourceId)
  return next
}

interface SourceRow {
  id: string
  url: string
  title: string
  category: string
  trust: number
  priority: number
  enabled: number
  etag: string | null
  last_modified: string | null
  last_fetched_at: string | null
  last_error: string | null
  created_at: string
}

function rowToSource(row: SourceRow): NewsSourceRecord {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    category: row.category,
    trust: row.trust,
    priority: row.priority,
    enabled: row.enabled === 1,
    lastFetchedAt: row.last_fetched_at,
    lastError: row.last_error,
    createdAt: row.created_at
  }
}

export function listNewsSources(): NewsSourceRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, url, title, category, trust, priority, enabled, etag, last_modified,
              last_fetched_at, last_error, created_at
       FROM news_sources
       ORDER BY priority DESC, title ASC`
    )
    .all() as SourceRow[]

  return rows.map(rowToSource)
}

export async function addNewsSource(input: AddNewsSourceInput): Promise<NewsSourceRecord> {
  const url = await discoverFeedUrl(input.url)
  const existing = getDb()
    .prepare('SELECT id FROM news_sources WHERE url = ?')
    .get(url) as { id: string } | undefined
  if (existing) {
    return listNewsSources().find((row) => row.id === existing.id)!
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  // No user label → provisional name from the domain; upgraded to the feed's
  // real <title> on first successful sync (see syncNewsSource).
  const title = input.title?.trim() || deriveSourceName(url)
  // Caller-supplied tag wins; otherwise derive from the curated catalog so
  // reader category filters work without manual tagging.
  const category = categoryForFeedUrl(url) || input.category?.trim() || ''

  getDb()
    .prepare(
      `INSERT INTO news_sources (
         id, url, title, category, trust, priority, enabled, created_at
       ) VALUES (
         @id, @url, @title, @category, 1, 0, 1, @createdAt
       )`
    )
    .run({ id, url, title, category, createdAt: now })

  return listNewsSources().find((row) => row.id === id)!
}

export function deleteNewsSource(sourceId: string): { ok: true } {
  getDb().prepare('DELETE FROM news_sources WHERE id = ?').run(sourceId)
  return { ok: true }
}

export function setNewsSourceEnabled(sourceId: string, enabled: boolean): NewsSourceRecord {
  getDb()
    .prepare('UPDATE news_sources SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, sourceId)

  const row = getDb()
    .prepare(
      `SELECT id, url, title, category, trust, priority, enabled, etag, last_modified,
              last_fetched_at, last_error, created_at
       FROM news_sources WHERE id = ?`
    )
    .get(sourceId) as SourceRow | undefined

  if (!row) throw new Error('News source not found')
  return rowToSource(row)
}

function pruneSourceItems(sourceId: string): void {
  const rows = getDb()
    .prepare(
      `SELECT id FROM news_items WHERE source_id = ?
       ORDER BY published_at DESC`
    )
    .all(sourceId) as { id: string }[]

  for (const row of rows.slice(MAX_STORED_ITEMS_PER_SOURCE)) {
    getDb().prepare('DELETE FROM news_items WHERE id = ?').run(row.id)
  }
}

export async function syncNewsSource(sourceId: string): Promise<NewsSyncResult> {
  const row = getDb()
    .prepare(
      `SELECT id, url, title, category, trust, priority, enabled, etag, last_modified,
              last_fetched_at, last_error, created_at
       FROM news_sources WHERE id = ?`
    )
    .get(sourceId) as SourceRow | undefined

  if (!row) throw new Error('News source not found')

  const feedUrl = upgradeFeedUrlIfKnown(sourceId, row.url)

  let imported = 0
  let updated = 0

  try {
    const { meta, entries, notModified } = await fetchAndParseFeed(feedUrl, {
      etag: row.etag,
      lastModified: row.last_modified
    })

    const now = new Date().toISOString()

    if (!notModified) {
      for (const entry of entries) {
        const existing = getDb()
          .prepare('SELECT id FROM news_items WHERE source_id = ? AND external_id = ?')
          .get(sourceId, entry.externalId) as { id: string } | undefined

        if (existing) {
          getDb()
            .prepare(
              `UPDATE news_items SET title = @title, url = @url, summary = @summary,
                 image_url = @imageUrl, published_at = @publishedAt
               WHERE id = @id`
            )
            .run({
              id: existing.id,
              title: entry.title,
              url: entry.url,
              summary: entry.summary,
              imageUrl: entry.imageUrl,
              publishedAt: entry.publishedAt
            })
          updated += 1
        } else {
          getDb()
            .prepare(
              `INSERT INTO news_items (
                 id, source_id, external_id, title, url, summary, image_url, published_at, read_at, created_at
               ) VALUES (
                 @id, @sourceId, @externalId, @title, @url, @summary, @imageUrl, @publishedAt, NULL, @createdAt
               )`
            )
            .run({
              id: randomUUID(),
              sourceId,
              externalId: entry.externalId,
              title: entry.title,
              url: entry.url,
              summary: entry.summary,
              imageUrl: entry.imageUrl,
              publishedAt: entry.publishedAt,
              createdAt: now
            })
          imported += 1
        }
      }

      pruneSourceItems(sourceId)
    }

    // Upgrade the stored name to the feed's real <title> only while it is still
    // an auto-generated placeholder — never overwrite a user's custom label, and
    // never clobber a good name with an empty 304 response.
    const fetchedTitle = meta.title?.trim()
    const isPlaceholder =
      row.title === 'Feed' || row.title === '' || row.title === deriveSourceName(row.url)
    const label = isPlaceholder ? fetchedTitle || deriveSourceName(row.url) : row.title
    // Backfill the category tag for pre-tagged sources so the reader's
    // National/Local filters light up without re-adding the feed.
    const category = categoryForFeedUrl(row.url) || row.category?.trim() || ''

    getDb()
      .prepare(
        `UPDATE news_sources SET
           title = @title,
           category = @category,
           etag = @etag,
           last_modified = @lastModified,
           last_fetched_at = @lastFetchedAt,
           last_error = NULL
         WHERE id = @id`
      )
      .run({
        id: sourceId,
        title: label,
        category,
        etag: meta.etag,
        lastModified: meta.lastModified,
        lastFetchedAt: now
      })

    return { sourceId, label, imported, updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    getDb()
      .prepare('UPDATE news_sources SET last_error = ?, last_fetched_at = ? WHERE id = ?')
      .run(message, new Date().toISOString(), sourceId)
    return {
      sourceId,
      label: row.title,
      imported: 0,
      updated: 0,
      error: message
    }
  }
}

export async function syncAllNewsSources(): Promise<NewsSyncAllResult> {
  const sources = listNewsSources().filter((source) => source.enabled)
  const results: NewsSyncResult[] = []

  for (const source of sources) {
    const result = await syncNewsSource(source.id)
    results.push(result)
  }

  return {
    results,
    staleCount: results.filter((row) => row.error).length
  }
}

function mapNewsItemRow(row: {
  id: string
  source_id: string
  source_title: string
  external_id: string
  title: string
  url: string
  summary: string
  image_url: string
  published_at: string
  read_at: string | null
  created_at: string
}): NewsItemRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    summary: row.summary,
    imageUrl: row.image_url ?? '',
    sourceLogoUrl: resolveSourceLogoUrl(row.source_title, row.url) ?? undefined,
    publishedAt: row.published_at,
    readAt: row.read_at,
    createdAt: row.created_at
  }
}

export function listNewsItems(limit = 50): NewsItemRecord[] {
  const fetchLimit = Math.min(Math.max(limit * 3, limit), 200)
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.source_id, s.title AS source_title, i.external_id, i.title, i.url,
              i.summary, i.image_url, i.published_at, i.read_at, i.created_at
       FROM news_items i
       INNER JOIN news_sources s ON s.id = i.source_id
       ORDER BY i.published_at DESC
       LIMIT ?`
    )
    .all(fetchLimit) as Array<{
    id: string
    source_id: string
    source_title: string
    external_id: string
    title: string
    url: string
    summary: string
    image_url: string
    published_at: string
    read_at: string | null
    created_at: string
  }>

  return dedupeNewsItemsByTitle(rows.map((row) => mapNewsItemRow(row))).slice(0, limit)
}

export function markNewsItemRead(itemId: string): { ok: true } {
  getDb()
    .prepare('UPDATE news_items SET read_at = ? WHERE id = ? AND read_at IS NULL')
    .run(new Date().toISOString(), itemId)
  return { ok: true }
}

function storyFromItem(
  item: NewsItemRecord,
  now = Date.now()
): NewsBriefingStory {
  return {
    id: item.id,
    title: item.title,
    source: item.sourceTitle,
    sourceLogoUrl: item.sourceLogoUrl ?? resolveSourceLogoUrl(item.sourceTitle, item.url) ?? undefined,
    url: item.url,
    publishedAt: item.publishedAt,
    ageLabel: formatNewsAgeLabel(item.publishedAt, now),
    summary: briefNewsSummary(item.summary),
    imageUrl: upgradeImageUrl(item.imageUrl),
    read: Boolean(item.readAt)
  }
}

const LOCAL_CATEGORY = 'local'
const WORLD_CATEGORY = 'world'
const SECTION_SLOT_COUNT = 4
/** Widget never surfaces stories older than this. */
const BRIEFING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Unread stories newer than this can replace a read slot; otherwise the read story stays. */
const BRIEFING_REPLACE_WINDOW_MS = 48 * 60 * 60 * 1000
/** Hero only considers national/world headlines newer than this. */
const FEATURED_MAX_AGE_MS = 48 * 60 * 60 * 1000

function sourceCategory(source: NewsSourceRecord): string {
  return source.category?.trim() || categoryForFeedUrl(source.url) || ''
}

function isLocalSource(source: NewsSourceRecord): boolean {
  return sourceCategory(source) === LOCAL_CATEGORY
}

function isWorldSource(source: NewsSourceRecord): boolean {
  return source.category === WORLD_CATEGORY
}

function isTopSource(source: NewsSourceRecord): boolean {
  return !isLocalSource(source) && !isWorldSource(source)
}

function briefingMeta(
  sources: NewsSourceRecord[],
  lastFetchedAt: string | null,
  stale: boolean,
  now: number
): Pick<NewsBriefing, 'stale' | 'lastFetchedAt' | 'updatedLabel' | 'sourceHealth'> {
  return {
    stale,
    lastFetchedAt,
    updatedLabel: lastFetchedAt ? formatNewsAgeLabel(lastFetchedAt, now) : null,
    sourceHealth: sources.map(
      (source): NewsBriefingSourceHealth => ({
        id: source.id,
        title: source.title,
        hasError: Boolean(source.lastError),
        lastError: source.lastError ?? undefined
      })
    )
  }
}

function emptyBriefing(
  sources: NewsSourceRecord[],
  lastFetchedAt: string | null,
  stale: boolean,
  now: number
): NewsBriefing {
  return {
    featured: null,
    featuredReason: null,
    items: [],
    sections: [],
    hasLocalFeeds: sources.some((source) => isLocalSource(source)),
    ...briefingMeta(sources, lastFetchedAt, stale, now)
  }
}


function itemAgeMs(item: NewsItemRecord, now: number): number {
  const published = new Date(item.publishedAt).getTime()
  if (!Number.isFinite(published)) return Number.POSITIVE_INFINITY
  return Math.max(0, now - published)
}

function isWithinBriefingAge(item: NewsItemRecord, now: number): boolean {
  return itemAgeMs(item, now) <= BRIEFING_MAX_AGE_MS
}

function layoutSectionCaps(layout: NewsWidgetLayout): {
  topCap: number
  localCap: number
  minHeadlines: number
} {
  switch (layout) {
    case 'compact':
      return { topCap: 2, localCap: 2, minHeadlines: 4 }
    case 'split':
      return { topCap: 3, localCap: 3, minHeadlines: 7 }
    case 'full':
      return { topCap: SECTION_SLOT_COUNT, localCap: SECTION_SLOT_COUNT, minHeadlines: 9 }
  }
}

function sortSectionSources(
  sectionSources: NewsSourceRecord[],
  mode: NewsBriefingMode
): NewsSourceRecord[] {
  return [...sectionSources].sort((a, b) => {
    if (mode === 'priority') {
      const priorityDelta = b.priority - a.priority
      if (priorityDelta !== 0) return priorityDelta
    }
    return a.title.localeCompare(b.title)
  })
}

function orderedSectionCandidates(
  source: NewsSourceRecord,
  pool: NewsItemRecord[],
  now: number
): NewsItemRecord[] {
  const items = pool.filter((item) => isWithinBriefingAge(item, now))
  const byDate = (a: NewsItemRecord, b: NewsItemRecord): number =>
    b.publishedAt.localeCompare(a.publishedAt)
  const unreadFresh = items
    .filter((item) => !item.readAt && itemAgeMs(item, now) <= BRIEFING_REPLACE_WINDOW_MS)
    .sort(byDate)
  const readItems = items.filter((item) => item.readAt).sort(byDate)
  const unreadOlder = items
    .filter((item) => !item.readAt && itemAgeMs(item, now) > BRIEFING_REPLACE_WINDOW_MS)
    .sort(byDate)
  return [...unreadFresh, ...readItems, ...unreadOlder]
}

function pickSectionItems(
  sectionSources: NewsSourceRecord[],
  pools: Map<string, NewsItemRecord[]>,
  cap: number,
  maxPerSource: number,
  mode: NewsBriefingMode,
  seenIds: Set<string>,
  seenTitles: Set<string>,
  now: number
): NewsItemRecord[] {
  if (cap <= 0) return []

  const activeSources = sortSectionSources(
    sectionSources.filter((source) => pools.has(source.id)),
    mode
  )
  if (activeSources.length === 0) return []

  const tryAdd = (item: NewsItemRecord, picked: NewsItemRecord[]): boolean => {
    if (picked.length >= cap) return false
    if (seenIds.has(item.id)) return false
    if (!isWithinBriefingAge(item, now)) return false
    const titleKey = normalizeNewsStoryTitle(item.title)
    if (titleKey && seenTitles.has(titleKey)) return false
    seenIds.add(item.id)
    if (titleKey) seenTitles.add(titleKey)
    picked.push(item)
    return true
  }

  if (mode === 'latest') {
    const candidates = activeSources
      .flatMap((source) => orderedSectionCandidates(source, pools.get(source.id) ?? [], now))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    const picked: NewsItemRecord[] = []
    const countBySource = new Map<string, number>()
    for (const item of candidates) {
      if (picked.length >= cap) break
      const used = countBySource.get(item.sourceId) ?? 0
      if (used >= maxPerSource) continue
      if (tryAdd(item, picked)) {
        countBySource.set(item.sourceId, used + 1)
      }
    }
    return picked
  }

  const queues = new Map<string, NewsItemRecord[]>()
  for (const source of activeSources) {
    queues.set(
      source.id,
      orderedSectionCandidates(source, pools.get(source.id) ?? [], now)
    )
  }

  const picked: NewsItemRecord[] = []
  const countBySource = new Map<string, number>()
  let round = 0

  while (picked.length < cap) {
    let addedThisRound = false
    for (const source of activeSources) {
      if (picked.length >= cap) break
      const used = countBySource.get(source.id) ?? 0
      if (used >= maxPerSource) continue
      const queue = queues.get(source.id) ?? []
      const item = queue[round]
      if (!item) continue
      if (tryAdd(item, picked)) {
        countBySource.set(source.id, used + 1)
        addedThisRound = true
      }
    }
    if (!addedThisRound) break
    round += 1
  }

  return picked
}

function findFreshestItem(pools: Map<string, NewsItemRecord[]>): NewsItemRecord | null {
  let freshest: NewsItemRecord | null = null
  for (const pool of Array.from(pools.values())) {
    const head = pool[0]
    if (head && (!freshest || head.publishedAt > freshest.publishedAt)) {
      freshest = head
    }
  }
  return freshest
}

/** Lead hero — national/world only; prefer recent headlines with photos. */
function pickFeaturedItem(
  sources: NewsSourceRecord[],
  pools: Map<string, NewsItemRecord[]>,
  now: number
): { item: NewsItemRecord | null; reason: string | null } {
  const candidates: NewsItemRecord[] = []
  for (const source of sources) {
    if (isLocalSource(source)) continue
    const head = pools.get(source.id)?.find((item) => isWithinBriefingAge(item, now))
    if (head) candidates.push(head)
  }

  if (candidates.length === 0) {
    const fallback = findFreshestItem(pools)
    return {
      item: fallback,
      reason: fallback ? 'Lead story — newest headline across your feeds' : null
    }
  }

  const score = (item: NewsItemRecord): number => {
    const ageMs = now - new Date(item.publishedAt).getTime()
    const recent = ageMs <= FEATURED_MAX_AGE_MS ? 1_000_000_000_000 : 0
    const hasImage = item.imageUrl?.trim() ? 100_000_000_000 : 0
    const published = new Date(item.publishedAt).getTime()
    return recent + hasImage + published
  }

  candidates.sort((a, b) => score(b) - score(a))
  const winner = candidates[0]!
  const hasImage = Boolean(winner.imageUrl?.trim())
  const reason = hasImage
    ? 'Lead story — newest national headline with a photo'
    : 'Lead story — newest national headline'

  return { item: winner, reason }
}

function allocateSectionCaps(
  layout: NewsWidgetLayout,
  hasTop: boolean,
  hasLocal: boolean
): { topCap: number; localCap: number } {
  const { topCap, localCap } = layoutSectionCaps(layout)
  return {
    topCap: hasTop ? topCap : 0,
    localCap: hasLocal ? localCap : 0
  }
}

function buildSections(
  topItems: NewsItemRecord[],
  localItems: NewsItemRecord[],
  now: number,
  layout: NewsWidgetLayout
): NewsBriefingSection[] {
  const columnLayout = layout === 'compact' || layout === 'split'

  if (columnLayout) {
    return [
      {
        id: 'top',
        label: 'Top stories',
        items: topItems.map((item) => storyFromItem(item, now))
      },
      {
        id: 'local',
        label: 'Local',
        items: localItems.map((item) => storyFromItem(item, now))
      }
    ]
  }

  const sections: NewsBriefingSection[] = []
  if (topItems.length > 0) {
    sections.push({
      id: 'top',
      label: 'Top stories',
      items: topItems.map((item) => storyFromItem(item, now))
    })
  }
  if (localItems.length > 0) {
    sections.push({
      id: 'local',
      label: 'Local',
      items: localItems.map((item) => storyFromItem(item, now))
    })
  }
  return sections
}

export function getNewsBriefing(options: NewsBriefingOptions | number = {}): NewsBriefing {
  const normalized: NewsBriefingOptions =
    typeof options === 'number' ? { maxItems: options } : options

  const layout: NewsWidgetLayout =
    normalized.layout === 'compact' || normalized.layout === 'split' || normalized.layout === 'full'
      ? normalized.layout
      : 'split'
  const mode: NewsBriefingMode = normalized.mode ?? 'balanced'
  const maxPerSource = Math.min(Math.max(normalized.maxPerSource ?? 2, 1), 2)
  const now = Date.now()

  const sources = listNewsSources().filter((source) => source.enabled)
  const lastFetchedAt = sources.reduce<string | null>((latest, source) => {
    if (!source.lastFetchedAt) return latest
    if (!latest || source.lastFetchedAt > latest) return source.lastFetchedAt
    return latest
  }, null)

  const stale = sources.some((source) => source.lastError)

  if (sources.length === 0) {
    return emptyBriefing(sources, lastFetchedAt, stale, now)
  }

  type ItemRow = Parameters<typeof mapNewsItemRow>[0]
  const pools = new Map<string, NewsItemRecord[]>()
  const poolLimit = Math.min(Math.max(SECTION_SLOT_COUNT * 2, maxPerSource * 4), 20)
  const minPublishedAt = new Date(now - BRIEFING_MAX_AGE_MS).toISOString()

  for (const source of sources) {
    const rows = getDb()
      .prepare(
        `SELECT i.id, i.source_id, s.title AS source_title, i.external_id, i.title, i.url,
                i.summary, i.image_url, i.published_at, i.read_at, i.created_at
         FROM news_items i
         INNER JOIN news_sources s ON s.id = i.source_id
         WHERE i.source_id = ? AND i.published_at >= ?
         ORDER BY (i.read_at IS NULL) DESC, i.published_at DESC
         LIMIT ?`
      )
      .all(source.id, minPublishedAt, poolLimit) as ItemRow[]

    if (rows.length > 0) {
      pools.set(source.id, rows.map((row) => mapNewsItemRow(row)))
    }
  }

  if (pools.size === 0) {
    return emptyBriefing(sources, lastFetchedAt, stale, now)
  }

  const topSources = sources.filter((source) => isTopSource(source))
  const localSources = sources.filter((source) => isLocalSource(source))

  const showFeatured = layout === 'full'
  const { item: featuredItem, reason: featuredReason } = showFeatured
    ? pickFeaturedItem(sources, pools, now)
    : { item: null, reason: null }
  const seenIds = new Set<string>()
  const seenTitles = new Set<string>()
  if (featuredItem) {
    seenIds.add(featuredItem.id)
    const titleKey = normalizeNewsStoryTitle(featuredItem.title)
    if (titleKey) seenTitles.add(titleKey)
  }


  const topHasFeeds = topSources.length > 0
  const localHasFeeds = localSources.length > 0

  const { topCap, localCap } = allocateSectionCaps(layout, topHasFeeds, localHasFeeds)

  const topItems = pickSectionItems(
    topSources,
    pools,
    topCap,
    maxPerSource,
    mode,
    seenIds,
    seenTitles,
    now
  )
  const localItems = pickSectionItems(
    localSources,
    pools,
    localCap,
    maxPerSource,
    mode,
    seenIds,
    seenTitles,
    now
  )

  const sections = buildSections(topItems, localItems, now, layout)
  const items = [...topItems, ...localItems].map((item) => storyFromItem(item, now))

  return {
    featured: featuredItem ? storyFromItem(featuredItem, now) : null,
    featuredReason,
    items,
    sections,
    hasLocalFeeds: localHasFeeds,
    ...briefingMeta(sources, lastFetchedAt, stale, now)
  }
}

export function getNewsDoorSnapshot(): NewsDoorSnapshot {
  const unread = getDb()
    .prepare('SELECT COUNT(*) AS count FROM news_items WHERE read_at IS NULL')
    .get() as { count: number }

  const latest = getDb()
    .prepare(
      `SELECT i.title, s.title AS source_title
       FROM news_items i
       INNER JOIN news_sources s ON s.id = i.source_id
       ORDER BY i.published_at DESC
       LIMIT 1`
    )
    .get() as { title: string; source_title: string } | undefined

  const hasStaleSource = listNewsSources().some((source) => source.enabled && source.lastError)

  return {
    unreadCount: unread.count,
    latestTitle: latest?.title ?? null,
    latestSource: latest?.source_title ?? null,
    hasStaleSource
  }
}
