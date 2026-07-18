import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { NewsItemRecord, NewsSourceRecord } from '@shared/news'
import { formatNewsAgeLabel } from '@shared/news'
import { newsCategoryLabel } from '@shared/newsBundles'
import { resolveSourceLogoUrl } from '@shared/newsBranding'
import { NewsSourceLogo } from './NewsSourceLogo'
import { useNewsBridge } from '../hooks/useNewsBridge'

interface NewsReaderPanelProps {
  busy?: boolean
  onBusyChange?: (busy: boolean) => void
}

/** Active reader filter: everything, unread-only, a category, or a single source. */
type ReaderFilter = 'all' | 'unread' | { category: string } | { sourceId: string }

function filterKey(filter: ReaderFilter): string {
  if (filter === 'all' || filter === 'unread') return filter
  return 'category' in filter ? `category:${filter.category}` : `source:${filter.sourceId}`
}

export function NewsReaderPanel({
  busy: externalBusy,
  onBusyChange
}: NewsReaderPanelProps): React.JSX.Element {
  const [items, setItems] = useState<NewsItemRecord[]>([])
  const [sources, setSources] = useState<NewsSourceRecord[]>([])
  const [filter, setFilter] = useState<ReaderFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [internalBusy, setInternalBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const busy = externalBusy ?? internalBusy
  const { ready: bridgeReady, error: bridgeError } = useNewsBridge()

  const setBusy = useCallback(
    (value: boolean) => {
      setInternalBusy(value)
      onBusyChange?.(value)
    },
    [onBusyChange]
  )

  const load = useCallback(async () => {
    if (!window.moss?.news) {
      return
    }

    try {
      const [nextItems, nextSources] = await Promise.all([
        window.moss.news.listItems(120),
        window.moss.news.listSources()
      ])
      setItems(nextItems)
      setSources(nextSources)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signal feed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(timer)
  }, [flash])

  async function syncFeeds(): Promise<void> {
    if (!window.moss?.news) return
    setBusy(true)
    try {
      const result = await window.moss.news.syncAll()
      const imported = result.results.reduce((sum, row) => sum + row.imported, 0)
      const updated = result.results.reduce((sum, row) => sum + row.updated, 0)
      const errors = result.results.filter((row) => row.error)
      if (errors.length > 0) {
        setError(errors.map((row) => `${row.label}: ${row.error}`).join(' · '))
      } else {
        setError(null)
      }
      if (imported + updated > 0) {
        setFlash(`Updated · ${imported} new · ${updated} changed`)
      } else if (errors.length === 0) {
        setFlash('Updated — headlines are current')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }

  async function openItem(item: NewsItemRecord): Promise<void> {
    if (!window.moss?.shell || !window.moss?.news) return
    try {
      await window.moss.shell.openExternal(item.url)
      if (!item.readAt) {
        await window.moss.news.markRead(item.id)
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open link')
    }
  }

  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items])

  // Per-source rollups for the filter chips: only sources that actually have
  // synced items, plus their unread count and current sync health.
  const sourceChips = useMemo(() => {
    const counts = new Map<string, { total: number; unread: number }>()
    for (const item of items) {
      const entry = counts.get(item.sourceId) ?? { total: 0, unread: 0 }
      entry.total += 1
      if (!item.readAt) entry.unread += 1
      counts.set(item.sourceId, entry)
    }
    return sources
      .filter((source) => counts.has(source.id))
      .map((source) => ({
        source,
        unread: counts.get(source.id)?.unread ?? 0,
        hasError: Boolean(source.lastError)
      }))
      .sort((a, b) => b.unread - a.unread || a.source.title.localeCompare(b.source.title))
  }, [items, sources])

  // Category rollups (National/Local/Tech/…) from tagged sources that have items.
  const categoryById = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of sources) {
      if (source.category) map.set(source.id, source.category)
    }
    return map
  }, [sources])

  const categoryChips = useMemo(() => {
    const counts = new Map<string, { total: number; unread: number }>()
    for (const item of items) {
      const category = categoryById.get(item.sourceId)
      if (!category) continue
      const entry = counts.get(category) ?? { total: 0, unread: 0 }
      entry.total += 1
      if (!item.readAt) entry.unread += 1
      counts.set(category, entry)
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, unread: count.unread, total: count.total }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category))
  }, [items, categoryById])

  // "Updated N ago" — freshest successful fetch across enabled sources.
  const updatedLabel = useMemo(() => {
    const stamps = sources
      .map((source) => source.lastFetchedAt)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
    if (stamps.length === 0) return null
    return formatNewsAgeLabel(new Date(Math.max(...stamps)).toISOString())
  }, [sources])

  const staleSources = useMemo(
    () => sources.filter((source) => source.enabled && source.lastError),
    [sources]
  )

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'unread') return items.filter((item) => !item.readAt)
    if ('category' in filter) {
      return items.filter((item) => categoryById.get(item.sourceId) === filter.category)
    }
    return items.filter((item) => item.sourceId === filter.sourceId)
  }, [items, filter, categoryById])

  const activeKey = filterKey(filter)
  const activeCategory =
    typeof filter === 'object' && 'category' in filter ? filter.category : null

  const visibleSourceChips = useMemo(() => {
    if (!activeCategory) return []
    return sourceChips.filter(({ source }) => categoryById.get(source.id) === activeCategory)
  }, [activeCategory, sourceChips, categoryById])

  const activeSourceError =
    typeof filter === 'object' && 'sourceId' in filter
      ? (sources.find((source) => source.id === filter.sourceId)?.lastError ?? null)
      : null

  function emptyCopy(): { title: string; copy: string } {
    if (items.length === 0) {
      return {
        title: 'No headlines yet',
        copy: 'Add sources in Setup or Settings → News, then refresh.'
      }
    }
    if (filter === 'unread') {
      return { title: 'All caught up', copy: 'No unread headlines — nicely done.' }
    }
    if (typeof filter === 'object' && 'category' in filter) {
      return {
        title: `Nothing in ${newsCategoryLabel(filter.category)}`,
        copy: 'Try refreshing, or pick another filter above.'
      }
    }
    if (typeof filter === 'object') {
      const name = sources.find((s) => s.id === filter.sourceId)?.title ?? 'this source'
      return { title: `Nothing from ${name}`, copy: 'Try refreshing, or pick another source above.' }
    }
    return { title: 'No headlines yet', copy: 'Refresh to fetch the latest.' }
  }

  return (
    <section className="news-reader-panel">
      <header className="news-reader-head">
        <div>
          <p className="news-reader-kicker nutrition-mono">News reader</p>
          <p className="news-reader-title">All your headlines</p>
          <p className="news-reader-meta nutrition-mono">
            {unreadCount} unread
            {updatedLabel ? ` · updated ${updatedLabel}` : ''} · opens in browser
          </p>
        </div>
        <div className="news-reader-actions">
          <Link to="/settings" className="news-reader-link nutrition-mono">
            News settings
          </Link>
          <button
            type="button"
            className="calendar-settings-button calendar-settings-button--primary"
            disabled={busy || !bridgeReady}
            onClick={() => void syncFeeds()}
          >
            Refresh
          </button>
        </div>
      </header>

      {items.length > 0 && (
        <div className="news-reader-filters" role="tablist" aria-label="Filter headlines">
          <button
            type="button"
            role="tab"
            aria-selected={activeKey === 'all'}
            className={`news-reader-chip${activeKey === 'all' ? ' news-reader-chip--active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All <span className="news-reader-chip-count">{items.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeKey === 'unread'}
            className={`news-reader-chip${activeKey === 'unread' ? ' news-reader-chip--active' : ''}`}
            onClick={() => setFilter('unread')}
          >
            Unread <span className="news-reader-chip-count">{unreadCount}</span>
          </button>
          {categoryChips.map(({ category, unread }) => {
            const key = `category:${category}`
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeKey === key}
                className={`news-reader-chip${activeKey === key ? ' news-reader-chip--active' : ''}`}
                onClick={() => setFilter(activeKey === key ? 'all' : { category })}
              >
                {newsCategoryLabel(category)}
                {unread > 0 && <span className="news-reader-chip-count">{unread}</span>}
              </button>
            )
          })}
          {visibleSourceChips.length > 0 && (
            <span className="news-reader-filter-divider nutrition-mono" aria-hidden>
              Sources
            </span>
          )}
          {visibleSourceChips.map(({ source, unread, hasError }) => {
            const key = `source:${source.id}`
            return (
              <button
                key={source.id}
                type="button"
                role="tab"
                aria-selected={activeKey === key}
                className={`news-reader-chip news-reader-chip--source${activeKey === key ? ' news-reader-chip--active' : ''}`}
                onClick={() => setFilter(activeKey === key ? { category: activeCategory! } : { sourceId: source.id })}
                title={hasError ? `Last refresh failed: ${source.lastError}` : source.title}
              >
                {hasError && (
                  <span className="news-reader-chip-alert" aria-label="Refresh error" />
                )}
                <NewsSourceLogo
                  logoUrl={resolveSourceLogoUrl(source.title, source.url)}
                  label={source.title}
                  size="sm"
                />
                {source.title}
                {unread > 0 && <span className="news-reader-chip-count">{unread}</span>}
              </button>
            )
          })}
        </div>
      )}

      {flash && <p className="calendar-flash">{flash}</p>}
      {bridgeError && (
        <p className="calendar-error" role="alert">
          {bridgeError}
        </p>
      )}
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
      {!error && staleSources.length > 0 && (
        <p className="news-reader-health" role="status">
          {staleSources.length} source{staleSources.length > 1 ? 's' : ''} need attention — showing
          last-good headlines. Refresh to try again.
        </p>
      )}
      {activeSourceError && (
        <p className="news-reader-health" role="status">
          Last refresh failed: {activeSourceError}
        </p>
      )}

      {filteredItems.length === 0 ? (
        <div className="news-reader-empty">
          <p className="news-reader-empty-title">{emptyCopy().title}</p>
          <p className="news-reader-empty-copy">{emptyCopy().copy}</p>
        </div>
      ) : (
        <ul className="news-reader-list">
          {filteredItems.map((item) => (
            <li key={item.id} className="news-reader-row">
              <button
                type="button"
                className="news-reader-row-button"
                disabled={busy}
                onClick={() => void openItem(item)}
              >
                <div className="news-reader-row-main">
                  <span className="news-reader-row-title">{item.title}</span>
                  {item.summary && (
                    <span className="news-reader-row-summary">{item.summary}</span>
                  )}
                </div>
                <div className="news-reader-row-meta nutrition-mono">
                  <span className="news-reader-row-source">
                    <NewsSourceLogo
                      logoUrl={item.sourceLogoUrl ?? resolveSourceLogoUrl(item.sourceTitle, item.url)}
                      label={item.sourceTitle}
                      size="sm"
                    />
                    <span>{item.sourceTitle}</span>
                  </span>
                  <span className="news-reader-meta-sep" aria-hidden>·</span>
                  <time>{formatNewsAgeLabel(item.publishedAt)}</time>
                  {!item.readAt && <span className="news-reader-unread-dot" aria-label="Unread" />}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
