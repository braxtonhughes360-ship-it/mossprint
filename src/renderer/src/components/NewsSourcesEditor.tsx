import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState
} from 'react'
import type { NewsSourceRecord } from '@shared/news'
import {
  NEWS_INTERESTS,
  NEWS_SOURCE_CATALOG,
  defaultFeedKeyForOutlet,
  feedsForOutlet,
  outletsForInterests,
  resolveCatalogFeed,
  resolveLocalNewsFeeds,
  localMetroLabel,
  searchNewsOutlets,
  visibleTopicsForOutlet,
  type NewsBundleFeed,
  type NewsInterestId
} from '@shared/newsBundles'
import { faviconLogoUrl, resolveSourceLogoUrl } from '@shared/newsBranding'
import { MossButton } from './MossButton'
import { NewsSourceLogo } from './NewsSourceLogo'
import { useNewsBridge } from '../hooks/useNewsBridge'

export interface NewsFeedInput {
  url: string
  title: string
  category?: string
}

export interface NewsSourcesEditorHandle {
  collectFeeds: () => NewsFeedInput[]
  validate: () => string | null
}

interface NewsSourcesEditorProps {
  variant: 'setup' | 'settings'
  idPrefix: string
  disabled?: boolean
}

function catalogKeyForUrl(url: string): string | null {
  for (const outlet of NEWS_SOURCE_CATALOG) {
    for (const topic of outlet.topics) {
      if (topic.url === url) return `${outlet.id}:${topic.id}`
    }
  }
  return null
}

export const NewsSourcesEditor = forwardRef<NewsSourcesEditorHandle, NewsSourcesEditorProps>(
  function NewsSourcesEditor({ variant, idPrefix, disabled = false }, ref) {
    const { ready: bridgeReady, error: bridgeError } = useNewsBridge()
    const inactive = disabled || !bridgeReady

    const [selectedInterests, setSelectedInterests] = useState<Set<NewsInterestId>>(
      () => new Set<NewsInterestId>(['top'])
    )
    const [selectedOutlets, setSelectedOutlets] = useState<Set<string>>(
      () => new Set(variant === 'setup' ? ['nyt', 'bbc'] : [])
    )
    const [selectedFeeds, setSelectedFeeds] = useState<Set<string>>(
      () => new Set(variant === 'setup' ? ['nyt:top', 'bbc:top'] : [])
    )
    const [localCity, setLocalCity] = useState('')
    const [resolvedLocalFeeds, setResolvedLocalFeeds] = useState<NewsBundleFeed[]>([])
    const [resolvedLocalLabel, setResolvedLocalLabel] = useState<string | null>(null)
    const [selectedLocalFeeds, setSelectedLocalFeeds] = useState<Set<string>>(() => new Set())
    const [localLookupError, setLocalLookupError] = useState<string | null>(null)
    const [outletSearch, setOutletSearch] = useState('')
    const [customWebsiteUrl, setCustomWebsiteUrl] = useState('')
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [sources, setSources] = useState<NewsSourceRecord[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const subscribedUrls = useMemo(() => new Set(sources.map((s) => s.url)), [sources])
    const suggestedOutlets = useMemo(() => outletsForInterests(selectedInterests), [selectedInterests])
    const searchMatches = useMemo(() => searchNewsOutlets(outletSearch), [outletSearch])
    const visibleOutlets = useMemo(() => {
      const query = outletSearch.trim()
      if (query) return searchNewsOutlets(query)
      if (suggestedOutlets.length > 0) return suggestedOutlets
      return outletsForInterests(new Set<NewsInterestId>(['top']))
    }, [suggestedOutlets, outletSearch])

    const loadSources = useCallback(async (): Promise<void> => {
      if (!window.moss?.news) return
      try {
        setSources(await window.moss.news.listSources())
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feeds')
      }
    }, [])

    useEffect(() => {
      if (variant !== 'settings') return
      void loadSources()
    }, [loadSources, variant])

    useEffect(() => {
      if (variant !== 'settings' || sources.length === 0) return

      const outlets = new Set<string>()
      const feeds = new Set<string>()
      const localUrls = new Set<string>()

      for (const source of sources) {
        const key = catalogKeyForUrl(source.url)
        if (key) {
          feeds.add(key)
          outlets.add(key.split(':')[0]!)
        } else if (source.category === 'local') {
          localUrls.add(source.url)
        }
      }

      setSelectedOutlets(outlets)
      setSelectedFeeds(feeds)
      if (localUrls.size > 0) {
        setSelectedInterests((prev) => new Set<NewsInterestId>([...Array.from(prev), 'local']))
        setSelectedLocalFeeds(localUrls)
      }
    }, [sources, variant])

    useEffect(() => {
      setResolvedLocalFeeds([])
      setResolvedLocalLabel(null)
      setSelectedLocalFeeds(new Set())
      setLocalLookupError(null)
    }, [localCity])

    const collectFeeds = useCallback((): NewsFeedInput[] => {
      const feeds: NewsFeedInput[] = []
      for (const key of Array.from(selectedFeeds)) {
        const feed = resolveCatalogFeed(key)
        if (feed) feeds.push({ url: feed.url, title: feed.title })
      }
      if (selectedInterests.has('local')) {
        for (const feed of resolvedLocalFeeds) {
          if (selectedLocalFeeds.has(feed.url)) {
            feeds.push({ ...feed, category: 'local' })
          }
        }
      }
      if (customWebsiteUrl.trim()) {
        feeds.push({
          url: customWebsiteUrl.trim(),
          title: 'Custom feed',
          category: 'custom'
        })
      }
      return feeds
    }, [customWebsiteUrl, resolvedLocalFeeds, selectedFeeds, selectedInterests, selectedLocalFeeds])

    const validate = useCallback((): string | null => {
      if (selectedInterests.has('local')) {
        if (resolvedLocalFeeds.length === 0) {
          return 'Look up your ZIP or city below, or turn off Local.'
        }
        if (selectedLocalFeeds.size === 0) {
          return 'Pick at least one local source, or turn off Local.'
        }
      }
      return null
    }, [resolvedLocalFeeds.length, selectedInterests, selectedLocalFeeds.size])

    useImperativeHandle(ref, () => ({ collectFeeds, validate }), [collectFeeds, validate])

    async function persistFeed(feed: NewsFeedInput): Promise<void> {
      if (!window.moss?.news) return
      await window.moss.news.addSource({
        url: feed.url,
        title: feed.title,
        category: feed.category
      })
    }

    async function removeByUrl(url: string): Promise<void> {
      if (!window.moss?.news) return
      const match = sources.find((s) => s.url === url)
      if (match) {
        await window.moss.news.deleteSource(match.id)
      }
    }

    async function runSettingsMutation(task: () => Promise<void>): Promise<void> {
      setBusy(true)
      setError(null)
      try {
        await task()
        await loadSources()
        void window.moss?.news?.syncAll().catch(() => undefined)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setBusy(false)
      }
    }

    function handleLocalLookup(): void {
      const query = localCity.trim()
      if (!query) {
        setLocalLookupError('Enter a ZIP or city first.')
        setResolvedLocalFeeds([])
        setResolvedLocalLabel(null)
        return
      }
      const feeds = resolveLocalNewsFeeds(query)
      if (feeds.length === 0) {
        setLocalLookupError(`No local feed for "${query}" — try a major city or 5-digit ZIP.`)
        setResolvedLocalFeeds([])
        setResolvedLocalLabel(null)
        return
      }
      setResolvedLocalFeeds(feeds)
      setResolvedLocalLabel(localMetroLabel(query))
      setLocalLookupError(null)
      setSelectedLocalFeeds(new Set())
    }

    function toggleInterest(id: NewsInterestId): void {
      setSelectedInterests((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    function toggleLocalFeed(url: string): void {
      setSelectedLocalFeeds((prev) => {
        const next = new Set(prev)
        const adding = !next.has(url)
        if (adding) next.add(url)
        else next.delete(url)

        if (variant === 'settings') {
          const feed = resolvedLocalFeeds.find((f) => f.url === url)
          if (feed) {
            void runSettingsMutation(async () => {
              if (adding) {
                await persistFeed({ ...feed, category: 'local' })
              } else {
                await removeByUrl(url)
              }
            })
          }
        }
        return next
      })
    }

    function toggleOutlet(outletId: string): void {
      const outlet = NEWS_SOURCE_CATALOG.find((o) => o.id === outletId)
      if (!outlet) return

      setSelectedOutlets((prev) => {
        const next = new Set(prev)
        const turningOn = !next.has(outletId)

        if (turningOn) {
          next.add(outletId)
          const defaultKey = defaultFeedKeyForOutlet(outlet, selectedInterests)
          setSelectedFeeds((feeds) => new Set([...Array.from(feeds), defaultKey]))
          if (variant === 'settings') {
            const feed = resolveCatalogFeed(defaultKey)
            if (feed && !subscribedUrls.has(feed.url)) {
              void runSettingsMutation(() =>
                persistFeed({ url: feed.url, title: feed.title, category: 'national' })
              )
            }
          }
        } else {
          next.delete(outletId)
          const keys = feedsForOutlet(selectedFeeds, outletId)
          setSelectedFeeds((feeds) => {
            const updated = new Set(feeds)
            for (const key of keys) updated.delete(key)
            return updated
          })
          if (variant === 'settings') {
            void runSettingsMutation(async () => {
              for (const key of keys) {
                const feed = resolveCatalogFeed(key)
                if (feed) await removeByUrl(feed.url)
              }
            })
          }
        }
        return next
      })
    }

    function toggleFeed(key: string): void {
      setSelectedFeeds((prev) => {
        const next = new Set(prev)
        const adding = !next.has(key)
        if (adding) next.add(key)
        else next.delete(key)

        if (variant === 'settings') {
          const feed = resolveCatalogFeed(key)
          if (feed) {
            void runSettingsMutation(async () => {
              if (adding) {
                await persistFeed({ url: feed.url, title: feed.title, category: 'national' })
              } else {
                await removeByUrl(feed.url)
              }
            })
          }
        }
        return next
      })
    }

    async function handleAdvancedAdd(event: React.FormEvent): Promise<void> {
      event.preventDefault()
      if (!customWebsiteUrl.trim()) return
      const feed: NewsFeedInput = {
        url: customWebsiteUrl.trim(),
        title: 'Custom feed',
        category: 'custom'
      }
      if (variant === 'settings') {
        await runSettingsMutation(() => persistFeed(feed))
        setCustomWebsiteUrl('')
        setShowAdvanced(false)
      }
    }

    async function retrySource(sourceId: string): Promise<void> {
      if (!window.moss?.news) return
      await runSettingsMutation(async () => {
        const result = await window.moss.news.syncSource(sourceId)
        if (result.error) {
          throw new Error(result.error)
        }
      })
    }

    async function removeSource(sourceId: string): Promise<void> {
      if (!window.moss?.news) return
      await runSettingsMutation(async () => {
        await window.moss.news.deleteSource(sourceId)
      })
    }

    const editorBusy = inactive || busy

    return (
      <div className="moss-news-editor">
        {(bridgeError || error) && (
          <p className="moss-setup-local-error" role="alert">
            {bridgeError ?? error}
          </p>
        )}

        <div className="moss-setup-news-panel">
          <div className="moss-setup-news-block">
            <p className="moss-setup-news-label">What do you care about?</p>
            <div className="moss-setup-topic-row" role="group" aria-label="News topics">
              {NEWS_INTERESTS.map((interest) => {
                const on = selectedInterests.has(interest.id)
                return (
                  <button
                    key={interest.id}
                    type="button"
                    aria-pressed={on}
                    title={interest.copy}
                    disabled={editorBusy}
                    className={[
                      'moss-setup-topic-chip',
                      on ? 'moss-setup-topic-chip--on' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => toggleInterest(interest.id)}
                  >
                    {interest.label}
                  </button>
                )
              })}
            </div>
          </div>

          {selectedInterests.has('local') && (
            <div className="moss-setup-news-block moss-setup-local-block">
              <p className="moss-setup-news-label">Local headlines</p>
              <p className="moss-setup-fineprint">
                Your ZIP or city — pick the outlets you want.
              </p>
              <label className="moss-setup-sr-only" htmlFor={`${idPrefix}-local-city`}>
                Your city or ZIP
              </label>
              <div className="moss-setup-local-lookup-row">
                <input
                  id={`${idPrefix}-local-city`}
                  type="text"
                  className="moss-setup-input moss-setup-input--grow"
                  placeholder="e.g. 98682 or Seattle"
                  value={localCity}
                  onChange={(e) => setLocalCity(e.target.value)}
                  disabled={editorBusy}
                  autoComplete="postal-code"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleLocalLookup()
                    }
                  }}
                />
                <MossButton
                  variant="quiet"
                  size="sm"
                  disabled={editorBusy || !localCity.trim()}
                  onClick={() => handleLocalLookup()}
                >
                  Look up
                </MossButton>
              </div>
              {localLookupError && (
                <p className="moss-setup-local-error" role="alert">
                  {localLookupError}
                </p>
              )}
              {resolvedLocalFeeds.length > 0 && (
                <div
                  className="moss-setup-outlet-grid moss-setup-local-grid"
                  role="group"
                  aria-label="Local news sources"
                >
                  {resolvedLocalFeeds.map((feed) => {
                    const on = selectedLocalFeeds.has(feed.url)
                    return (
                      <button
                        key={feed.url}
                        type="button"
                        aria-pressed={on}
                        disabled={editorBusy}
                        className={[
                          'moss-setup-outlet-card',
                          on ? 'moss-setup-outlet-card--on' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => toggleLocalFeed(feed.url)}
                      >
                        <NewsSourceLogo
                          logoUrl={resolveSourceLogoUrl(feed.title, feed.url)}
                          label={feed.title}
                          size="md"
                          className="moss-setup-outlet-logo"
                        />
                        <span className="moss-setup-outlet-name">{feed.title}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="moss-setup-news-block moss-setup-national-block">
            <label className="moss-setup-news-label" htmlFor={`${idPrefix}-outlet-search`}>
              Add a source by name
            </label>
            <input
              id={`${idPrefix}-outlet-search`}
              type="search"
              className="moss-setup-input"
              placeholder='e.g. "The Verge" or ESPN'
              value={outletSearch}
              onChange={(e) => setOutletSearch(e.target.value)}
              disabled={editorBusy}
            />
            {outletSearch.trim() && searchMatches.length === 0 && (
              <p className="moss-setup-fineprint">No matches — try a major outlet name.</p>
            )}

            <p className="moss-setup-news-label moss-setup-news-label--spaced">
              National &amp; topic sources
            </p>
            <div className="moss-setup-outlet-grid" role="group" aria-label="News sources">
              {visibleOutlets.map((outlet) => {
                const on = selectedOutlets.has(outlet.id)
                return (
                  <button
                    key={outlet.id}
                    type="button"
                    aria-pressed={on}
                    disabled={editorBusy}
                    className={[
                      'moss-setup-outlet-card',
                      on ? 'moss-setup-outlet-card--on' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => toggleOutlet(outlet.id)}
                  >
                    <NewsSourceLogo
                      logoUrl={faviconLogoUrl(outlet.domain)}
                      label={outlet.name}
                      size="md"
                      className="moss-setup-outlet-logo"
                    />
                    <span className="moss-setup-outlet-name">{outlet.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {selectedOutlets.size > 0 && (
            <div className="moss-setup-news-block">
              <p className="moss-setup-news-label">Sections per outlet</p>
              <p className="moss-setup-fineprint">
                Pick the desks you want — one chip per section.
              </p>
              <ul className="moss-setup-sources">
                {NEWS_SOURCE_CATALOG.filter((o) => selectedOutlets.has(o.id)).map((outlet) => (
                  <li key={outlet.id} className="moss-setup-source">
                    <div className="moss-setup-source-head">
                      <NewsSourceLogo
                        logoUrl={faviconLogoUrl(outlet.domain)}
                        label={outlet.name}
                        size="sm"
                      />
                      <span className="moss-setup-source-name">{outlet.name}</span>
                    </div>
                    <div className="moss-setup-topic-row">
                      {visibleTopicsForOutlet(outlet, selectedInterests).map((topic) => {
                        const key = `${outlet.id}:${topic.id}`
                        const on = selectedFeeds.has(key)
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={on}
                            disabled={editorBusy}
                            className={[
                              'moss-setup-topic-chip',
                              on ? 'moss-setup-topic-chip--on' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => toggleFeed(key)}
                          >
                            {topic.label}
                          </button>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <button
          type="button"
          className="moss-setup-link"
          disabled={editorBusy}
          onClick={() => setShowAdvanced((open) => !open)}
        >
          {showAdvanced ? 'Hide advanced' : 'Advanced — add a website'}
        </button>
        {showAdvanced && (
          <form className="moss-setup-advanced" onSubmit={(e) => void handleAdvancedAdd(e)}>
            <input
              type="text"
              className="moss-setup-input"
              placeholder="e.g. theverge.com"
              value={customWebsiteUrl}
              onChange={(e) => setCustomWebsiteUrl(e.target.value)}
              disabled={editorBusy}
            />
            {variant === 'settings' && (
              <MossButton
                type="submit"
                variant="quiet"
                size="sm"
                disabled={editorBusy || !customWebsiteUrl.trim()}
              >
                Add website
              </MossButton>
            )}
            <p className="moss-setup-fineprint">
              Paste a news site — we find the feed for you.
            </p>
          </form>
        )}

        {variant === 'settings' && sources.length > 0 && (
          <div className="moss-news-subscribed">
            <p className="moss-setup-news-label">Your active sources</p>
            <ul className="moss-news-subscribed-list">
              {sources.map((source) => (
                <li key={source.id} className="moss-news-subscribed-row">
                  <NewsSourceLogo
                    logoUrl={resolveSourceLogoUrl(source.title, source.url)}
                    label={source.title}
                    size="sm"
                  />
                  <span className="moss-news-subscribed-copy">
                    <span className="moss-news-subscribed-title">{source.title}</span>
                    <span
                      className={[
                        'moss-news-subscribed-meta nutrition-mono',
                        source.lastError ? 'moss-news-subscribed-meta--error' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={source.lastError ?? undefined}
                    >
                      {source.lastError
                        ? source.lastError
                        : source.lastFetchedAt
                          ? `Updated ${new Date(source.lastFetchedAt).toLocaleString()}`
                          : 'Waiting for first refresh'}
                    </span>
                  </span>
                  {source.lastError ? (
                    <MossButton
                      size="xs"
                      disabled={editorBusy}
                      onClick={() => void retrySource(source.id)}
                    >
                      Retry
                    </MossButton>
                  ) : null}
                  <MossButton
                    variant="danger"
                    size="xs"
                    subtle
                    disabled={editorBusy}
                    onClick={() => void removeSource(source.id)}
                    aria-label={`Remove ${source.title}`}
                  >
                    Remove
                  </MossButton>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }
)
