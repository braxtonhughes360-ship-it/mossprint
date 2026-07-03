/** Dashboard news widget — Apple News–style briefing (News V2). */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { NewsBriefing, NewsBriefingMode, NewsBriefingSection, NewsBriefingStory, NewsWidgetLayout } from '@shared/news'
import { settingsSectionPath } from './SettingsNav'

export interface DashboardNewsConfig {
  enabled: boolean
  maxItems: number
  widgetLayout: NewsWidgetLayout
  briefingMode: NewsBriefingMode
  maxPerSource: number
}

export interface DashboardNewsCardProps {
  config: DashboardNewsConfig
}

function openArticle(url: string): void {
  void window.moss.shell.openExternal(url)
}

function StoryThumb({
  imageUrl,
  title
}: {
  imageUrl: string
  title: string
}): React.JSX.Element | null {
  const [failed, setFailed] = useState(false)

  if (!imageUrl) {
    return null
  }

  return (
    <span className="dashboard-news-thumb-wrap" aria-hidden>
      {!failed ? (
        <img
          className="dashboard-news-thumb"
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="dashboard-news-thumb-fallback">{title.charAt(0)}</span>
      )}
    </span>
  )
}

function StoryRow({
  item,
  onOpen
}: {
  item: NewsBriefingStory
  onOpen: (url: string, itemId?: string) => void
}): React.JSX.Element {
  return (
    <li className={['dashboard-news-row-item', item.read ? 'dashboard-news-row-item--read' : null].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="dashboard-news-row-button"
        onClick={() => onOpen(item.url, item.id)}
      >
        <span className="dashboard-news-row-copy">
          <span className="dashboard-news-row-source nutrition-mono">{item.source}</span>
          <span className="dashboard-news-row-headline">{item.title}</span>
          <span className="dashboard-news-row-meta nutrition-mono">
            <time dateTime={item.publishedAt}>{item.ageLabel}</time>
          </span>
        </span>
        <StoryThumb imageUrl={item.imageUrl} title={item.title} />
      </button>
    </li>
  )
}

function FeaturedHero({
  item,
  reason,
  onOpen
}: {
  item: NewsBriefingStory
  reason?: string | null
  onOpen: (url: string, itemId?: string) => void
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false)
  const hasImage = Boolean(item.imageUrl) && !imageFailed

  return (
    <button
      type="button"
      className={[
        'dashboard-news-hero',
        hasImage ? 'dashboard-news-hero--photo' : 'dashboard-news-hero--material'
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onOpen(item.url, item.id)}
    >
      {hasImage ? (
        <img
          className="dashboard-news-hero-image"
          src={item.imageUrl}
          alt=""
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <span className="dashboard-news-hero-scrim" aria-hidden />
      <span className="dashboard-news-hero-copy">
        <span className="dashboard-news-hero-source nutrition-mono">{item.source}</span>
        <span className="dashboard-news-hero-headline">{item.title}</span>
        {!hasImage && item.summary ? (
          <span className="dashboard-news-hero-dek">{item.summary}</span>
        ) : null}
        <span className="dashboard-news-hero-meta nutrition-mono">
          <time dateTime={item.publishedAt}>{item.ageLabel}</time>
          {reason ? <span className="dashboard-news-hero-reason"> · {reason}</span> : null}
        </span>
      </span>
    </button>
  )
}

/** Throttle the entry refresh so rapid nav doesn't hammer the feeds. */
const ENTRY_SYNC_THROTTLE_MS = 30_000
let lastEntrySyncAt = 0

export function DashboardNewsCard({ config }: DashboardNewsCardProps): React.JSX.Element | null {
  const [briefing, setBriefing] = useState<NewsBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!window.moss?.news) {
      setLoading(false)
      return
    }
    try {
      const next = await window.moss.news.getBriefing({
        maxItems: config.maxItems,
        layout: config.widgetLayout,
        mode: config.briefingMode,
        maxPerSource: config.maxPerSource
      })
      setBriefing(next)
    } catch {
      setBriefing(null)
    } finally {
      setLoading(false)
    }
  }, [config.maxItems, config.widgetLayout, config.briefingMode, config.maxPerSource])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      // Show the current briefing immediately…
      await load()
      // …then pull fresh headlines on dashboard entry (background, throttled).
      if (!window.moss?.news) return
      if (Date.now() - lastEntrySyncAt < ENTRY_SYNC_THROTTLE_MS) return
      lastEntrySyncAt = Date.now()
      try {
        await window.moss.news.syncAll()
      } catch {
        // best-effort — keep showing the last-good briefing on failure
      }
      if (!cancelled) await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const errorSources = useMemo(
    () => briefing?.sourceHealth.filter((source) => source.hasError) ?? [],
    [briefing?.sourceHealth]
  )

  const handleOpen = useCallback(
    (url: string, itemId?: string) => {
      openArticle(url)
      if (itemId && window.moss?.news) {
        void window.moss.news.markRead(itemId)
        void load()
      }
    },
    [load]
  )

  const retryFailedSources = useCallback(async (): Promise<void> => {
    if (!window.moss?.news) return
    setRetrying(true)
    setRetryNote(null)
    try {
      const result = await window.moss.news.syncAll()
      const failed = result.staleCount
      if (failed === 0) {
        setRetryNote('All sources synced')
      } else {
        const ok = result.results.length - failed
        setRetryNote(`${ok} synced · ${failed} still need attention`)
      }
      await load()
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setRetrying(false)
    }
  }, [load])

  if (!config.enabled) {
    return null
  }

  const featured = briefing?.featured
  const sections = briefing?.sections ?? []
  const hasHeadlines = Boolean(featured) || sections.some((section) => section.items.length > 0)
  const layout = config.widgetLayout
  const columnSections = layout === 'split' || layout === 'compact'

  const renderSection = (section: NewsBriefingSection): React.JSX.Element => (
    <section
      key={section.id}
      className={`dashboard-news-section dashboard-news-section--${section.id}`}
      aria-label={`${section.label} headlines`}
    >
      <h3 className="dashboard-news-section-label nutrition-mono">{section.label}</h3>
      {section.items.length > 0 ? (
        <ul className="dashboard-news-row-list">
          {section.items.map((item) => (
            <StoryRow key={item.id} item={item} onOpen={handleOpen} />
          ))}
        </ul>
      ) : (
        <p className="dashboard-news-section-empty" role="status">
          {section.id === 'local' ? (
            briefing?.hasLocalFeeds ? (
              'No local headlines this week.'
            ) : (
              <>
                Add local feeds in{' '}
                <Link to={settingsSectionPath('news')} className="news-inline-link">
                  Settings
                </Link>
                .
              </>
            )
          ) : (
            'No headlines right now.'
          )}
        </p>
      )}
    </section>
  )

  const topSection = sections.find((section) => section.id === 'top')
  const localSection = sections.find((section) => section.id === 'local')

  return (
    <article
      className={[
        'dashboard-news-card',
        'dashboard-news-card--wide',
        `dashboard-news-card--layout-${layout}`
      ].join(' ')}
      aria-label="News briefing"
    >
      <span className="dashboard-news-card-ambient" aria-hidden />

      <header className="dashboard-news-card-header">
        <div className="dashboard-news-card-head">
          <div className="dashboard-news-card-title-row">
            <h2 className="dashboard-news-card-title">News</h2>
            {briefing && (
              <p className="dashboard-news-sync nutrition-mono" role="status">
                {briefing.updatedLabel ? (
                  <span>Updated {briefing.updatedLabel}</span>
                ) : (
                  <span>Not synced yet</span>
                )}
                {errorSources.length > 0 && (
                  <span className="dashboard-news-sync-errors">
                    {errorSources.map((source) => (
                      <span
                        key={source.id}
                        className="dashboard-news-source-dot"
                        title={source.lastError ?? `${source.title} — sync failed`}
                        aria-label={`${source.title} sync error`}
                      />
                    ))}
                  </span>
                )}
              </p>
            )}
          </div>
          <Link
            to={settingsSectionPath('news')}
            className="dashboard-news-card-more dashboard-news-card-more--cta nutrition-mono"
          >
            Manage sources
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="dashboard-news-loading" aria-busy="true" aria-label="Loading headlines">
          <span className="dashboard-news-loading-line" />
          <span className="dashboard-news-loading-line dashboard-news-loading-line--short" />
        </div>
      ) : !hasHeadlines ? (
        <div className="dashboard-news-empty">
          <p className="dashboard-news-empty-title">No headlines yet</p>
          <p className="dashboard-news-empty-copy">
            Add outlets in{' '}
            <Link to={settingsSectionPath('news')} className="news-inline-link">
              Settings → News
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="dashboard-news-body dashboard-news-body--band">
            {layout === 'full' && featured && (
              <div className="dashboard-news-lead">
                <FeaturedHero
                  item={featured}
                  reason={briefing?.featuredReason}
                  onOpen={handleOpen}
                />
              </div>
            )}

            {sections.length > 0 && (
              <div className="dashboard-news-feed">
                {columnSections ? (
                  <>
                    {topSection ? renderSection(topSection) : null}
                    {localSection ? renderSection(localSection) : null}
                  </>
                ) : (
                  sections.map((section) => renderSection(section))
                )}
              </div>
            )}
          </div>
        </>
      )}

      {briefing?.stale && hasHeadlines && !loading && (
        <div className="dashboard-news-stale-wrap">
          <p className="dashboard-news-stale" role="status">
            Showing last-good headlines
            {errorSources.length > 0
              ? ` · ${errorSources.length} source${errorSources.length === 1 ? '' : 's'} need attention`
              : ''}
          </p>
          {errorSources.length > 0 && (
            <div className="dashboard-news-stale-actions">
              <button
                type="button"
                className="dashboard-news-stale-btn nutrition-mono"
                disabled={retrying}
                onClick={() => void retryFailedSources()}
              >
                {retrying ? 'Syncing…' : 'Sync all sources'}
              </button>
              <Link to={settingsSectionPath('news')} className="dashboard-news-stale-link nutrition-mono">
                Manage in Settings
              </Link>
            </div>
          )}
          {retryNote && (
            <p className="dashboard-news-retry-note" role="status">
              {retryNote}
            </p>
          )}
        </div>
      )}
    </article>
  )
}
