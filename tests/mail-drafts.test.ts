import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../src/main/sqlite'

const testDbRef = vi.hoisted(() => ({ db: null as SqliteDatabase | null }))

vi.mock('../src/main/database', () => ({
  getDb: () => {
    if (!testDbRef.db) throw new Error('test database not initialized')
    return testDbRef.db
  }
}))

import {
  countMailDrafts,
  deleteMailDraft,
  getMailDraft,
  listMailDraftSummaries,
  saveMailDraft
} from '../src/main/mailDrafts'
import { ensureMailDraftsTable } from '../src/main/mailDraftsSchema'

const LEGACY_MAIL_SCHEMA = `
  CREATE TABLE mail_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'oauth',
    email TEXT NOT NULL,
    label TEXT NOT NULL,
    imap_config TEXT NOT NULL DEFAULT '',
    sync_token TEXT,
    last_sync_at TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(provider, email)
  );
`

function seedAccount(db: SqliteDatabase, id: string, email: string): void {
  db.prepare(
    `INSERT INTO mail_accounts (id, provider, email, label, enabled, created_at)
     VALUES (?, 'gmail', ?, 'Test', 1, '2026-07-03T00:00:00.000Z')`
  ).run(id, email)
}

describe('ensureMailDraftsTable (migration)', () => {
  beforeEach(() => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('PRAGMA foreign_keys = ON')
    raw.exec(LEGACY_MAIL_SCHEMA)
    testDbRef.db = raw as unknown as SqliteDatabase
  })

  it('adds mail_drafts on a legacy profile database', () => {
    expect(
      testDbRef.db!
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mail_drafts'")
        .get()
    ).toBeUndefined()

    ensureMailDraftsTable(testDbRef.db!)
    ensureMailDraftsTable(testDbRef.db!)

    const row = testDbRef.db!
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mail_drafts'")
      .get() as { name: string }
    expect(row.name).toBe('mail_drafts')
  })
})

describe('mail draft CRUD', () => {
  const accountId = 'acct-1'

  beforeEach(() => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('PRAGMA foreign_keys = ON')
    raw.exec(LEGACY_MAIL_SCHEMA)
    testDbRef.db = raw as unknown as SqliteDatabase
    ensureMailDraftsTable(testDbRef.db!)
    seedAccount(testDbRef.db!, accountId, 'me@example.com')
  })

  it('creates, updates, lists, and deletes a draft', () => {
    const created = saveMailDraft({
      accountId,
      toEmails: 'friend@example.com',
      subject: 'Hello',
      body: 'Draft body',
      composeMode: 'new'
    })

    expect(created.id).toBeTruthy()
    expect(created.subject).toBe('Hello')
    expect(countMailDrafts()).toBe(1)

    const updated = saveMailDraft({
      id: created.id,
      accountId,
      toEmails: 'friend@example.com',
      ccEmails: 'cc@example.com',
      subject: 'Hello again',
      body: 'Updated body',
      composeMode: 'reply',
      inReplyToMessageId: 'msg-99'
    })

    expect(updated.subject).toBe('Hello again')
    expect(updated.composeMode).toBe('reply')
    expect(updated.inReplyToMessageId).toBe('msg-99')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime()
    )

    const listed = listMailDraftSummaries()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.snippet).toContain('Updated body')

    const fetched = getMailDraft(created.id)
    expect(fetched?.ccEmails).toBe('cc@example.com')

    deleteMailDraft(created.id)
    expect(getMailDraft(created.id)).toBeNull()
    expect(countMailDrafts()).toBe(0)
  })

  it('cascades draft delete when the account is removed', () => {
    const draft = saveMailDraft({
      accountId,
      toEmails: 'friend@example.com',
      subject: 'Cascade',
      body: 'Body',
      composeMode: 'new'
    })

    testDbRef.db!.prepare('DELETE FROM mail_accounts WHERE id = ?').run(accountId)
    expect(getMailDraft(draft.id)).toBeNull()
  })
})
