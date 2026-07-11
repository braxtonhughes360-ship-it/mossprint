import Database from './sqlite'
import type { SqliteDatabase } from './sqlite'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'path'
import type { DatabaseHealthResult, DatabasePingResult, SettingRecord } from '@shared/types'
import {
  applySqlCipherKey,
  encryptPlainDatabaseFile,
  isPlaintextSqliteFile,
  openEncryptedDatabase,
  tryOpenEncryptedDatabase
} from './dbEncryption'
import { BILL_ENVELOPE_NAME_PATTERN } from '@shared/moneyEnvelope'
import { ensureCalendarPushColumns } from './calendarGooglePush'
import { ensureMailDraftsTable } from './mailDraftsSchema'
import { ensureNoteAttachmentsTable } from './notesAttachmentsSchema'
import { ensureNoteBoardsTables } from './noteBoardsSchema'
import { ensureNotesRebuildMigration } from './notesRebuild'

const HEALTH_CHECK_KEY = 'step1_health_check'

let db: SqliteDatabase | null = null
let databasePath: string | null = null

function defaultLegacyDatabasePath(): string {
  return join(app.getPath('userData'), 'moss.sqlite')
}

export function getDatabasePath(): string {
  return databasePath ?? defaultLegacyDatabasePath()
}

export function openDatabaseAt(path: string, encryptionKey?: Buffer): void {
  if (db) {
    db.close()
    db = null
  }

  databasePath = path

  if (encryptionKey) {
    if (isPlaintextSqliteFile(path)) {
      encryptPlainDatabaseFile(path, encryptionKey)
    }
    db = openEncryptedDatabase(path, encryptionKey)
  } else {
    db = new Database(path)
  }

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
}

/** Open with a candidate key; returns false when the key does not match an encrypted DB. */
export function tryOpenDatabaseAt(path: string, encryptionKey: Buffer): boolean {
  if (db) {
    db.close()
    db = null
  }

  if (isPlaintextSqliteFile(path)) {
    return false
  }

  const opened = tryOpenEncryptedDatabase(path, encryptionKey)
  if (!opened) {
    return false
  }

  databasePath = path
  db = opened
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return true
}

export function rekeyDatabaseAt(path: string, oldKey: Buffer, newKey: Buffer): void {
  const database = openEncryptedDatabase(path, oldKey)
  try {
    database.pragma(`rekey="x'${newKey.toString('hex')}'"`)
  } finally {
    database.close()
  }
}

export function getDb(): SqliteDatabase {
  if (!db) {
    throw new Error('No profile database open')
  }

  return db
}

function migrate(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budget_paychecks (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budget_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budget_assignments (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      period_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(category_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      amount_cents INTEGER NOT NULL,
      category_id TEXT REFERENCES budget_categories(id) ON DELETE SET NULL,
      memo TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_paychecks_received_at ON budget_paychecks(received_at);
    CREATE INDEX IF NOT EXISTS idx_assignments_period ON budget_assignments(period_key);
    CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON ledger_transactions(occurred_at);

    CREATE TABLE IF NOT EXISTS investment_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      account_type TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investment_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
      value_cents INTEGER NOT NULL,
      as_of TEXT NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_investment_snapshots_account ON investment_snapshots(account_id, as_of DESC);

    CREATE TABLE IF NOT EXISTS budget_category_groups (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      last_used_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investment_holdings (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      cost_basis_cents INTEGER NOT NULL DEFAULT 0,
      manual_price_cents INTEGER,
      quote_price_cents INTEGER,
      quote_fetched_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_holdings_account ON investment_holdings(account_id);

    CREATE TABLE IF NOT EXISTS investment_activities (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      symbol TEXT,
      quantity REAL,
      amount_cents INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_investment_activities_account ON investment_activities(account_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_investment_activities_type ON investment_activities(type, occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_payees_last_used ON payees(last_used_at DESC);

    CREATE TABLE IF NOT EXISTS cash_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'checking',
      starting_balance_cents INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_transaction_splits (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES budget_categories(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_txn_splits_txn ON ledger_transaction_splits(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_txn_splits_category ON ledger_transaction_splits(category_id);

    CREATE TABLE IF NOT EXISTS ledger_transaction_audit (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_txn_audit_txn ON ledger_transaction_audit(transaction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_txn_audit_recent ON ledger_transaction_audit(created_at DESC);

    CREATE TABLE IF NOT EXISTS budget_schedules (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL DEFAULT 'bill',
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category_id TEXT REFERENCES budget_categories(id) ON DELETE SET NULL,
      account_id TEXT REFERENCES cash_accounts(id) ON DELETE SET NULL,
      cadence TEXT NOT NULL DEFAULT 'monthly',
      next_date TEXT NOT NULL,
      last_posted_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_budget_schedules_next ON budget_schedules(next_date);

    CREATE TABLE IF NOT EXISTS budget_rules (
      id TEXT PRIMARY KEY NOT NULL,
      match_field TEXT NOT NULL DEFAULT 'payee',
      match_type TEXT NOT NULL DEFAULT 'contains',
      match_value TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_budget_rules_sort ON budget_rules(sort_order);

    CREATE TABLE IF NOT EXISTS budget_expected_paychecks (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      expected_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_budget_expected_paychecks_date ON budget_expected_paychecks(expected_date);

    CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      target_date TEXT,
      category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'custom',
      milestones_cents TEXT NOT NULL DEFAULT '[]',
      rollover_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_savings_goals_category ON savings_goals(category_id);

    CREATE TABLE IF NOT EXISTS savings_contributions (
      id TEXT PRIMARY KEY NOT NULL,
      goal_id TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_savings_contributions_goal ON savings_contributions(goal_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS report_presets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      view_mode TEXT NOT NULL DEFAULT 'chart',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_report_presets_created ON report_presets(created_at DESC);

    CREATE TABLE IF NOT EXISTS nutrition_goals (
      id TEXT PRIMARY KEY NOT NULL,
      calorie_target INTEGER NOT NULL,
      protein_g REAL NOT NULL,
      carbs_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      fiber_g REAL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS food_items (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      barcode TEXT,
      kcal_per_100g REAL NOT NULL DEFAULT 0,
      protein_per_100g REAL NOT NULL DEFAULT 0,
      carbs_per_100g REAL NOT NULL DEFAULT 0,
      fat_per_100g REAL NOT NULL DEFAULT 0,
      fiber_per_100g REAL,
      cached_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS food_servings (
      id TEXT PRIMARY KEY NOT NULL,
      food_item_id TEXT NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      gram_weight REAL NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS food_entries (
      id TEXT PRIMARY KEY NOT NULL,
      date_key TEXT NOT NULL,
      meal_slot TEXT NOT NULL,
      food_item_id TEXT REFERENCES food_items(id) ON DELETE SET NULL,
      quantity REAL NOT NULL DEFAULT 1,
      serving_id TEXT REFERENCES food_servings(id) ON DELETE SET NULL,
      grams REAL NOT NULL DEFAULT 0,
      snapshot_kcal REAL NOT NULL DEFAULT 0,
      snapshot_protein_g REAL NOT NULL DEFAULT 0,
      snapshot_carbs_g REAL NOT NULL DEFAULT 0,
      snapshot_fat_g REAL NOT NULL DEFAULT 0,
      label TEXT NOT NULL,
      logged_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_nutrition_totals (
      date_key TEXT PRIMARY KEY NOT NULL,
      consumed_kcal REAL NOT NULL DEFAULT 0,
      consumed_protein_g REAL NOT NULL DEFAULT 0,
      consumed_carbs_g REAL NOT NULL DEFAULT 0,
      consumed_fat_g REAL NOT NULL DEFAULT 0,
      entry_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_food_entries_date ON food_entries(date_key);
    CREATE INDEX IF NOT EXISTS idx_food_entries_meal ON food_entries(date_key, meal_slot);
    CREATE INDEX IF NOT EXISTS idx_food_items_name ON food_items(name);

    CREATE TABLE IF NOT EXISTS food_favorites (
      food_item_id TEXT PRIMARY KEY NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      sync_token TEXT,
      last_sync_at TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT REFERENCES calendar_sources(id) ON DELETE SET NULL,
      external_id TEXT,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'local',
      location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'general',
      course_id TEXT,
      recurrence_rule TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(start_at, end_at);

    CREATE TABLE IF NOT EXISTS news_sources (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      trust INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      etag TEXT,
      last_modified TEXT,
      last_fetched_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL REFERENCES news_sources(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_items_unread ON news_items(read_at, published_at DESC);

    CREATE TABLE IF NOT EXISTS mail_accounts (
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

    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      thread_id TEXT,
      folder TEXT NOT NULL DEFAULT 'inbox',
      from_name TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL DEFAULT '',
      to_emails TEXT NOT NULL DEFAULT '',
      cc_emails TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      message_id_header TEXT NOT NULL DEFAULT '',
      references_header TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      read_at TEXT,
      flags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mail_messages_account ON mail_messages(account_id, folder, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_messages_unread ON mail_messages(read_at, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id);

    CREATE TABLE IF NOT EXISTS note_folders (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY NOT NULL,
      folder_id TEXT NOT NULL REFERENCES note_folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_checklist_mode INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS note_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_note_tasks_note ON note_tasks(note_id, sort_order);

    CREATE TABLE IF NOT EXISTS goal_habits (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      weekdays TEXT NOT NULL DEFAULT '[]',
      time_hint TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS goal_completions (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL REFERENCES goal_habits(id) ON DELETE CASCADE,
      date_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      updated_at TEXT NOT NULL,
      UNIQUE(habit_id, date_key)
    );

    CREATE INDEX IF NOT EXISTS idx_goal_completions_week ON goal_completions(date_key);
  `)

  ensureNotesFts(database)

  ensureCalendarPushColumns(database)
  ensureMailDraftsTable(database)
  ensureNoteAttachmentsTable(database)
  ensureNoteBoardsTables(database)
  // B2: soft-delete tombstone for board items on profiles created before B2.
  ensureColumn(database, 'board_items', 'deleted_at', 'TEXT')
  // R1 document model: ordered block document + draw-anywhere ink per note.
  ensureColumn(database, 'notes', 'body_json', 'TEXT')
  ensureColumn(database, 'notes', 'ink_json', 'TEXT')
  // R1: one-shot boards→notes reverse migration (marker-guarded, non-destructive).
  ensureNotesRebuildMigration(database)

  ensureColumn(database, 'budget_categories', 'group_id', 'TEXT')
  ensureColumn(database, 'budget_categories', 'target_cents', 'INTEGER')
  const addedSpendPolicy = ensureColumn(
    database,
    'budget_categories',
    'counts_toward_safe_to_spend',
    'INTEGER NOT NULL DEFAULT 1'
  )
  if (addedSpendPolicy) {
    backfillCategorySpendPolicy(database)
  }
  // Rollover is opt-in: off by default, so unspent money returns to "to assign" each
  // period. Savings goals must keep accumulating, so flip them on when the column is
  // first added — otherwise an existing goal's saved balance would dump into the pool.
  const addedRollover = ensureColumn(
    database,
    'budget_categories',
    'rollover_enabled',
    'INTEGER NOT NULL DEFAULT 0'
  )
  if (addedRollover) {
    database
      .prepare(
        `UPDATE budget_categories SET rollover_enabled = 1
         WHERE id IN (SELECT category_id FROM savings_goals WHERE category_id IS NOT NULL)`
      )
      .run()
  }
  ensureColumn(database, 'budget_categories', 'rollover_released_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(database, 'ledger_transactions', 'payee_id', 'TEXT')
  ensureColumn(database, 'ledger_transactions', 'account_id', 'TEXT')
  const addedType = ensureColumn(
    database,
    'ledger_transactions',
    'type',
    "TEXT NOT NULL DEFAULT 'expense'"
  )
  if (addedType) {
    // Existing rows all default to 'expense'; positive amounts were income.
    database.exec(
      "UPDATE ledger_transactions SET type = 'income' WHERE amount_cents > 0"
    )
  }
  ensureColumn(database, 'ledger_transactions', 'status', "TEXT NOT NULL DEFAULT 'cleared'")
  ensureColumn(database, 'ledger_transactions', 'notes', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, 'ledger_transactions', 'tags', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, 'ledger_transactions', 'transfer_account_id', 'TEXT')
  ensureColumn(database, 'ledger_transactions', 'transfer_group_id', 'TEXT')
  ensureColumn(database, 'ledger_transactions', 'updated_at', 'TEXT')
  ensureColumn(database, 'budget_paychecks', 'account_id', 'TEXT')
  ensureColumn(database, 'news_items', 'image_url', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, 'mail_accounts', 'auth_type', "TEXT NOT NULL DEFAULT 'oauth'")
  ensureColumn(database, 'mail_accounts', 'imap_config', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, 'investment_holdings', 'allocation_tag', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, 'investment_holdings', 'quote_day_change_percent', 'REAL')
}

/** Adds the column when missing; returns true when it was just created. */
function backfillCategorySpendPolicy(database: SqliteDatabase): void {
  const rows = database.prepare('SELECT id, name FROM budget_categories').all() as Array<{
    id: string
    name: string
  }>
  const markBill = database.prepare(
    'UPDATE budget_categories SET counts_toward_safe_to_spend = 0 WHERE id = ?'
  )
  for (const row of rows) {
    if (BILL_ENVELOPE_NAME_PATTERN.test(row.name)) {
      markBill.run(row.id)
    }
  }
  database.exec(
    `UPDATE budget_categories SET counts_toward_safe_to_spend = 0
     WHERE id IN (SELECT category_id FROM savings_goals WHERE category_id IS NOT NULL)`
  )
}

function ensureNotesFts(database: SqliteDatabase): void {
  const exists = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes_fts'"
    )
    .get()

  if (!exists) {
    database.exec(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        body,
        content='notes',
        content_rowid='rowid',
        tokenize='unicode61'
      );

      CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
      END;

      CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
    `)

    database.exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`)
  }
}

function ensureColumn(
  database: SqliteDatabase,
  table: string,
  column: string,
  definition: string
): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((col) => col.name === column)) {
    return false
  }
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

function rowToSetting(row: { key: string; value: string; updated_at: string }): SettingRecord {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at
  }
}

export function getSetting(key: string): SettingRecord | null {
  const row = getDb()
    .prepare('SELECT key, value, updated_at FROM settings WHERE key = ?')
    .get(key) as { key: string; value: string; updated_at: string } | undefined

  return row ? rowToSetting(row) : null
}

export function setSetting(key: string, value: string): SettingRecord {
  const updatedAt = new Date().toISOString()

  getDb()
    .prepare(
      `
      INSERT INTO settings (key, value, updated_at)
      VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
    )
    .run({ key, value, updatedAt })

  const saved = getSetting(key)
  if (!saved) {
    throw new Error(`Failed to persist setting: ${key}`)
  }

  return saved
}

function verifyMoneyTables(database: SqliteDatabase): boolean {
  const now = new Date().toISOString()
  const periodKey = now.slice(0, 7)
  const categoryId = randomUUID()
  const paycheckId = randomUUID()
  const assignmentId = randomUUID()
  const transactionId = randomUUID()
  const auditId = randomUUID()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO budget_categories (id, name, sort_order, created_at)
         VALUES (@id, @name, @sortOrder, @createdAt)`
      )
      .run({ id: categoryId, name: 'Health check', sortOrder: 9999, createdAt: now })

    database
      .prepare(
        `INSERT INTO budget_paychecks (id, label, amount_cents, received_at, created_at)
         VALUES (@id, @label, @amountCents, @receivedAt, @createdAt)`
      )
      .run({
        id: paycheckId,
        label: 'Health check',
        amountCents: 12_345,
        receivedAt: now,
        createdAt: now
      })

    database
      .prepare(
        `INSERT INTO budget_assignments (id, category_id, amount_cents, period_key, created_at)
         VALUES (@id, @categoryId, @amountCents, @periodKey, @createdAt)`
      )
      .run({
        id: assignmentId,
        categoryId,
        amountCents: 5000,
        periodKey,
        createdAt: now
      })

    database
      .prepare(
        `INSERT INTO ledger_transactions
           (id, amount_cents, type, status, category_id, memo, notes, tags, occurred_at, updated_at, created_at)
         VALUES
           (@id, @amountCents, 'expense', 'reconciled', @categoryId, @memo, @notes, @tags, @occurredAt, @updatedAt, @createdAt)`
      )
      .run({
        id: transactionId,
        amountCents: -2500,
        categoryId,
        memo: 'Health check',
        notes: 'Health check note',
        tags: '["health-check"]',
        occurredAt: now,
        updatedAt: now,
        createdAt: now
      })

    database
      .prepare(
        `INSERT INTO ledger_transaction_audit (id, transaction_id, action, summary, snapshot_json, created_at)
         VALUES (@id, @transactionId, 'created', 'Health check', '{}', @createdAt)`
      )
      .run({ id: auditId, transactionId, createdAt: now })

    const paycheck = database
      .prepare('SELECT amount_cents FROM budget_paychecks WHERE id = ?')
      .get(paycheckId) as { amount_cents: number } | undefined
    const assignment = database
      .prepare('SELECT amount_cents FROM budget_assignments WHERE id = ?')
      .get(assignmentId) as { amount_cents: number } | undefined
    const transaction = database
      .prepare('SELECT amount_cents, type, status, tags FROM ledger_transactions WHERE id = ?')
      .get(transactionId) as
      | { amount_cents: number; type: string; status: string; tags: string }
      | undefined
    const audit = database
      .prepare('SELECT action FROM ledger_transaction_audit WHERE id = ?')
      .get(auditId) as { action: string } | undefined

    if (paycheck?.amount_cents !== 12_345) throw new Error('paycheck round-trip failed')
    if (assignment?.amount_cents !== 5000) throw new Error('assignment round-trip failed')
    if (transaction?.amount_cents !== -2500) throw new Error('transaction round-trip failed')
    if (transaction?.type !== 'expense' || transaction?.status !== 'reconciled') {
      throw new Error('transaction type/status round-trip failed')
    }
    if (transaction?.tags !== '["health-check"]') throw new Error('transaction tags round-trip failed')
    if (audit?.action !== 'created') throw new Error('ledger audit round-trip failed')

    database.prepare('DELETE FROM ledger_transaction_audit WHERE id = ?').run(auditId)
    database.prepare('DELETE FROM ledger_transactions WHERE id = ?').run(transactionId)
    database.prepare('DELETE FROM budget_assignments WHERE id = ?').run(assignmentId)
    database.prepare('DELETE FROM budget_paychecks WHERE id = ?').run(paycheckId)
    database.prepare('DELETE FROM budget_categories WHERE id = ?').run(categoryId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyNutritionTables(database: SqliteDatabase): boolean {
  const now = new Date().toISOString()
  const dateKey = '2099-01-01'
  const entryId = randomUUID()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO nutrition_goals (id, calorie_target, protein_g, carbs_g, fat_g, fiber_g, updated_at)
         VALUES ('health-check', 2100, 140, 190, 70, NULL, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run({ updatedAt: now })

    database
      .prepare(
        `INSERT INTO food_entries (
           id, date_key, meal_slot, food_item_id, quantity, serving_id, grams,
           snapshot_kcal, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g,
           label, logged_at, created_at
         ) VALUES (
           @id, @dateKey, 'breakfast', NULL, 1, NULL, 0,
           350, 0, 0, 0, 'Health check', @loggedAt, @createdAt
         )`
      )
      .run({ id: entryId, dateKey, loggedAt: now, createdAt: now })

    const sums = database
      .prepare(
        `SELECT COALESCE(SUM(snapshot_kcal), 0) AS kcal, COUNT(*) AS count
         FROM food_entries WHERE date_key = ?`
      )
      .get(dateKey) as { kcal: number; count: number }

    if (sums.kcal !== 350 || sums.count !== 1) {
      throw new Error('nutrition entry aggregate failed')
    }

    database
      .prepare(
        `INSERT INTO daily_nutrition_totals (
           date_key, consumed_kcal, consumed_protein_g, consumed_carbs_g,
           consumed_fat_g, entry_count, updated_at
         ) VALUES (@dateKey, @kcal, 0, 0, 0, @count, @updatedAt)
         ON CONFLICT(date_key) DO UPDATE SET
           consumed_kcal = excluded.consumed_kcal,
           entry_count = excluded.entry_count,
           updated_at = excluded.updated_at`
      )
      .run({ dateKey, kcal: sums.kcal, count: sums.count, updatedAt: now })

    const totals = database
      .prepare('SELECT consumed_kcal, entry_count FROM daily_nutrition_totals WHERE date_key = ?')
      .get(dateKey) as { consumed_kcal: number; entry_count: number } | undefined

    if (totals?.consumed_kcal !== 350 || totals?.entry_count !== 1) {
      throw new Error('nutrition daily totals recompute failed')
    }

    const entry = database
      .prepare('SELECT snapshot_kcal FROM food_entries WHERE id = ?')
      .get(entryId) as { snapshot_kcal: number } | undefined

    if (entry?.snapshot_kcal !== 350) {
      throw new Error('nutrition entry round-trip failed')
    }

    database.prepare('DELETE FROM food_entries WHERE id = ?').run(entryId)
    database.prepare('DELETE FROM daily_nutrition_totals WHERE date_key = ?').run(dateKey)
    database.prepare("DELETE FROM nutrition_goals WHERE id = 'health-check'").run()
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyCalendarTables(database: SqliteDatabase): boolean {
  const id = randomUUID()
  const now = new Date().toISOString()
  const end = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO calendar_events (
          id, source_id, external_id, title, start_at, end_at, timezone,
          location, notes, kind, course_id, recurrence_rule, deleted_at,
          created_at, updated_at
        ) VALUES (
          @id, NULL, NULL, @title, @startAt, @endAt, 'local',
          '', '', 'general', NULL, NULL, NULL, @now, @now
        )`
      )
      .run({ id, title: 'Health check', startAt: now, endAt: end, now })

    const row = database
      .prepare('SELECT title FROM calendar_events WHERE id = ?')
      .get(id) as { title: string } | undefined

    if (row?.title !== 'Health check') {
      throw new Error('calendar event round-trip failed')
    }

    database.prepare('DELETE FROM calendar_events WHERE id = ?').run(id)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyNewsTables(database: SqliteDatabase): boolean {
  const sourceId = randomUUID()
  const itemId = randomUUID()
  const now = new Date().toISOString()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO news_sources (id, url, title, category, trust, priority, enabled, created_at)
         VALUES (@id, @url, 'Health check feed', '', 1, 0, 1, @now)`
      )
      .run({ id: sourceId, url: `https://example.com/feed/${sourceId}`, now })

    database
      .prepare(
        `INSERT INTO news_items (
           id, source_id, external_id, title, url, summary, published_at, read_at, created_at
         ) VALUES (
           @itemId, @sourceId, @externalId, 'Health check headline', 'https://example.com/a',
           '', @now, NULL, @now
         )`
      )
      .run({ itemId, sourceId, externalId: `hc-${itemId}`, now })

    const row = database
      .prepare('SELECT title FROM news_items WHERE id = ?')
      .get(itemId) as { title: string } | undefined

    if (row?.title !== 'Health check headline') {
      throw new Error('news item round-trip failed')
    }

    database.prepare('DELETE FROM news_items WHERE id = ?').run(itemId)
    database.prepare('DELETE FROM news_sources WHERE id = ?').run(sourceId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyNotesTables(database: SqliteDatabase): boolean {
  const folderId = randomUUID()
  const noteId = randomUUID()
  const taskId = randomUUID()
  const attachmentId = randomUUID()
  const now = new Date().toISOString()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO note_folders (id, name, sort_order, created_at)
         VALUES (@id, 'Health check', 0, @now)`
      )
      .run({ id: folderId, now })

    database
      .prepare(
        `INSERT INTO notes (
           id, folder_id, title, body, body_json, ink_json, is_pinned, is_checklist_mode, tags,
           created_at, updated_at
         ) VALUES (
           @id, @folderId, 'Health check note', 'Body text',
           '[{"id":"hc-block","type":"text","text":"Body text"}]',
           '{"version":1,"width":800,"strokes":[]}',
           1, 1, '["maintenance"]', @now, @now
         )`
      )
      .run({ id: noteId, folderId, now })

    database
      .prepare(
        `INSERT INTO note_tasks (id, note_id, label, is_done, sort_order, created_at)
         VALUES (@id, @noteId, 'Check filter', 0, 0, @now)`
      )
      .run({ id: taskId, noteId, now })

    const note = database
      .prepare('SELECT title, tags, body_json, ink_json FROM notes WHERE id = ?')
      .get(noteId) as
      | { title: string; tags: string; body_json: string; ink_json: string }
      | undefined

    if (note?.title !== 'Health check note' || note?.tags !== '["maintenance"]') {
      throw new Error('notes round-trip failed')
    }
    if (
      note?.body_json !== '[{"id":"hc-block","type":"text","text":"Body text"}]' ||
      note?.ink_json !== '{"version":1,"width":800,"strokes":[]}'
    ) {
      throw new Error('notes document round-trip failed')
    }

    const fts = database
      .prepare(
        `SELECT n.id FROM notes n
         JOIN notes_fts ON notes_fts.rowid = n.rowid
         WHERE notes_fts MATCH 'Body' AND n.id = ?`
      )
      .get(noteId) as { id: string } | undefined

    if (!fts) {
      throw new Error('notes FTS round-trip failed')
    }

    database
      .prepare(
        `INSERT INTO note_attachments (
           id, note_id, filename, mime, byte_size, created_at, presentation_style
         ) VALUES (
           @id, @noteId, 'health-check.png', 'image/png', 128, @now,
           '{"shape":"rounded","size":"full"}'
         )`
      )
      .run({ id: attachmentId, noteId, now })

    const attachment = database
      .prepare('SELECT mime, byte_size, presentation_style FROM note_attachments WHERE id = ?')
      .get(attachmentId) as
      | { mime: string; byte_size: number; presentation_style: string }
      | undefined

    if (
      attachment?.mime !== 'image/png' ||
      attachment?.byte_size !== 128 ||
      attachment?.presentation_style !== '{"shape":"rounded","size":"full"}'
    ) {
      throw new Error('note attachments round-trip failed')
    }

    database.prepare('DELETE FROM note_attachments WHERE id = ?').run(attachmentId)
    database.prepare('DELETE FROM note_tasks WHERE id = ?').run(taskId)
    database.prepare('DELETE FROM notes WHERE id = ?').run(noteId)
    database.prepare('DELETE FROM note_folders WHERE id = ?').run(folderId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyNoteBoardsTables(database: SqliteDatabase): boolean {
  const folderId = randomUUID()
  const noteId = randomUUID()
  const rootBoardId = randomUUID()
  const childBoardId = randomUUID()
  const itemId = randomUUID()
  const now = new Date().toISOString()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO note_folders (id, name, sort_order, created_at)
         VALUES (@id, 'Board health check', 9999, @now)`
      )
      .run({ id: folderId, now })

    database
      .prepare(
        `INSERT INTO notes (
           id, folder_id, title, body, is_pinned, is_checklist_mode, tags, created_at, updated_at
         ) VALUES (@id, @folderId, 'Board health check note', '', 0, 0, '[]', @now, @now)`
      )
      .run({ id: noteId, folderId, now })

    database
      .prepare(
        `INSERT INTO note_boards (id, name, parent_board_id, created_at, updated_at)
         VALUES (@id, 'Board health check', NULL, @now, @now)`
      )
      .run({ id: rootBoardId, now })

    database
      .prepare(
        `INSERT INTO note_boards (id, name, parent_board_id, viewport_json, created_at, updated_at)
         VALUES (@id, 'Nested board', @parentId, '{"x":12,"y":-8,"zoom":1.5}', @now, @now)`
      )
      .run({ id: childBoardId, parentId: rootBoardId, now })

    database
      .prepare(
        `INSERT INTO board_items (
           id, board_id, kind, x, y, w, h, z_index, payload_json, note_id, attachment_id,
           created_at, updated_at
         ) VALUES (@id, @boardId, 'card', 64, 96, 280, 180, 3, '{}', @noteId, NULL, @now, @now)`
      )
      .run({ id: itemId, boardId: childBoardId, noteId, now })

    const board = database
      .prepare('SELECT parent_board_id, viewport_json FROM note_boards WHERE id = ?')
      .get(childBoardId) as { parent_board_id: string; viewport_json: string } | undefined

    if (
      board?.parent_board_id !== rootBoardId ||
      board?.viewport_json !== '{"x":12,"y":-8,"zoom":1.5}'
    ) {
      throw new Error('note board round-trip failed')
    }

    const item = database
      .prepare('SELECT kind, x, y, w, h, z_index, note_id FROM board_items WHERE id = ?')
      .get(itemId) as
      | { kind: string; x: number; y: number; w: number; h: number; z_index: number; note_id: string }
      | undefined

    if (
      item?.kind !== 'card' ||
      item?.x !== 64 ||
      item?.y !== 96 ||
      item?.w !== 280 ||
      item?.h !== 180 ||
      item?.z_index !== 3 ||
      item?.note_id !== noteId
    ) {
      throw new Error('board item round-trip failed')
    }

    database.prepare('DELETE FROM board_items WHERE id = ?').run(itemId)
    database.prepare('DELETE FROM note_boards WHERE id = ?').run(childBoardId)
    database.prepare('DELETE FROM note_boards WHERE id = ?').run(rootBoardId)
    database.prepare('DELETE FROM notes WHERE id = ?').run(noteId)
    database.prepare('DELETE FROM note_folders WHERE id = ?').run(folderId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyMailTables(database: SqliteDatabase): boolean {
  const accountId = randomUUID()
  const messageId = randomUUID()
  const now = new Date().toISOString()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO mail_accounts (id, provider, email, label, enabled, created_at)
         VALUES (@id, 'gmail', @email, 'Health check', 1, @now)`
      )
      .run({ id: accountId, email: `health-check-${accountId}@example.com`, now })

    database
      .prepare(
        `INSERT INTO mail_messages (
           id, account_id, external_id, thread_id, folder, from_name, from_email,
           to_emails, subject, snippet, received_at, read_at, created_at, updated_at
         ) VALUES (
           @id, @accountId, @externalId, 'thread-1', 'inbox', 'Sender', 'sender@example.com',
           'me@example.com', 'Health check subject', 'snippet', @now, NULL, @now, @now
         )`
      )
      .run({ id: messageId, accountId, externalId: `hc-${messageId}`, now })

    const row = database
      .prepare('SELECT subject FROM mail_messages WHERE id = ?')
      .get(messageId) as { subject: string } | undefined

    if (row?.subject !== 'Health check subject') {
      throw new Error('mail message round-trip failed')
    }

    database.prepare('DELETE FROM mail_messages WHERE id = ?').run(messageId)
    database.prepare('DELETE FROM mail_accounts WHERE id = ?').run(accountId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyMailDraftsTables(database: SqliteDatabase): boolean {
  const accountId = randomUUID()
  const draftId = randomUUID()
  const now = new Date().toISOString()

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO mail_accounts (id, provider, email, label, enabled, created_at)
         VALUES (@id, 'gmail', @email, 'Draft check', 1, @now)`
      )
      .run({ id: accountId, email: `draft-check-${accountId}@example.com`, now })

    database
      .prepare(
        `INSERT INTO mail_drafts (
           id, account_id, to_emails, cc_emails, subject, body,
           compose_mode, in_reply_to_message_id, created_at, updated_at
         ) VALUES (
           @id, @accountId, 'friend@example.com', '', 'Draft subject', 'Draft body',
           'new', NULL, @now, @now
         )`
      )
      .run({ id: draftId, accountId, now })

    const row = database
      .prepare('SELECT subject FROM mail_drafts WHERE id = ?')
      .get(draftId) as { subject: string } | undefined

    if (row?.subject !== 'Draft subject') {
      throw new Error('mail draft round-trip failed')
    }

    database.prepare('DELETE FROM mail_drafts WHERE id = ?').run(draftId)
    database.prepare('DELETE FROM mail_accounts WHERE id = ?').run(accountId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

function verifyGoalsTables(database: SqliteDatabase): boolean {
  const habitId = randomUUID()
  const completionId = randomUUID()
  const now = new Date().toISOString()
  const dateKey = now.slice(0, 10)

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO goal_habits (id, title, weekdays, time_hint, created_at, archived_at)
         VALUES (@id, 'Health check habit', '[1,3,5]', NULL, @now, NULL)`
      )
      .run({ id: habitId, now })

    database
      .prepare(
        `INSERT INTO goal_completions (id, habit_id, date_key, status, updated_at)
         VALUES (@id, @habitId, @dateKey, 'completed', @now)`
      )
      .run({ id: completionId, habitId, dateKey, now })

    const row = database
      .prepare('SELECT title FROM goal_habits WHERE id = ?')
      .get(habitId) as { title: string } | undefined

    if (row?.title !== 'Health check habit') {
      throw new Error('goals round-trip failed')
    }

    database.prepare('DELETE FROM goal_completions WHERE id = ?').run(completionId)
    database.prepare('DELETE FROM goal_habits WHERE id = ?').run(habitId)
  })

  try {
    run()
    return true
  } catch {
    return false
  }
}

export function runHealthCheck(): DatabaseHealthResult {
  const databasePath = getDatabasePath()
  const wroteAt = new Date().toISOString()
  const token = `moss-step1-${wroteAt}`

  setSetting(HEALTH_CHECK_KEY, token)
  const readBack = getSetting(HEALTH_CHECK_KEY)
  const moneyOk = verifyMoneyTables(getDb())
  const nutritionOk = verifyNutritionTables(getDb())
  const calendarOk = verifyCalendarTables(getDb())
  const newsOk = verifyNewsTables(getDb())
  const mailOk = verifyMailTables(getDb())
  const mailDraftsOk = verifyMailDraftsTables(getDb())
  const notesOk = verifyNotesTables(getDb())
  const noteBoardsOk = verifyNoteBoardsTables(getDb())
  const goalsOk = verifyGoalsTables(getDb())

  const ok =
    readBack?.value === token &&
    moneyOk &&
    nutritionOk &&
    calendarOk &&
    newsOk &&
    mailOk &&
    mailDraftsOk &&
    notesOk &&
    noteBoardsOk &&
    goalsOk

  return {
    ok,
    wroteAt,
    readBack: readBack?.value ?? '',
    databasePath,
    message: ok
      ? 'SQLite settings + money + nutrition + calendar + news + mail + notes + boards + goals tables round-trip succeeded.'
      : readBack?.value !== token
        ? 'SQLite write/read cycle failed to round-trip.'
        : !moneyOk
          ? 'Money table persistence check failed.'
          : !nutritionOk
            ? 'Nutrition table persistence check failed.'
            : !calendarOk
              ? 'Calendar table persistence check failed.'
              : !newsOk
                ? 'News table persistence check failed.'
                : !mailOk
                  ? 'Mail table persistence check failed.'
                  : !mailDraftsOk
                    ? 'Mail drafts table persistence check failed.'
                    : !notesOk
                    ? 'Notes table persistence check failed.'
                    : !noteBoardsOk
                      ? 'Note boards table persistence check failed.'
                      : !goalsOk
                        ? 'Goals table persistence check failed.'
                        : 'Persistence check failed.'
  }
}

export function pingDatabase(): DatabasePingResult {
  const existing = getSetting(HEALTH_CHECK_KEY)

  return {
    ok: true,
    value: existing?.value ?? null,
    updatedAt: existing?.updatedAt ?? null,
    databasePath: getDatabasePath()
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
  databasePath = null
}
