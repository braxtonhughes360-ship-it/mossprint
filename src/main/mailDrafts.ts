import { randomUUID } from 'node:crypto'
import type { MailComposeMode, MailDraftRecord, MailDraftSummary, MailSaveDraftInput } from '@shared/mail'
import { getDb } from './database'

interface MailDraftRow {
  id: string
  account_id: string
  to_emails: string
  cc_emails: string
  subject: string
  body: string
  compose_mode: string
  in_reply_to_message_id: string | null
  created_at: string
  updated_at: string
}

const DRAFT_COLUMNS =
  'd.id, d.account_id, d.to_emails, d.cc_emails, d.subject, d.body, d.compose_mode, d.in_reply_to_message_id, d.created_at, d.updated_at'

function rowToDraft(row: MailDraftRow, accountEmail = ''): MailDraftRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountEmail,
    toEmails: row.to_emails,
    ccEmails: row.cc_emails,
    subject: row.subject,
    body: row.body,
    composeMode: (row.compose_mode as MailComposeMode) || 'new',
    inReplyToMessageId: row.in_reply_to_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function draftSnippet(body: string, subject: string, toEmails: string): string {
  const trimmedBody = body.trim()
  if (trimmedBody) {
    const firstLine = trimmedBody.split('\n').find((line) => line.trim().length > 0) ?? ''
    return firstLine.slice(0, 120)
  }
  if (subject.trim()) return subject.trim()
  if (toEmails.trim()) return `To ${toEmails.trim()}`
  return '(no subject)'
}

export function countMailDrafts(accountId?: string): number {
  if (accountId) {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM mail_drafts WHERE account_id = ?')
      .get(accountId) as { count: number }
    return row.count
  }
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM mail_drafts').get() as { count: number }
  return row.count
}

export function listMailDraftSummaries(accountId?: string): MailDraftSummary[] {
  const params: string[] = []
  const accountClause = accountId ? 'WHERE d.account_id = ?' : ''
  if (accountId) params.push(accountId)

  const rows = getDb()
    .prepare(
      `SELECT ${DRAFT_COLUMNS}, a.email AS account_email
       FROM mail_drafts d
       JOIN mail_accounts a ON a.id = d.account_id
       ${accountClause}
       ORDER BY d.updated_at DESC`
    )
    .all(...params) as Array<MailDraftRow & { account_email: string }>

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountEmail: row.account_email,
    toEmails: row.to_emails,
    subject: row.subject,
    snippet: draftSnippet(row.body, row.subject, row.to_emails),
    composeMode: (row.compose_mode as MailComposeMode) || 'new',
    inReplyToMessageId: row.in_reply_to_message_id,
    updatedAt: row.updated_at
  }))
}

export function getMailDraft(draftId: string): MailDraftRecord | null {
  const row = getDb()
    .prepare(
      `SELECT ${DRAFT_COLUMNS}, a.email AS account_email
       FROM mail_drafts d
       JOIN mail_accounts a ON a.id = d.account_id
       WHERE d.id = ?`
    )
    .get(draftId) as (MailDraftRow & { account_email: string }) | undefined
  return row ? rowToDraft(row, row.account_email) : null
}

export function saveMailDraft(input: MailSaveDraftInput): MailDraftRecord {
  const now = new Date().toISOString()
  const id = input.id?.trim() || randomUUID()
  const existing = input.id
    ? (getDb().prepare('SELECT created_at FROM mail_drafts WHERE id = ?').get(id) as
        | { created_at: string }
        | undefined)
    : undefined
  const createdAt = existing?.created_at ?? now

  getDb()
    .prepare(
      `INSERT INTO mail_drafts (
         id, account_id, to_emails, cc_emails, subject, body,
         compose_mode, in_reply_to_message_id, created_at, updated_at
       ) VALUES (
         @id, @accountId, @toEmails, @ccEmails, @subject, @body,
         @composeMode, @inReplyToMessageId, @createdAt, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         account_id = excluded.account_id,
         to_emails = excluded.to_emails,
         cc_emails = excluded.cc_emails,
         subject = excluded.subject,
         body = excluded.body,
         compose_mode = excluded.compose_mode,
         in_reply_to_message_id = excluded.in_reply_to_message_id,
         updated_at = excluded.updated_at`
    )
    .run({
      id,
      accountId: input.accountId,
      toEmails: input.toEmails,
      ccEmails: input.ccEmails ?? '',
      subject: input.subject,
      body: input.body,
      composeMode: input.composeMode ?? 'new',
      inReplyToMessageId: input.inReplyToMessageId ?? null,
      createdAt,
      updatedAt: now
    })

  const saved = getMailDraft(id)
  if (!saved) throw new Error('Failed to save draft')
  return saved
}

export function deleteMailDraft(draftId: string): { ok: true } {
  getDb().prepare('DELETE FROM mail_drafts WHERE id = ?').run(draftId)
  return { ok: true }
}
