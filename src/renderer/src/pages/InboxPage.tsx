import '../InboxPage.css'
import '../SettingsPage.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MODULE_VISUAL } from '@shared/modules'
import { NAV_ITEMS } from '@shared/types'
import type {
  MailComposeMode,
  MailDraftRecord,
  MailDraftSummary,
  MailMessageDetail,
  MailMessageSummary
} from '@shared/mail'
import { MAIL_LIST_DEFAULT_LIMIT, MAIL_LIST_MAX_LIMIT } from '@shared/mailSyncConstants'
import { formatMailAge, formatMailTimestamp, mailDisplayName } from '@shared/mail'
import { MailMessageView } from '../components/MailMessageView'
import { MailComposer } from '../components/MailComposer'
import { MailAccountConnectFlow } from '../components/MailAccountConnectFlow'
import { MossModal } from '../components/MossModal'
import { MossSelect } from '../components/MossSelect'
import { MossSkeleton } from '../components/MossSkeleton'
import { MossEmptyState } from '../components/MossEmptyState'
import { MossButton } from '../components/MossButton'
import { MossToolbar } from '../components/MossToolbar'

type InboxListView = 'inbox' | 'drafts'

interface ComposerState {
  mode: MailComposeMode
  original: MailMessageDetail | null
  draft?: MailDraftRecord | null
  /** Start an AI draft the moment the composer opens (draft-only — sending stays manual). */
  aiDraft?: boolean
}

function InboxListSkeleton({ rows = 6 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="inbox-list-skeleton" aria-busy="true" aria-label="Loading mail">
      {Array.from({ length: rows }, (_, index) => (
        <div className="inbox-list-skeleton-row" key={index}>
          <MossSkeleton width={index % 2 === 0 ? '42%' : '34%'} />
          <MossSkeleton width={index % 3 === 0 ? '88%' : '72%'} />
          <MossSkeleton width="58%" height="0.625rem" />
        </div>
      ))}
    </div>
  )
}

function InboxReadingSkeleton(): React.JSX.Element {
  return (
    <div className="inbox-reading-skeleton" aria-busy="true" aria-label="Opening message">
      <MossSkeleton width="68%" height="1.25rem" />
      <MossSkeleton width="42%" />
      <MossSkeleton width="26%" height="0.625rem" />
      <div className="inbox-reading-skeleton-actions">
        <MossSkeleton variant="block" width="5.5rem" height="2.25rem" />
        <MossSkeleton variant="block" width="7.5rem" height="2.25rem" />
      </div>
      <MossSkeleton width="94%" />
      <MossSkeleton width="87%" />
      <MossSkeleton width="91%" />
      <MossSkeleton width="62%" />
    </div>
  )
}

function InboxShellSkeleton(): React.JSX.Element {
  return (
    <div className="inbox-shell inbox-shell--loading">
      <aside className="inbox-list-pane">
        <div className="inbox-list-controls inbox-list-controls--skeleton" aria-hidden>
          <MossSkeleton variant="block" height="2.5rem" />
          <MossSkeleton width="62%" height="1.75rem" />
        </div>
        <InboxListSkeleton />
      </aside>
      <section className="inbox-reading-pane">
        <InboxReadingSkeleton />
      </section>
    </div>
  )
}

export function InboxPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.inbox
  const item = NAV_ITEMS.find((nav) => nav.id === 'inbox')
  const bridgeReady = Boolean(window.moss?.mail)
  const navigate = useNavigate()

  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailMessageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [listLimit, setListLimit] = useState(MAIL_LIST_DEFAULT_LIMIT)
  const [listView, setListView] = useState<InboxListView>('inbox')
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [addAccountError, setAddAccountError] = useState<string | null>(null)

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
    enabled: bridgeReady && listView === 'inbox',
    placeholderData: (prev) => prev
  })

  const draftsQuery = useQuery({
    queryKey: ['mail', 'drafts', accountFilter],
    queryFn: () =>
      window.moss.mail.listDrafts(accountFilter === 'all' ? undefined : accountFilter),
    enabled: bridgeReady && (statusQuery.data?.accounts?.length ?? 0) > 0,
    placeholderData: (prev) => prev
  })

  const configured = statusQuery.data?.configured ?? false
  const accounts = statusQuery.data?.accounts ?? []
  const messages = messagesQuery.data?.messages ?? []
  const drafts = draftsQuery.data ?? []
  const draftCount = drafts.length
  const totalCount = messagesQuery.data?.totalCount ?? 0
  const staleCount = accounts.filter((account) => account.enabled && account.stale).length
  const statusInitialLoading = bridgeReady && statusQuery.isPending && !statusQuery.data
  const messagesInitialLoading =
    listView === 'inbox' && messagesQuery.isPending && !messagesQuery.data
  const draftsInitialLoading =
    listView === 'drafts' && draftsQuery.isPending && !draftsQuery.data

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
          setActionError('Some accounts could not refresh — showing the last good copy.')
        } else if (announce && imported > 0) {
          setFlash(`Updated · ${imported} new message${imported === 1 ? '' : 's'}`)
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Mail refresh failed')
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

  const openDraft = useCallback(
    async (summary: MailDraftSummary) => {
      if (!window.moss?.mail?.getDraft) return
      setListView('drafts')
      setSelectedId(null)
      setDetail(null)
      try {
        const full = await window.moss.mail.getDraft(summary.id)
        if (!full) {
          setActionError('This draft is no longer available')
          await queryClient.invalidateQueries({ queryKey: ['mail', 'drafts'] })
          return
        }
        let original: MailMessageDetail | null = null
        if (full.inReplyToMessageId) {
          original = await window.moss.mail.getMessage(full.inReplyToMessageId)
        }
        setComposer({
          mode: full.composeMode,
          original,
          draft: full
        })
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not open this draft')
      }
    },
    [queryClient]
  )

  const deleteDraft = useCallback(
    async (draftId: string) => {
      if (!window.moss?.mail?.deleteDraft) return
      setBusy(true)
      setActionError(null)
      try {
        await window.moss.mail.deleteDraft(draftId)
        await queryClient.invalidateQueries({ queryKey: ['mail', 'drafts'] })
        setFlash('Draft deleted')
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not delete draft')
      } finally {
        setBusy(false)
      }
    },
    [queryClient]
  )

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
            {statusInitialLoading ? (
              <div className="inbox-toolbar-skeleton" aria-hidden>
                <MossSkeleton variant="block" width="6.5rem" height="2.25rem" />
                <MossSkeleton variant="block" width="5.5rem" height="2.25rem" />
              </div>
            ) : null}
            {hasAccounts && (
              <MossToolbar label="Inbox actions">
                <MossToolbar.Group label="Mail actions">
                  <MossButton
                    variant="quiet"
                    size="sm"
                    className={[
                      'inbox-sync-button',
                      syncing ? 'inbox-sync-button--syncing' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={syncing ? 'Checking for mail' : 'Check for new mail'}
                    title={
                      syncing
                        ? 'Checking for mail…'
                        : staleCount > 0
                          ? 'Some accounts are behind — refresh now'
                          : 'Check for new mail'
                    }
                    disabled={syncing || busy}
                    onClick={() => void syncAll(true)}
                  >
                    <span className="calendar-sync-glyph" aria-hidden />
                    {syncing ? 'Refreshing…' : 'Refresh'}
                  </MossButton>
                  <MossButton
                    size="sm"
                    onClick={() => setComposer({ mode: 'new', original: null })}
                  >
                    Compose
                  </MossButton>
                </MossToolbar.Group>
              </MossToolbar>
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

        {statusInitialLoading ? (
          <InboxShellSkeleton />
        ) : !hasAccounts ? (
          <InboxEmptyState
            configured={configured}
            connecting={connecting}
            bridgeReady={bridgeReady}
            onConnect={() => void connectGmail()}
            onSetUp={() => navigate('/settings?section=inbox')}
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
                <MossToolbar className="inbox-list-toolbar" label="Inbox list controls">
                  <MossToolbar.Group label="Mailbox views">
                    <button
                      type="button"
                      className={[
                        'inbox-chip',
                        listView === 'inbox' && !unreadOnly ? 'inbox-chip--active' : ''
                      ].join(' ')}
                      onClick={() => {
                        setListView('inbox')
                        setUnreadOnly(false)
                      }}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={[
                        'inbox-chip',
                        listView === 'inbox' && unreadOnly ? 'inbox-chip--active' : ''
                      ].join(' ')}
                      onClick={() => {
                        setListView('inbox')
                        setUnreadOnly(true)
                      }}
                    >
                      Unread
                    </button>
                    <button
                      type="button"
                      className={[
                        'inbox-chip',
                        listView === 'drafts' ? 'inbox-chip--active' : ''
                      ].join(' ')}
                      onClick={() => setListView('drafts')}
                    >
                      Drafts{draftCount > 0 ? ` (${draftCount})` : ''}
                    </button>
                  </MossToolbar.Group>
                  <MossToolbar.Group label="Account controls">
                    {multiAccount && listView === 'inbox' && (
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
                    <MossButton
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        setAddAccountError(null)
                        setShowAddAccount(true)
                      }}
                    >
                      Add account
                    </MossButton>
                  </MossToolbar.Group>
                </MossToolbar>
                {listView === 'drafts' && (
                  <p className="inbox-drafts-local-hint nutrition-mono">
                    Drafts stay on this computer — they are not saved to your email account.
                  </p>
                )}
              </div>

              {listView === 'drafts' ? (
                draftsInitialLoading ? (
                  <InboxListSkeleton rows={5} />
                ) : drafts.length === 0 ? (
                  <div className="inbox-list-empty">
                    <p className="inbox-list-empty-title">No drafts</p>
                    <p className="inbox-list-empty-copy">
                      Start composing — MOSS saves a draft when you close with something written.
                    </p>
                  </div>
                ) : (
                  <ul className="inbox-message-list inbox-draft-list">
                    {drafts.map((draftRow) => (
                      <li key={draftRow.id}>
                        <div className="inbox-draft-row">
                          <button
                            type="button"
                            className="inbox-message-row inbox-draft-row-main"
                            onClick={() => void openDraft(draftRow)}
                          >
                            <span className="inbox-message-main">
                              <span className="inbox-message-top">
                                <span className="inbox-message-sender">
                                  {draftRow.toEmails.trim() || '(no recipient)'}
                                </span>
                                <span className="inbox-message-age nutrition-mono">
                                  {formatMailAge(draftRow.updatedAt)}
                                </span>
                              </span>
                              <span className="inbox-message-subject">
                                <span className="inbox-message-subject-text">
                                  {draftRow.subject || '(no subject)'}
                                </span>
                              </span>
                              <span className="inbox-message-snippet">{draftRow.snippet}</span>
                              {multiAccount && (
                                <span className="inbox-message-account nutrition-mono">
                                  {draftRow.accountEmail}
                                </span>
                              )}
                            </span>
                          </button>
                          <MossButton
                            variant="danger"
                            size="sm"
                            subtle
                            className="inbox-draft-delete"
                            aria-label="Delete draft"
                            disabled={busy}
                            onClick={() => void deleteDraft(draftRow.id)}
                          >
                            Delete
                          </MossButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : messagesInitialLoading ? (
                <InboxListSkeleton />
              ) : messages.length === 0 ? (
                <div className="inbox-list-empty">
                  <p className="inbox-list-empty-title">
                    {debouncedQuery
                      ? 'No matches'
                      : unreadOnly
                        ? 'No unread mail'
                        : 'Inbox is clear'}
                  </p>
                  <p className="inbox-list-empty-copy">
                    {syncing ? 'Refreshing…' : debouncedQuery ? 'Try another search.' : 'Nothing waiting on you.'}
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
                    <MossButton
                      variant="quiet"
                      size="sm"
                      onClick={() =>
                        setListLimit((limit) =>
                          Math.min(limit + MAIL_LIST_DEFAULT_LIMIT, MAIL_LIST_MAX_LIMIT)
                        )
                      }
                    >
                      Load more
                    </MossButton>
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
              ) : detailLoading && !detail ? (
                <InboxReadingSkeleton />
              ) : !detail ? (
                <div className="inbox-reading-empty" />
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
                    <MossToolbar className="inbox-reading-toolbar" label="Message actions">
                      <MossToolbar.Group label="Reply actions">
                        <MossButton
                          size="sm"
                          onClick={() => setComposer({ mode: 'reply', original: detail })}
                          disabled={busy}
                        >
                          Reply
                        </MossButton>
                        <MossButton
                          variant="quiet"
                          size="sm"
                          onClick={() =>
                            setComposer({ mode: 'reply', original: detail, aiDraft: true })
                          }
                          disabled={busy}
                          title="MOSS writes a reply draft — you edit and you send"
                        >
                          Draft with MOSS
                        </MossButton>
                        {(detail.toEmails || detail.ccEmails) && (
                          <MossButton
                            variant="quiet"
                            size="sm"
                            onClick={() => setComposer({ mode: 'replyAll', original: detail })}
                            disabled={busy}
                          >
                            Reply all
                          </MossButton>
                        )}
                        <MossButton
                          variant="quiet"
                          size="sm"
                          onClick={() => setComposer({ mode: 'forward', original: detail })}
                          disabled={busy}
                        >
                          Forward
                        </MossButton>
                      </MossToolbar.Group>
                      <MossToolbar.Group label="Message state">
                        <MossButton
                          variant="quiet"
                          size="sm"
                          onClick={() => void markUnread(detail.id)}
                          disabled={busy}
                        >
                          Mark unread
                        </MossButton>
                        <MossButton
                          variant="quiet"
                          size="sm"
                          onClick={() => void archiveMessage(detail.id)}
                          disabled={busy}
                        >
                          Archive
                        </MossButton>
                        <MossButton
                          variant="danger"
                          size="sm"
                          subtle
                          onClick={() => void trashMessage(detail.id)}
                          disabled={busy}
                        >
                          Trash
                        </MossButton>
                      </MossToolbar.Group>
                    </MossToolbar>
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
          draft={composer.draft}
          initialAiDraft={composer.aiDraft}
          onClose={() => setComposer(null)}
          onDraftSaved={() => void queryClient.invalidateQueries({ queryKey: ['mail', 'drafts'] })}
          onSent={(summary) => {
            setComposer(null)
            setFlash(summary)
            void queryClient.invalidateQueries({ queryKey: ['mail', 'drafts'] })
            void syncAll(false)
          }}
        />
      )}

      {showAddAccount && (
        <MossModal
          onClose={() => setShowAddAccount(false)}
          backdropClassName="mail-composer-overlay"
          panelClassName="mail-add-account-modal"
          ariaLabel="Add mail account"
        >
          <header className="mail-composer-head">
            <p className="settings-kicker">Inbox</p>
            <MossButton
              variant="icon"
              size="sm"
              aria-label="Close"
              onClick={() => setShowAddAccount(false)}
            >
              ✕
            </MossButton>
          </header>
          {addAccountError && (
            <p className="settings-inline-error">{addAccountError}</p>
          )}
          <MailAccountConnectFlow
            compact
            onConnected={(message) => {
              setFlash(message)
              setShowAddAccount(false)
              void queryClient.invalidateQueries({ queryKey: ['mail'] })
            }}
            onError={setAddAccountError}
          />
        </MossModal>
      )}
    </div>
  )
}

function InboxEmptyState({
  configured,
  connecting,
  bridgeReady,
  onConnect,
  onSetUp
}: {
  configured: boolean
  connecting: boolean
  bridgeReady: boolean
  onConnect: () => void
  onSetUp: () => void
}): React.JSX.Element {
  return (
    <section className="inbox-first-run" aria-label="Set up Inbox">
      <span className="inbox-first-run__ambient" aria-hidden />
      <MossEmptyState
        className="inbox-empty-card"
        icon={
          <svg viewBox="0 0 32 24" aria-hidden>
            <rect x="1" y="1" width="30" height="22" rx="4" />
            <path d="m3 5 13 10L29 5" />
          </svg>
        }
        kicker="Inbox"
        title="Your mail, calm and in one place"
        body={
          <>
            <p>
              Read, reply, and send without leaving MOSS. Gmail connects in one click; iCloud,
              Fastmail, Yahoo, Zoho, and Proton Bridge work too.
            </p>
            <p className="inbox-empty-trust">
              Your sign-in details stay in your computer’s secure storage. Headlines stay in
              the dashboard News briefing; this space is just for email.
            </p>
          </>
        }
        action={{
          label: configured ? 'Connect Gmail' : 'Set up email',
          variant: 'primary',
          busy: connecting,
          busyLabel: 'Opening Google…',
          disabled: configured && !bridgeReady,
          onClick: configured ? onConnect : onSetUp
        }}
      />
    </section>
  )
}
