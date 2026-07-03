import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MODULE_VISUAL } from '@shared/modules'
import { NAV_ITEMS } from '@shared/types'
import type {
  MailComposeMode,
  MailMessageDetail,
  MailMessageSummary
} from '@shared/mail'
import { MAIL_LIST_DEFAULT_LIMIT, MAIL_LIST_MAX_LIMIT } from '@shared/mailSyncConstants'
import { formatMailAge, formatMailTimestamp, mailDisplayName } from '@shared/mail'
import { MailMessageView } from '../components/MailMessageView'
import { MailComposer } from '../components/MailComposer'
import { MossSelect } from '../components/MossSelect'

interface ComposerState {
  mode: MailComposeMode
  original: MailMessageDetail | null
}

export function InboxPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.inbox
  const item = NAV_ITEMS.find((nav) => nav.id === 'inbox')
  const bridgeReady = Boolean(window.moss?.mail)

  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailMessageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [listLimit, setListLimit] = useState(MAIL_LIST_DEFAULT_LIMIT)
  const [composer, setComposer] = useState<ComposerState | null>(null)

  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const didSyncRef = useRef(false)

  const listOptions = useMemo(
    () => ({
      folder: 'inbox' as const,
      unreadOnly,
      accountId: accountFilter === 'all' ? undefined : accountFilter,
      query: debouncedQuery.trim() || undefined,
      limit: listLimit
    }),
    [unreadOnly, accountFilter, debouncedQuery, listLimit]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery), 280)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setListLimit(MAIL_LIST_DEFAULT_LIMIT)
  }, [debouncedQuery, unreadOnly, accountFilter])

  const statusQuery = useQuery({
    queryKey: ['mail', 'status'],
    queryFn: () => window.moss.mail.getStatus(),
    enabled: bridgeReady
  })

  // Filter/search/limit-scoped inbox slice — refetched when the list options change.
  const messagesQuery = useQuery({
    queryKey: ['mail', 'messages', listOptions],
    queryFn: async () => {
      const [messages, count] = await Promise.all([
        window.moss.mail.listMessages(listOptions),
        window.moss.mail.countMessages?.({
          folder: listOptions.folder,
          unreadOnly: listOptions.unreadOnly,
          accountId: listOptions.accountId,
          query: listOptions.query
        }) ?? Promise.resolve(0)
      ])
      return { messages, totalCount: count || messages.length }
    },
    enabled: bridgeReady,
    // Keep the current list on screen while a filter/search refetch is in flight.
    placeholderData: (prev) => prev
  })

  const configured = statusQuery.data?.configured ?? false
  const accounts = statusQuery.data?.accounts ?? []
  const messages = messagesQuery.data?.messages ?? []
  const totalCount = messagesQuery.data?.totalCount ?? 0
  const staleCount = accounts.filter((account) => account.enabled && account.stale).length

  const queryError = !bridgeReady
    ? 'Inbox needs the MOSS desktop app — open it with npm run dev, not a browser tab.'
    : statusQuery.error
      ? statusQuery.error instanceof Error
        ? statusQuery.error.message
        : 'Failed to load mail accounts'
      : null
  const error = actionError ?? queryError

  // Optimistic surgery on the currently-visible list slice (read dots, archive/trash removal).
  const patchMessageList = useCallback(
    (updater: (rows: MailMessageSummary[]) => MailMessageSummary[]) => {
      queryClient.setQueryData<{ messages: MailMessageSummary[]; totalCount: number }>(
        ['mail', 'messages', listOptions],
        (prev) => (prev ? { ...prev, messages: updater(prev.messages) } : prev)
      )
    },
    [queryClient, listOptions]
  )

  // Background sync once on arrival (mirrors Calendar), then refresh.
  const syncAll = useCallback(
    async (announce: boolean) => {
      if (!window.moss?.mail?.syncAll) return
      setSyncing(true)
      try {
        const result = await window.moss.mail.syncAll()
        await queryClient.invalidateQueries({ queryKey: ['mail'] })
        const imported = result.results.reduce((sum, entry) => sum + entry.imported, 0)
        const failed = result.results.filter((entry) => entry.error)
        if (failed.length > 0) {
          setActionError('Some accounts could not sync — showing the last good copy.')
        } else if (announce && imported > 0) {
          setFlash(`Synced · ${imported} new message${imported === 1 ? '' : 's'}`)
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Mail sync failed')
      } finally {
        setSyncing(false)
      }
    },
    [queryClient]
  )

  useEffect(() => {
    if (!bridgeReady || didSyncRef.current) return
    didSyncRef.current = true
    const id = window.setTimeout(() => void syncAll(false), 360)
    return () => window.clearTimeout(id)
  }, [bridgeReady, syncAll])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 3600)
    return () => window.clearTimeout(timer)
  }, [flash])

  const openMessage = useCallback(
    async (summary: MailMessageSummary) => {
      if (!window.moss?.mail) return
      setSelectedId(summary.id)
      setDetailLoading(true)
      // Keep the previous message on screen (dimmed) while the next loads — no collapse-to-spinner flash.
      try {
        const full = await window.moss.mail.getMessage(summary.id)
        setDetail(full)
        if (full && !summary.read) {
          await window.moss.mail.setRead(summary.id, true)
          patchMessageList((rows) =>
            rows.map((row) => (row.id === summary.id ? { ...row, read: true } : row))
          )
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not open this message')
      } finally {
        setDetailLoading(false)
      }
    },
    [patchMessageList]
  )

  async function runAction(task: () => Promise<void>, successMessage?: string): Promise<void> {
    if (!window.moss?.mail) return
    setBusy(true)
    setActionError(null)
    try {
      await task()
      if (successMessage) setFlash(successMessage)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  function removeFromList(id: string): void {
    patchMessageList((rows) => rows.filter((row) => row.id !== id))
    if (selectedId === id) {
      setSelectedId(null)
      setDetail(null)
    }
  }

  const archiveMessage = (id: string): Promise<void> =>
    runAction(async () => {
      await window.moss.mail.archive(id)
      removeFromList(id)
      await queryClient.invalidateQueries({ queryKey: ['mail', 'status'] })
    }, 'Archived')

  const trashMessage = (id: string): Promise<void> =>
    runAction(async () => {
      await window.moss.mail.trash(id)
      removeFromList(id)
      await queryClient.invalidateQueries({ queryKey: ['mail', 'status'] })
    }, 'Moved to Trash')

  const markUnread = (id: string): Promise<void> =>
    runAction(async () => {
      await window.moss.mail.setRead(id, false)
      patchMessageList((rows) => rows.map((row) => (row.id === id ? { ...row, read: false } : row)))
      if (detail?.id === id) setDetail({ ...detail, read: false })
      await queryClient.invalidateQueries({ queryKey: ['mail', 'status'] })
    }, 'Marked unread')

  async function connectGmail(): Promise<void> {
    if (!window.moss?.mail?.connectGmail) return
    setConnecting(true)
    setActionError(null)
    try {
      const result = await window.moss.mail.connectGmail()
      setFlash(`Connected ${result.email} · ${result.imported} messages`)
      await queryClient.invalidateQueries({ queryKey: ['mail'] })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect Gmail'
      // Cancelling (or superseding with a retry) isn't an error worth surfacing.
      if (!/cancel/i.test(message)) setActionError(message)
    } finally {
      setConnecting(false)
    }
  }

  function cancelGmailConnect(): void {
    void window.moss?.mail?.cancelConnectGmail?.()
  }

  const hasAccounts = accounts.length > 0
  const multiAccount = accounts.length > 1
  const unreadTotal = messages.filter((m) => !m.read).length
  const canLoadMore = messages.length < totalCount && listLimit < MAIL_LIST_MAX_LIMIT

  return (
    <div className="moss-arrival moss-arrival-inbox" data-module="inbox" data-texture={visual.texture}>
      <header className="moss-arrival-band inbox-arrival-band">
        <div className="moss-arrival-band-inner module-arrival-head">
          <div className="module-arrival-title-block">
            <h1 className="display-arrival">{item?.label ?? 'Inbox'}</h1>
          </div>
          <div className="module-arrival-meta-block inbox-arrival-meta-block">
            <p className="module-arrival-meta nutrition-mono">
              {hasAccounts
                ? debouncedQuery
                  ? `${totalCount} match${totalCount === 1 ? '' : 'es'}`
                  : `${unreadTotal} unread`
                : 'Mail'}
            </p>
            {hasAccounts && (
              <div className="inbox-toolbar">
                <button
                  type="button"
                  className={[
                    'calendar-sync-indicator',
                    syncing ? 'calendar-sync-indicator--syncing' : '',
                    staleCount > 0 && !syncing ? 'calendar-sync-indicator--stale' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={syncing ? 'Syncing mail' : 'Sync mail now'}
                  title={syncing ? 'Syncing mail…' : 'Sync now'}
                  disabled={syncing || busy}
                  onClick={() => void syncAll(true)}
                >
                  <span className="calendar-sync-glyph" aria-hidden />
                </button>
                <button
                  type="button"
                  className="calendar-settings-button calendar-settings-button--primary inbox-compose-button"
                  onClick={() => setComposer({ mode: 'new', original: null })}
                >
                  Compose
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="moss-arrival-body inbox-arrival-body">
        {flash && <p className="settings-inline-flash inbox-flash">{flash}</p>}
        {error && (
          <div className="calendar-error-banner" role="alert">
            <p className="calendar-error">{error}</p>
          </div>
        )}

        {!hasAccounts ? (
          <InboxEmptyState
            configured={configured}
            connecting={connecting}
            bridgeReady={bridgeReady}
            onConnect={() => void connectGmail()}
            onCancel={cancelGmailConnect}
          />
        ) : (
          <div className="inbox-shell">
            <aside className="inbox-list-pane">
              <div className="inbox-list-controls">
                <label className="inbox-search-field">
                  <span className="sr-only">Search mail</span>
                  <input
                    type="search"
                    className="preference-input inbox-search-input"
                    placeholder="Search name, subject, or message…"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className="inbox-list-controls-row">
                  <div className="inbox-filter-chips">
                    <button
                      type="button"
                      className={['inbox-chip', !unreadOnly ? 'inbox-chip--active' : ''].join(' ')}
                      onClick={() => setUnreadOnly(false)}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={['inbox-chip', unreadOnly ? 'inbox-chip--active' : ''].join(' ')}
                      onClick={() => setUnreadOnly(true)}
                    >
                      Unread
                    </button>
                  </div>
                  {multiAccount && (
                    <MossSelect
                      className="moss-select--block inbox-account-select"
                      value={accountFilter}
                      options={[
                        { value: 'all', label: 'All accounts' },
                        ...accounts.map((account) => ({ value: account.id, label: account.email }))
                      ]}
                      onChange={setAccountFilter}
                      ariaLabel="Filter by account"
                    />
                  )}
                </div>
              </div>

              {messages.length === 0 ? (
                <div className="inbox-list-empty">
                  <p className="inbox-list-empty-title">
                    {debouncedQuery
                      ? 'No matches'
                      : unreadOnly
                        ? 'No unread mail'
                        : 'Inbox is clear'}
                  </p>
                  <p className="inbox-list-empty-copy">
                    {syncing ? 'Syncing…' : debouncedQuery ? 'Try another search.' : 'Nothing waiting on you.'}
                  </p>
                </div>
              ) : (
                <>
                <ul className="inbox-message-list">
                  {messages.map((message) => (
                    <li key={message.id}>
                      <button
                        type="button"
                        className={[
                          'inbox-message-row',
                          message.id === selectedId ? 'inbox-message-row--active' : '',
                          message.read ? '' : 'inbox-message-row--unread'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => void openMessage(message)}
                      >
                        <span className="inbox-message-unread-dot" aria-hidden />
                        <span className="inbox-message-main">
                          <span className="inbox-message-top">
                            <span className="inbox-message-sender">
                              {mailDisplayName(message.fromName, message.fromEmail)}
                            </span>
                            <span className="inbox-message-age nutrition-mono">
                              {formatMailAge(message.receivedAt)}
                            </span>
                          </span>
                          <span className="inbox-message-subject">
                            {message.hasAttachments && (
                              <svg
                                className="inbox-message-clip"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-label="Has attachment"
                                role="img"
                              >
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                              </svg>
                            )}
                            <span className="inbox-message-subject-text">
                              {message.subject || '(no subject)'}
                            </span>
                          </span>
                          <span className="inbox-message-snippet">{message.snippet}</span>
                          {multiAccount && (
                            <span className="inbox-message-account nutrition-mono">
                              {message.accountEmail}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <footer className="inbox-list-footer">
                  <p className="inbox-list-count nutrition-mono">
                    Showing {messages.length} of {totalCount}
                  </p>
                  {canLoadMore && (
                    <button
                      type="button"
                      className="calendar-settings-button"
                      onClick={() =>
                        setListLimit((limit) =>
                          Math.min(limit + MAIL_LIST_DEFAULT_LIMIT, MAIL_LIST_MAX_LIMIT)
                        )
                      }
                    >
                      Load more
                    </button>
                  )}
                </footer>
                </>
              )}
            </aside>

            <section className="inbox-reading-pane">
              {!selectedId ? (
                <div className="inbox-reading-empty">
                  <p className="inbox-reading-empty-title">Select a message</p>
                  <p className="inbox-reading-empty-copy">
                    Read, reply, and send without leaving MOSS.
                  </p>
                </div>
              ) : !detail ? (
                <div className="inbox-reading-empty">
                  <p className="inbox-reading-empty-copy">Opening…</p>
                </div>
              ) : (
                <article
                  className={[
                    'inbox-reading',
                    detailLoading && detail.id !== selectedId ? 'inbox-reading--loading' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <header className="inbox-reading-head">
                    <h2 className="inbox-reading-subject">{detail.subject || '(no subject)'}</h2>
                    <div className="inbox-reading-meta">
                      <span className="inbox-reading-from">
                        {mailDisplayName(detail.fromName, detail.fromEmail)}
                        <span className="inbox-reading-from-email nutrition-mono">
                          {' '}
                          &lt;{detail.fromEmail}&gt;
                        </span>
                      </span>
                      <span className="inbox-reading-time nutrition-mono">
                        {formatMailTimestamp(detail.receivedAt)}
                      </span>
                    </div>
                    {detail.toEmails && (
                      <p className="inbox-reading-recipients nutrition-mono">to {detail.toEmails}</p>
                    )}
                    <div className="inbox-reading-actions">
                      <button
                        type="button"
                        className="calendar-settings-button calendar-settings-button--primary"
                        onClick={() => setComposer({ mode: 'reply', original: detail })}
                        disabled={busy}
                      >
                        Reply
                      </button>
                      {(detail.toEmails || detail.ccEmails) && (
                        <button
                          type="button"
                          className="calendar-settings-button"
                          onClick={() => setComposer({ mode: 'replyAll', original: detail })}
                          disabled={busy}
                        >
                          Reply all
                        </button>
                      )}
                      <button
                        type="button"
                        className="calendar-settings-button"
                        onClick={() => setComposer({ mode: 'forward', original: detail })}
                        disabled={busy}
                      >
                        Forward
                      </button>
                      <button
                        type="button"
                        className="calendar-settings-button calendar-settings-button--ghost"
                        onClick={() => void markUnread(detail.id)}
                        disabled={busy}
                      >
                        Mark unread
                      </button>
                      <button
                        type="button"
                        className="calendar-settings-button calendar-settings-button--ghost"
                        onClick={() => void archiveMessage(detail.id)}
                        disabled={busy}
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        className="calendar-settings-button calendar-settings-button--ghost"
                        onClick={() => void trashMessage(detail.id)}
                        disabled={busy}
                      >
                        Trash
                      </button>
                    </div>
                  </header>
                  <MailMessageView detail={detail} />
                </article>
              )}
            </section>
          </div>
        )}
      </div>

      {composer && (
        <MailComposer
          mode={composer.mode}
          accounts={accounts}
          original={composer.original}
          onClose={() => setComposer(null)}
          onSent={(summary) => {
            setComposer(null)
            setFlash(summary)
            void syncAll(false)
          }}
        />
      )}
    </div>
  )
}

function InboxEmptyState({
  configured,
  connecting,
  bridgeReady,
  onConnect,
  onCancel
}: {
  configured: boolean
  connecting: boolean
  bridgeReady: boolean
  onConnect: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <section className="module-placeholder-card inbox-empty-card">
      <p className="module-placeholder-kicker nutrition-mono">Comms intake</p>
      <h2 className="module-placeholder-title">Your mail, calm and in one place</h2>
      <p className="module-placeholder-copy">
        Connect Gmail in one click, or add any mailbox with an app password — Gmail, iCloud,
        Fastmail, Yahoo, Zoho, or Proton Bridge. Read, reply, and send without leaving MOSS.
        Headlines live on the dashboard <strong>News</strong> widget — Inbox is for email.
      </p>

      <div className="inbox-empty-actions">
        {configured && (
          <button
            type="button"
            className="calendar-settings-button calendar-settings-button--primary calendar-settings-button--wide"
            onClick={onConnect}
            disabled={connecting || !bridgeReady}
          >
            {connecting ? 'Opening Google…' : 'Connect Gmail'}
          </button>
        )}
        {connecting && (
          <button type="button" className="calendar-settings-button calendar-settings-button--ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <Link
          to="/settings?section=inbox"
          className={[
            'calendar-settings-button calendar-settings-button--wide',
            configured ? '' : 'calendar-settings-button--primary'
          ].join(' ')}
        >
          {configured ? 'Add an IMAP account' : 'Set up an account'}
        </Link>
      </div>
      <p className="module-placeholder-foot nutrition-mono">
        Credentials stay in your OS keychain · Gmail uses OAuth, IMAP uses an app password
      </p>
    </section>
  )
}
