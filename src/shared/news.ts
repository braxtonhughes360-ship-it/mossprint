/** News / signal module — shared types (Step 5). */

export type NewsBriefingMode = 'balanced' | 'latest' | 'priority'

/** Dashboard widget density — compact, split columns, or full grids. */
export type NewsWidgetLayout = 'compact' | 'split' | 'full'

export interface NewsBriefingOptions {
  maxItems?: number
  mode?: NewsBriefingMode
  maxPerSource?: number
  layout?: NewsWidgetLayout
}

export interface NewsSourceRecord {
  id: string
  url: string
  title: string
  category: string
  trust: number
  priority: number
  enabled: boolean
  lastFetchedAt: string | null
  lastError: string | null
  createdAt: string
}

export interface NewsItemRecord {
  id: string
  sourceId: string
  sourceTitle: string
  externalId: string
  title: string
  url: string
  summary: string
  /** Hero/thumbnail URL from RSS media tags when available. */
  imageUrl: string
  /** Publisher favicon for source row branding. */
  sourceLogoUrl?: string
  publishedAt: string
  readAt: string | null
  createdAt: string
}

export interface NewsBriefingStory {
  id: string
  title: string
  source: string
  /** Publisher favicon for source row branding. */
  sourceLogoUrl?: string
  url: string
  publishedAt: string
  ageLabel: string
  /** RSS description trimmed for the dashboard widget. */
  summary: string
  imageUrl: string
  /** Dimmed in the widget after the reader opens the story. */
  read?: boolean
}

export type NewsBriefingSectionId = 'top' | 'world' | 'local'

export interface NewsBriefingSection {
  id: NewsBriefingSectionId
  label: string
  items: NewsBriefingStory[]
}

export interface NewsBriefingSourceHealth {
  id: string
  title: string
  hasError: boolean
  /** Last sync error message — for retry UI in widget and settings. */
  lastError?: string
}

export interface NewsBriefing {
  featured: NewsBriefingStory | null
  /** Short line under the hero — how the lead was chosen. */
  featuredReason: string | null
  /** Flat secondary list — sections are the primary widget layout. */
  items: NewsBriefingStory[]
  sections: NewsBriefingSection[]
  /** Enabled feeds tagged (or inferred) as local — drives empty Local column copy. */
  hasLocalFeeds: boolean
  stale: boolean
  lastFetchedAt: string | null
  /** Human sync stamp for the widget header ("Updated 12 min ago"). */
  updatedLabel: string | null
  sourceHealth: NewsBriefingSourceHealth[]
}

export interface NewsDoorSnapshot {
  unreadCount: number
  latestTitle: string | null
  latestSource: string | null
  hasStaleSource: boolean
}

export interface NewsSyncResult {
  sourceId: string
  label: string
  imported: number
  updated: number
  error?: string
}

export interface NewsSyncAllResult {
  results: NewsSyncResult[]
  staleCount: number
}

export interface AddNewsSourceInput {
  url: string
  title?: string
  /** Semantic tag (national/local/tech/…) for reader category filters. */
  category?: string
}

export function formatNewsAgeLabel(publishedAtIso: string, now = Date.now()): string {
  const published = new Date(publishedAtIso).getTime()
  if (!Number.isFinite(published)) return 'recent'

  const diffMs = Math.max(0, now - published)
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} d ago`

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(published))
}

/** Trim feed description for dashboard glance copy. */
export function briefNewsSummary(summary: string, maxLength = 140): string {
  const trimmed = summary.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength).trimEnd()}…`
}

/** Normalize a headline for cross-feed dedup (widget + reader parity). */
export function normalizeNewsStoryTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Drop duplicate stories by normalized title — keeps the first (freshest) row. */
export function dedupeNewsItemsByTitle<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const item of items) {
    const key = normalizeNewsStoryTitle(item.title)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    deduped.push(item)
  }
  return deduped
}
