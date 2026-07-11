import type { SqliteDatabase } from './sqlite'

/**
 * Note image attachments (beta.5 QA-12a). Rows live in the profile DB; the image
 * bytes live as files under `<profile dir>/attachments/<noteId>/<id>.<ext>` so the
 * SQLCipher database stays small. Profile delete wipes the whole profile directory,
 * which removes the files with it; note delete GCs them explicitly
 * (src/main/notesAttachments.ts).
 */
function ensureColumn(
  database: SqliteDatabase,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((col) => col.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function ensureNoteAttachmentsTable(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS note_attachments (
      id TEXT PRIMARY KEY NOT NULL,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id, created_at);
  `)

  ensureColumn(
    database,
    'note_attachments',
    'presentation_style',
    "TEXT NOT NULL DEFAULT '{\"shape\":\"rounded\",\"size\":\"full\"}'"
  )

  // Sketch attachments (beta.5 QA-12c): the PNG on disk is the display copy; the
  // stroke JSON here is the editable source, so re-opening a sketch is lossless.
  // NULL for ordinary image attachments.
  ensureColumn(database, 'note_attachments', 'sketch_strokes', 'TEXT')
}
