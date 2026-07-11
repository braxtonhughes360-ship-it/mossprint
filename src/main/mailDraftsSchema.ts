import type { SqliteDatabase } from './sqlite'

/**
 * Local-only compose drafts — NEVER synced to Gmail/IMAP providers (beta.5 QA-11).
 * Stored in SQLCipher like mail_messages; wiped when the profile directory is deleted.
 */
export function ensureMailDraftsTable(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mail_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      to_emails TEXT NOT NULL DEFAULT '',
      cc_emails TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      compose_mode TEXT NOT NULL DEFAULT 'new',
      in_reply_to_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mail_drafts_account ON mail_drafts(account_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_drafts_updated ON mail_drafts(updated_at DESC);
  `)
}
