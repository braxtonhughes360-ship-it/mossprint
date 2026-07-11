import type { SqliteDatabase } from './sqlite'

/**
 * Boards-era tables (beta.5 B1–B6, superseded by the document rebuild). The
 * board UI, IPC, and forward migration are gone — these tables are kept, and
 * still created on new profiles, purely so (a) migrated data stays readable
 * for rollback and (b) the notes queries that exclude board-image backing
 * notes never hit a missing table. Rows are read, never written.
 */
export function ensureNoteBoardsTables(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS note_boards (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      parent_board_id TEXT REFERENCES note_boards(id) ON DELETE CASCADE,
      viewport_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_note_boards_parent ON note_boards(parent_board_id);

    CREATE TABLE IF NOT EXISTS board_items (
      id TEXT PRIMARY KEY NOT NULL,
      board_id TEXT NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      w REAL NOT NULL DEFAULT 0,
      h REAL NOT NULL DEFAULT 0,
      z_index INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
      attachment_id TEXT REFERENCES note_attachments(id) ON DELETE CASCADE,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id, z_index);
    CREATE INDEX IF NOT EXISTS idx_board_items_note ON board_items(note_id);
  `)
}
