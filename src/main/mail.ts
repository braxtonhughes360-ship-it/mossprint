import { randomUUID } from 'node:crypto'
import type {
  MailAccountRecord,
  MailAuthType,
  MailDoorSnapshot,
  MailFolder,
  MailImapConfig,
  MailListOptions,
  MailMessageDetail,
  MailMessageSummary,
  MailProvider,
  MailStatus
} from '@shared/mail'
import { MAIL_LIST_DEFAULT_LIMIT, MAIL_LIST_MAX_LIMIT } from '@shared/mailSyncConstants'
import { getDb } from './database'
import { isGoogleOAuthConfigured } from './googleOAuth'

interface MailAccountRow {
  id: string
  provider: string
  auth_type: string
  email: string
  label: string
  imap_config: string
  sync_token: string | null
  last_sync_at: string | null
  stale: number
  last_error: string | null
  enabled: number
  created_at: string
}

function parseImapHost(imapConfig: string): string {
  if (!imapConfig) return ''
  try {
    return (JSON.parse(imapConfig) as MailImapConfig).imapHost ?? ''
  } catch {
    return ''
  }
}

function rowToAccount(row: MailAccountRow): MailAccountRecord {
  return {
    id: row.id,
    provider: row.provider as MailProvider,
    authType: (row.auth_type as MailAuthType) || 'oauth',
    email: row.email,
    label: row.label,
    imapHost: parseImapHost(row.imap_config),
    lastSyncAt: row.last_sync_at,
    stale: row.stale === 1,
    lastError: row.last_error,
    enabled: row.enabled === 1,
    createdAt: row.created_at
  }
}

const ACCOUNT_COLUMNS =
  'id, provider, auth_type, email, label, imap_config, sync_token, last_sync_at, stale, last_error, enabled, created_at'

export function listMailAccounts(): MailAccountRecord[] {
  const rows = getDb()
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM mail_accounts ORDER BY created_at ASC`)
    .all() as MailAccountRow[]
  return rows.map(rowToAccount)
}

export function listEnabledMailAccounts(): MailAccountRecord[] {
  return listMailAccounts().filter((account) => account.enabled)
}

export function getMailAccount(accountId: string): MailAccountRecord | null {
  const row = getDb()
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM mail_accounts WHERE id = ?`)
    .get(accountId) as MailAccountRow | undefined
  return row ? rowToAccount(row) : null
}

export function findGmailAccountByEmail(email: string): MailAccountRecord | null {
  const row = getDb()
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM mail_accounts WHERE provider = 'gmail' AND email = ?`)
    .get(email) as MailAccountRow | undefined
  return row ? rowToAccount(row) : null
}

export function createGmailAccount(email: string, label: string): string {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO mail_accounts (id, provider, email, label, enabled, created_at)
       VALUES (@id, 'gmail', @email, @label, 1, @createdAt)
       ON CONFLICT(provider, email) DO UPDATE SET label = excluded.label, enabled = 1`
    )
    .run({ id, email, label, createdAt })

  const account = findGmailAccountByEmail(email)
  return account?.id ?? id
}

export function createImapAccount(email: string, label: string, config: MailImapConfig): string {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO mail_accounts (id, provider, auth_type, email, label, imap_config, enabled, created_at)
       VALUES (@id, 'imap', 'imap', @email, @label, @config, 1, @createdAt)
       ON CONFLICT(provider, email) DO UPDATE SET
         label = excluded.label, imap_config = excluded.imap_config, enabled = 1`
    )
    .run({ id, email, label, config: JSON.stringify(config), createdAt })

  const row = getDb()
    .prepare(`SELECT id FROM mail_accounts WHERE provider = 'imap' AND email = ?`)
    .get(email) as { id: string } | undefined
  return row?.id ?? id
}

/** Provider sync cursor (Gmail historyId / IMAP marker) — internal, not exposed to the renderer. */
export function getMailSyncToken(accountId: string): string | null {
  const row = getDb()
    .prepare('SELECT sync_token FROM mail_accounts WHERE id = ?')
    .get(accountId) as { sync_token: string | null } | undefined
  return row?.sync_token ?? null
}

export function getImapConfig(accountId: string): MailImapConfig | null {
  const row = getDb()
    .prepare('SELECT imap_config FROM mail_accounts WHERE id = ?')
    .get(accountId) as { imap_config: string } | undefined
  if (!row?.imap_config) return null
  try {
    return JSON.parse(row.imap_config) as MailImapConfig
  } catch {
    return null
  }
}

export function touchAccount(
  accountId: string,
  options: { stale: boolean; error?: string | null; syncToken?: string | null }
): void {
  const lastSyncAt = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE mail_accounts
       SET last_sync_at = @lastSyncAt, stale = @stale, last_error = @error,
           sync_token = COALESCE(@syncToken, sync_token)
       WHERE id = @accountId`
    )
    .run({
      accountId,
      lastSyncAt,
      stale: options.stale ? 1 : 0,
      error: options.error ?? null,
      syncToken: options.syncToken ?? null
    })
}

export function markAccountStale(accountId: string, error: string): void {
  getDb()
    .prepare('UPDATE mail_accounts SET stale = 1, last_error = ? WHERE id = ?')
    .run(error.slice(0, 200), accountId)
}

export function deleteMailAccount(accountId: string): void {
  // mail_messages cascade on account delete.
  getDb().prepare('DELETE FROM mail_accounts WHERE id = ?').run(accountId)
}

export function setMailAccountEnabled(accountId: string, enabled: boolean): void {
  getDb()
    .prepare(
      `UPDATE mail_accounts
       SET enabled = @enabled, stale = CASE WHEN @enabled = 0 THEN 0 ELSE stale END,
           last_error = CASE WHEN @enabled = 0 THEN NULL ELSE last_error END
       WHERE id = @accountId`
    )
    .run({ accountId, enabled: enabled ? 1 : 0 })
}

export interface UpsertMessageInput {
  accountId: string
  externalId: string
  threadId: string | null
  folder: MailFolder
  fromName: string
  fromEmail: string
  toEmails: string
  ccEmails: string
  subject: string
  snippet: string
  bodyHtml: string
  bodyText: string
  messageIdHeader: string
  referencesHeader: string
  receivedAt: string
  read: boolean
  flags: string
}

export function upsertMessage(input: UpsertMessageInput): 'imported' | 'updated' {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM mail_messages WHERE account_id = ? AND external_id = ?')
    .get(input.accountId, input.externalId) as { id: string } | undefined

  const now = new Date().toISOString()

  if (existing) {
    db.prepare(
      `UPDATE mail_messages SET
         thread_id = @threadId, folder = @folder, from_name = @fromName, from_email = @fromEmail,
         to_emails = @toEmails, cc_emails = @ccEmails, subject = @subject, snippet = @snippet,
         body_html = @bodyHtml, body_text = @bodyText, message_id_header = @messageIdHeader,
         references_header = @referencesHeader, received_at = @receivedAt,
         read_at = CASE WHEN @read = 1 THEN COALESCE(read_at, @now) ELSE NULL END,
         flags = @flags, updated_at = @now
       WHERE id = @id`
    ).run({
      id: existing.id,
      threadId: input.threadId,
      folder: input.folder,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      toEmails: input.toEmails,
      ccEmails: input.ccEmails,
      subject: input.subject,
      snippet: input.snippet,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      messageIdHeader: input.messageIdHeader,
      referencesHeader: input.referencesHeader,
      receivedAt: input.receivedAt,
      read: input.read ? 1 : 0,
      flags: input.flags,
      now
    })
    return 'updated'
  }

  db.prepare(
    `INSERT INTO mail_messages (
       id, account_id, external_id, thread_id, folder, from_name, from_email,
       to_emails, cc_emails, subject, snippet, body_html, body_text,
       message_id_header, references_header, received_at, read_at, flags, created_at, updated_at
     ) VALUES (
       @id, @accountId, @externalId, @threadId, @folder, @fromName, @fromEmail,
       @toEmails, @ccEmails, @subject, @snippet, @bodyHtml, @bodyText,
       @messageIdHeader, @referencesHeader, @receivedAt, @readAt, @flags, @now, @now
     )`
  ).run({
    id: randomUUID(),
    accountId: input.accountId,
    externalId: input.externalId,
    threadId: input.threadId,
    folder: input.folder,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    toEmails: input.toEmails,
    ccEmails: input.ccEmails,
    subject: input.subject,
    snippet: input.snippet,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    messageIdHeader: input.messageIdHeader,
    referencesHeader: input.referencesHeader,
    receivedAt: input.receivedAt,
    readAt: input.read ? now : null,
    flags: input.flags,
    now
  })
  return 'imported'
}

export function listStoredExternalIds(accountId: string): Set<string> {
  const rows = getDb()
    .prepare('SELECT external_id FROM mail_messages WHERE account_id = ?')
    .all(accountId) as Array<{ external_id: string }>
  return new Set(rows.map((row) => row.external_id))
}

export function findLocalMessageId(accountId: string, externalId: string): string | null {
  const row = getDb()
    .prepare('SELECT id FROM mail_messages WHERE account_id = ? AND external_id = ?')
    .get(accountId, externalId) as { id: string } | undefined
  return row?.id ?? null
}

interface MailMessageRow {
  id: string
  account_id: string
  account_email: string
  account_label: string
  external_id: string
  thread_id: string | null
  folder: string
  from_name: string
  from_email: string
  to_emails: string
  cc_emails: string
  subject: string
  snippet: string
  received_at: string
  read_at: string | null
  flags: string
}

function rowToSummary(row: MailMessageRow): MailMessageSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    accountEmail: row.account_email,
    accountLabel: row.account_label,
    externalId: row.external_id,
    threadId: row.thread_id,
    folder: row.folder as MailFolder,
    fromName: row.from_name,
    fromEmail: row.from_email,
    toEmails: row.to_emails,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    read: row.read_at !== null,
    hasAttachments: row.flags.split(',').includes('att')
  }
}

const SUMMARY_COLUMNS = `
  m.id, m.account_id, a.email AS account_email, a.label AS account_label,
  m.external_id, m.thread_id, m.folder, m.from_name, m.from_email,
  m.to_emails, m.cc_emails, m.subject, m.snippet, m.received_at, m.read_at, m.flags
`

// Search spans sender, subject, snippet, recipients, and the full message body so a word
// buried in an email is still findable — not just what shows in the list row.
const MAIL_SEARCH_CLAUSE = `(
  LOWER(m.subject) LIKE @query OR LOWER(m.from_name) LIKE @query OR
  LOWER(m.from_email) LIKE @query OR LOWER(m.to_emails) LIKE @query OR
  LOWER(m.snippet) LIKE @query OR LOWER(m.body_text) LIKE @query
)`

export function listMessageSummaries(options: MailListOptions = {}): MailMessageSummary[] {
  const folder = options.folder ?? 'inbox'
  const limit = Math.min(Math.max(options.limit ?? MAIL_LIST_DEFAULT_LIMIT, 1), MAIL_LIST_MAX_LIMIT)

  const filters: string[] = ['m.folder = @folder', 'a.enabled = 1']
  const params: Record<string, unknown> = { folder, limit }

  if (options.accountId) {
    filters.push('m.account_id = @accountId')
    params.accountId = options.accountId
  }
  if (options.unreadOnly) {
    filters.push('m.read_at IS NULL')
  }
  if (options.query?.trim()) {
    const needle = `%${options.query.trim().toLowerCase()}%`
    filters.push(MAIL_SEARCH_CLAUSE)
    params.query = needle
  }

  const rows = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}
       FROM mail_messages m
       JOIN mail_accounts a ON a.id = m.account_id
       WHERE ${filters.join(' AND ')}
       ORDER BY m.received_at DESC
       LIMIT @limit`
    )
    .all(params) as MailMessageRow[]

  return rows.map(rowToSummary)
}

export function countMessageSummaries(options: MailListOptions = {}): number {
  const folder = options.folder ?? 'inbox'
  const filters: string[] = ['m.folder = @folder', 'a.enabled = 1']
  const params: Record<string, unknown> = { folder }

  if (options.accountId) {
    filters.push('m.account_id = @accountId')
    params.accountId = options.accountId
  }
  if (options.unreadOnly) {
    filters.push('m.read_at IS NULL')
  }
  if (options.query?.trim()) {
    const needle = `%${options.query.trim().toLowerCase()}%`
    filters.push(MAIL_SEARCH_CLAUSE)
    params.query = needle
  }

  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM mail_messages m
       JOIN mail_accounts a ON a.id = m.account_id
       WHERE ${filters.join(' AND ')}`
    )
    .get(params) as { n: number }

  return row.n
}

export function getMessageDetail(messageId: string): MailMessageDetail | null {
  const row = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, m.body_html, m.body_text, m.message_id_header, m.references_header
       FROM mail_messages m
       JOIN mail_accounts a ON a.id = m.account_id
       WHERE m.id = ?`
    )
    .get(messageId) as
    | (MailMessageRow & {
        body_html: string
        body_text: string
        message_id_header: string
        references_header: string
      })
    | undefined

  if (!row) return null
  return {
    ...rowToSummary(row),
    ccEmails: row.cc_emails,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    messageIdHeader: row.message_id_header,
    referencesHeader: row.references_header
  }
}

/** Resolve a message to its account + provider id for provider-side mutations. */
export function getMessageRef(
  messageId: string
): { id: string; accountId: string; externalId: string; folder: MailFolder } | null {
  const row = getDb()
    .prepare('SELECT id, account_id, external_id, folder FROM mail_messages WHERE id = ?')
    .get(messageId) as
    | { id: string; account_id: string; external_id: string; folder: string }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    accountId: row.account_id,
    externalId: row.external_id,
    folder: row.folder as MailFolder
  }
}

export function setMessageReadLocal(messageId: string, read: boolean): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE mail_messages
       SET read_at = CASE WHEN @read = 1 THEN COALESCE(read_at, @now) ELSE NULL END,
           updated_at = @now
       WHERE id = @id`
    )
    .run({ id: messageId, read: read ? 1 : 0, now })
}

export function setMessageFolderLocal(messageId: string, folder: MailFolder): void {
  getDb()
    .prepare('UPDATE mail_messages SET folder = ?, updated_at = ? WHERE id = ?')
    .run(folder, new Date().toISOString(), messageId)
}

export function getMailStatus(): MailStatus {
  return {
    configured: isGoogleOAuthConfigured(),
    accounts: listMailAccounts()
  }
}

export function getMailDoorSnapshot(): MailDoorSnapshot {
  const db = getDb()
  const accounts = listEnabledMailAccounts()

  const unreadRow = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM mail_messages m JOIN mail_accounts a ON a.id = m.account_id
       WHERE a.enabled = 1 AND m.folder = 'inbox' AND m.read_at IS NULL`
    )
    .get() as { n: number }

  const latest = db
    .prepare(
      `SELECT m.from_name, m.from_email, m.subject, m.received_at, m.read_at
       FROM mail_messages m JOIN mail_accounts a ON a.id = m.account_id
       WHERE a.enabled = 1 AND m.folder = 'inbox'
       ORDER BY m.received_at DESC LIMIT 1`
    )
    .get() as
    | { from_name: string; from_email: string; subject: string; received_at: string; read_at: string | null }
    | undefined

  return {
    unreadCount: unreadRow.n,
    totalAccounts: accounts.length,
    latest: latest
      ? {
          fromName: latest.from_name || latest.from_email,
          subject: latest.subject,
          receivedAt: latest.received_at,
          read: latest.read_at !== null
        }
      : null,
    hasStaleAccounts: accounts.some((account) => account.stale)
  }
}
