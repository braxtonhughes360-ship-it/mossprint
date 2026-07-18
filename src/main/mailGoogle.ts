import { google, type gmail_v1 } from 'googleapis'
import type { MailConnectResult, MailSendInput, MailSendResult, MailSyncResult } from '@shared/mail'
import { MAIL_SYNC_MAX_MESSAGES, MAIL_SYNC_RETENTION_DAYS } from '@shared/mailSyncConstants'
import {
  createGmailAccount,
  findLocalMessageId,
  getMailAccount,
  getMailSyncToken,
  getMessageDetail,
  listStoredExternalIds,
  markAccountStale,
  setMessageFolderLocal,
  setMessageReadLocal,
  touchAccount,
  upsertMessage
} from './mail'
import { sanitizeEmailHtml, htmlToText, buildSnippet, MAX_BODY_LENGTH } from './mailHtml'
import { createGoogleOAuthClient, createGoogleOAuthClientForRedirect, isGoogleOAuthConfigured, runGoogleOAuthLoopback } from './googleOAuth'
import { readMailToken, storeMailToken } from './mailCredentials'

/**
 * Gmail read/compose/send/modify. Mirrors the Calendar integration pattern: main-process fetch,
 * tokens in the OS keychain, local SQLite as the canonical store with stale/last-good behavior.
 */

// gmail.modify covers read + label changes (archive) + trash; gmail.send covers compose/send.
// Trash (not permanent delete) is intentional — destructive delete needs full mail scope.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
]

const FETCH_CONCURRENCY = 5

function buildGmailClient(accountId: string): gmail_v1.Gmail {
  const tokens = readMailToken(accountId)
  if (!tokens) {
    throw new Error('Mail credentials missing — reconnect this account')
  }

  const oauth2 = createGoogleOAuthClient()
  oauth2.setCredentials(tokens)
  oauth2.on('tokens', (next) => {
    storeMailToken(accountId, { ...tokens, ...next })
  })

  return google.gmail({ version: 'v1', auth: oauth2 })
}

export async function connectGmailAccount(): Promise<MailConnectResult> {
  if (!isGoogleOAuthConfigured()) {
    throw new Error(
      'Google sign-in is not set up yet. Add OAuth once in Settings → Inbox (operator step).'
    )
  }

  const { code, redirectUri, codeVerifier } = await runGoogleOAuthLoopback(SCOPES)

  const oauth2 = createGoogleOAuthClientForRedirect(redirectUri)
  const { tokens } = await oauth2.getToken({ code, codeVerifier })
  if (!tokens.access_token) {
    throw new Error('Google sign-in did not return an access token')
  }
  oauth2.setCredentials(tokens)

  const gmail = google.gmail({ version: 'v1', auth: oauth2 })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const email = profile.data.emailAddress?.trim()
  if (!email) {
    throw new Error('Could not read the Gmail address for this account')
  }

  const accountId = createGmailAccount(email, email)
  storeMailToken(accountId, tokens as Record<string, unknown>)

  const sync = await syncGmailAccount(accountId)
  return {
    accountId,
    email,
    label: email,
    imported: sync.imported
  }
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Incremental Gmail sync. First run (no stored historyId) does a bounded full pull and records
 * the mailbox historyId; later runs ask the History API only for what changed since — so a
 * routine sync is a couple of cheap calls, never ~1500 per-message gets (which used to trip
 * Gmail's per-second rate limit and 404 on any message removed in webmail, failing the whole run).
 */
export async function syncGmailAccount(accountId: string): Promise<MailSyncResult> {
  const account = getMailAccount(accountId)
  if (!account) {
    throw new Error('Mail account not found')
  }

  try {
    const gmail = buildGmailClient(accountId)
    const startHistoryId = getMailSyncToken(accountId)

    if (startHistoryId) {
      const incremental = await incrementalGmailSync(gmail, accountId, startHistoryId)
      if (incremental) {
        touchAccount(accountId, { stale: false, error: null, syncToken: incremental.historyId })
        return { accountId, imported: incremental.imported, updated: incremental.updated, stale: false }
      }
      // null → historyId too old (Gmail expires them); fall back to a full resync below.
    }

    const full = await fullGmailSync(gmail, accountId)
    touchAccount(accountId, { stale: false, error: null, syncToken: full.historyId })
    return { accountId, imported: full.imported, updated: full.updated, stale: false }
  } catch (error) {
    const message = errorCode(error)
    markAccountStale(accountId, message)
    return { accountId, imported: 0, updated: 0, stale: true, error: message }
  }
}

async function fullGmailSync(
  gmail: gmail_v1.Gmail,
  accountId: string
): Promise<{ imported: number; updated: number; historyId: string }> {
  const query = `newer_than:${MAIL_SYNC_RETENTION_DAYS}d`
  const refs: Array<{ id?: string | null }> = []
  let pageToken: string | undefined

  while (refs.length < MAIL_SYNC_MAX_MESSAGES) {
    const list = await gmailRetry(() =>
      gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        q: query,
        maxResults: Math.min(100, MAIL_SYNC_MAX_MESSAGES - refs.length),
        pageToken
      })
    )
    const batch = list.data.messages ?? []
    refs.push(...batch)
    pageToken = list.data.nextPageToken ?? undefined
    if (!pageToken || batch.length === 0) break
  }

  // Only fetch messages we don't already have — a full pull never re-gets the whole mailbox.
  const stored = listStoredExternalIds(accountId)
  const newIds = refs.map((ref) => ref.id).filter((id): id is string => Boolean(id) && !stored.has(id!))

  const counts = await fetchAndStore(gmail, accountId, newIds)
  const historyId = await currentHistoryId(gmail)
  return { ...counts, historyId }
}

async function incrementalGmailSync(
  gmail: gmail_v1.Gmail,
  accountId: string,
  startHistoryId: string
): Promise<{ imported: number; updated: number; historyId: string } | null> {
  const stored = listStoredExternalIds(accountId)
  const toFetch = new Set<string>()
  const toReconcile = new Set<string>()
  let latestHistoryId = startHistoryId
  let pageToken: string | undefined

  try {
    do {
      const res = await gmailRetry(() =>
        gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          labelId: 'INBOX',
          historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
          maxResults: 500,
          pageToken
        })
      )
      if (res.data.historyId) latestHistoryId = res.data.historyId

      for (const record of res.data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const id = added.message?.id
          if (id && (added.message?.labelIds ?? []).includes('INBOX')) toFetch.add(id)
        }
        for (const removed of record.messagesDeleted ?? []) {
          const id = removed.message?.id
          const localId = id ? findLocalMessageId(accountId, id) : null
          if (localId) setMessageFolderLocal(localId, 'trash')
        }
        for (const change of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
          const id = change.message?.id
          if (id) toReconcile.add(id)
        }
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (error) {
    if (httpStatus(error) === 404) return null // historyId expired → caller does a full resync
    throw error
  }

  const newIds = Array.from(toFetch).filter((id) => !stored.has(id))
  const counts = await fetchAndStore(gmail, accountId, newIds)

  // Reconcile read/archive/trash for the (few) messages whose labels changed.
  const reconcileIds = Array.from(toReconcile).filter((id) => !toFetch.has(id))
  await runWithConcurrency(
    reconcileIds.map((id) => () => reconcileGmailLabels(gmail, accountId, id)),
    FETCH_CONCURRENCY
  )

  return { ...counts, historyId: latestHistoryId }
}

/** Fetch full bodies for the given ids and store them, tolerating individual failures. */
async function fetchAndStore(
  gmail: gmail_v1.Gmail,
  accountId: string,
  ids: string[]
): Promise<{ imported: number; updated: number }> {
  let imported = 0
  let updated = 0

  const tasks = ids.map((id) => async () => {
    try {
      const full = await gmailRetry(() =>
        gmail.users.messages.get({ userId: 'me', id, format: 'full' })
      )
      if (storeMessage(accountId, full.data) === 'imported') imported += 1
      else updated += 1
    } catch (error) {
      // A message vanished (moved/deleted in webmail) mustn't fail the whole sync.
      if (httpStatus(error) !== 404) throw error
    }
  })

  await runWithConcurrency(tasks, FETCH_CONCURRENCY)
  return { imported, updated }
}

async function reconcileGmailLabels(
  gmail: gmail_v1.Gmail,
  accountId: string,
  externalId: string
): Promise<void> {
  const localId = findLocalMessageId(accountId, externalId)
  if (!localId) return
  try {
    const meta = await gmailRetry(() =>
      gmail.users.messages.get({ userId: 'me', id: externalId, format: 'minimal' })
    )
    const labels = meta.data.labelIds ?? []
    setMessageReadLocal(localId, !labels.includes('UNREAD'))
    setMessageFolderLocal(
      localId,
      labels.includes('TRASH') ? 'trash' : labels.includes('INBOX') ? 'inbox' : 'archive'
    )
  } catch (error) {
    if (httpStatus(error) !== 404) throw error
  }
}

async function currentHistoryId(gmail: gmail_v1.Gmail): Promise<string> {
  const profile = await gmailRetry(() => gmail.users.getProfile({ userId: 'me' }))
  return profile.data.historyId ?? ''
}

function storeMessage(accountId: string, message: gmail_v1.Schema$Message): 'imported' | 'updated' {
  const headers = message.payload?.headers ?? []
  const header = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? ''

  const from = parseAddress(header('from'))
  const labelIds = message.labelIds ?? []
  const { html, text, hasAttachments } = extractBody(message.payload)

  const sanitizedHtml = sanitizeEmailHtml(html)
  const plain = text ? text.slice(0, MAX_BODY_LENGTH) : htmlToText(sanitizedHtml)
  const snippet = decodeGmailSnippet(message.snippet) || buildSnippet(plain)

  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : header('date')
      ? new Date(header('date')).toISOString()
      : new Date().toISOString()

  const flags = [...labelIds, ...(hasAttachments ? ['att'] : [])].join(',')

  return upsertMessage({
    accountId,
    externalId: message.id ?? '',
    threadId: message.threadId ?? null,
    folder: labelIds.includes('INBOX') ? 'inbox' : 'archive',
    fromName: from.name,
    fromEmail: from.email,
    toEmails: header('to'),
    ccEmails: header('cc'),
    subject: header('subject'),
    snippet,
    bodyHtml: sanitizedHtml,
    bodyText: plain,
    messageIdHeader: header('message-id'),
    referencesHeader: header('references') || header('in-reply-to'),
    receivedAt,
    read: !labelIds.includes('UNREAD'),
    flags
  })
}

// ── Body / header parsing ───────────────────────────────────────────────────

function extractBody(payload?: gmail_v1.Schema$MessagePart): {
  html: string
  text: string
  hasAttachments: boolean
} {
  let html = ''
  let text = ''
  let hasAttachments = false

  const walk = (part?: gmail_v1.Schema$MessagePart): void => {
    if (!part) return
    const mime = part.mimeType ?? ''
    const filename = part.filename ?? ''

    if (filename) {
      hasAttachments = true
    }

    if (mime === 'text/html' && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data)
    } else if (mime === 'text/plain' && part.body?.data && !filename && !text) {
      text = decodeBase64Url(part.body.data)
    }

    for (const child of part.parts ?? []) {
      walk(child)
    }
  }

  walk(payload)
  return { html, text, hasAttachments }
}

interface ParsedAddress {
  name: string
  email: string
}

function parseAddress(raw: string): ParsedAddress {
  if (!raw) return { name: '', email: '' }
  // "Display Name <addr@host>" or bare "addr@host".
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw)
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() }
  }
  return { name: '', email: raw.trim() }
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function decodeGmailSnippet(snippet?: string | null): string {
  if (!snippet) return ''
  return snippet
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function setGmailRead(accountId: string, externalId: string, read: boolean): Promise<void> {
  const gmail = buildGmailClient(accountId)
  await gmail.users.messages.modify({
    userId: 'me',
    id: externalId,
    requestBody: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }
  })
}

export async function archiveGmailMessage(accountId: string, externalId: string): Promise<void> {
  const gmail = buildGmailClient(accountId)
  await gmail.users.messages.modify({
    userId: 'me',
    id: externalId,
    requestBody: { removeLabelIds: ['INBOX'] }
  })
}

export async function trashGmailMessage(accountId: string, externalId: string): Promise<void> {
  const gmail = buildGmailClient(accountId)
  await gmail.users.messages.trash({ userId: 'me', id: externalId })
}

// ── Send / reply / forward ──────────────────────────────────────────────────

export async function sendGmail(input: MailSendInput): Promise<MailSendResult> {
  const account = getMailAccount(input.accountId)
  if (!account) {
    throw new Error('Mail account not found')
  }

  let threadId: string | undefined
  let inReplyTo = ''
  let references = ''
  let subject = input.subject.trim()

  if (input.inReplyToId) {
    const original = getMessageDetail(input.inReplyToId)
    if (original && original.accountId === input.accountId) {
      threadId = original.threadId ?? undefined
      inReplyTo = original.messageIdHeader
      references = [original.referencesHeader, original.messageIdHeader].filter(Boolean).join(' ')
    }
  }

  if (!subject) subject = '(no subject)'

  const lines = [
    `From: ${account.email}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
    `Subject: ${encodeHeaderWord(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.body, 'utf8').toString('base64')
  ]
  const raw = Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const gmail = buildGmailClient(input.accountId)
  const sent = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, ...(threadId ? { threadId } : {}) }
  })

  return { ok: true, messageId: sent.data.id ?? '' }
}

/** RFC 2047 encoded-word for non-ASCII header values (subjects). ASCII passes through. */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value
  }
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Retry transient Gmail failures (rate limits + 5xx) with exponential backoff + jitter. */
async function gmailRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let delay = 500
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      const status = httpStatus(error)
      const transient = status === 429 || status === 403 || (status !== undefined && status >= 500)
      if (!transient || attempt >= attempts - 1) throw error
      await sleep(delay + Math.floor(Math.random() * 250))
      delay *= 2
    }
  }
}

function httpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: number; status?: number; response?: { status?: number } }
    const value = candidate.response?.status ?? candidate.status ?? candidate.code
    if (typeof value === 'number') return value
  }
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      await tasks[index]()
    }
  })
  await Promise.all(workers)
}

/** Log-safe error code (never the payload) per SPEC §3.1. */
function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const status = (error as { code?: number; response?: { status?: number } }).response?.status
    if (status) return `Gmail sync failed: ${status}`
  }
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 160)
  }
  return 'Gmail sync failed'
}
