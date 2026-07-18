import { randomUUID } from 'node:crypto'
import type { SqliteDatabase } from './sqlite'
import type { NoteBlock } from '@shared/notes'
import { deriveNoteBodyText, serializeNoteBlocks, validateNoteSketchData } from '@shared/notes'

/**
 * Boards → notes reverse migration (beta.5 rebuild, R1). The B-series turned
 * Notes into a spatial board product; the operator rejected that paradigm, so
 * Notes returns to the two-noun document model (folders and notes). This
 * migration brings every piece of board-only content home to a note:
 *
 * - Cards already point at intact note rows — each live card's note is
 *   re-homed to the folder its board maps to, so the organization the user
 *   saw on boards is what the folder rail shows.
 * - Boards created in the board UI (no matching folder) become folders.
 * - Free-floating `image`/`sketch` items — the only board content with no home
 *   note — land as inline blocks in one "<board> — board items" note per
 *   board, so nothing is dropped.
 * - Every note gets a `body_json` block document derived from its plaintext
 *   body + attachment rows (the gallery becomes inline image blocks).
 *
 * `board_items`/`note_boards` rows are read, never deleted — rollback safety,
 * exactly as B1 kept the old list readable. Runs once per profile, guarded by
 * a settings marker; collector notes and created folders use deterministic ids
 * (INSERT OR IGNORE) so a re-run adds nothing even if the marker is lost.
 */

const MIGRATION_MARKER_KEY = 'notes_rebuild_migration_v1'

/** Mirrors notes.ts DEFAULT_FOLDER_ID — module-local to avoid a database↔notes import cycle. */
const DEFAULT_FOLDER_ID = 'default-notes-folder'
const DEFAULT_FOLDER_NAME = 'Notes'

const NOTES_ROOT_BOARD_ID = 'notes-root-board'
const FOLDER_BOARD_PREFIX = 'folder-board-'
const BOARD_FOLDER_PREFIX = 'board-folder-'

export function collectorNoteId(boardId: string): string {
  return `board-items-note-${boardId}`
}

function tableExists(database: SqliteDatabase, name: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name)
  )
}

function textBlock(text: string): NoteBlock {
  return { id: randomUUID(), type: 'text', text }
}

function ensureDefaultFolder(database: SqliteDatabase, now: string): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO note_folders (id, name, sort_order, created_at)
       VALUES (@id, @name, 0, @now)`
    )
    .run({ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, now })
}

/**
 * Map every board to the folder its notes should live in: folder-boards map
 * back to their folder (B1 made them 1:1), the root board to the default
 * folder, and user-created boards each get a folder named after them.
 */
function buildBoardFolderTargets(database: SqliteDatabase, now: string): Map<string, string> {
  const targets = new Map<string, string>()
  const boards = database
    .prepare('SELECT id, name FROM note_boards ORDER BY parent_board_id IS NOT NULL, name')
    .all() as Array<{ id: string; name: string }>

  const folderExists = database.prepare('SELECT 1 FROM note_folders WHERE id = ?')
  const nextSortOrder = database.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM note_folders'
  )
  const insertFolder = database.prepare(
    `INSERT OR IGNORE INTO note_folders (id, name, sort_order, created_at)
     VALUES (@id, @name, @sortOrder, @now)`
  )

  for (const board of boards) {
    if (board.id === NOTES_ROOT_BOARD_ID) {
      targets.set(board.id, DEFAULT_FOLDER_ID)
      continue
    }
    if (board.id.startsWith(FOLDER_BOARD_PREFIX)) {
      const folderId = board.id.slice(FOLDER_BOARD_PREFIX.length)
      if (folderExists.get(folderId)) {
        targets.set(board.id, folderId)
        continue
      }
    }
    const folderId = `${BOARD_FOLDER_PREFIX}${board.id}`
    insertFolder.run({
      id: folderId,
      name: board.name.trim() || 'Board',
      sortOrder: (nextSortOrder.get() as { next: number }).next,
      now
    })
    targets.set(board.id, folderId)
  }

  return targets
}

/** Re-home each live card's note to its board's folder — board placement was the user's organization. */
function rehomeCardNotes(
  database: SqliteDatabase,
  targets: Map<string, string>
): void {
  const cards = database
    .prepare(
      `SELECT bi.board_id, bi.note_id
       FROM board_items bi
       JOIN notes n ON n.id = bi.note_id
       WHERE bi.kind = 'card' AND bi.deleted_at IS NULL AND bi.note_id IS NOT NULL`
    )
    .all() as Array<{ board_id: string; note_id: string }>

  const update = database.prepare('UPDATE notes SET folder_id = @folderId WHERE id = @noteId')
  for (const card of cards) {
    const folderId = targets.get(card.board_id)
    if (folderId) {
      update.run({ folderId, noteId: card.note_id })
    }
  }
}

/**
 * Free items (images, sketch frames — including B4 draw-anywhere sessions,
 * which committed as sketch frames) collect into one note per board as inline
 * blocks. Image blocks reference the orphan's existing attachment row; sketch
 * blocks carry the frame's N3 stroke JSON. Nothing is copied or deleted.
 */
function collectOrphanItems(
  database: SqliteDatabase,
  targets: Map<string, string>,
  now: string
): void {
  const boards = database
    .prepare('SELECT id, name FROM note_boards ORDER BY parent_board_id IS NOT NULL, name')
    .all() as Array<{ id: string; name: string }>

  const listOrphans = database.prepare(
    `SELECT kind, payload_json, attachment_id
     FROM board_items
     WHERE board_id = ? AND deleted_at IS NULL AND kind IN ('image', 'sketch')
     ORDER BY z_index, created_at`
  )
  const attachmentExists = database.prepare('SELECT 1 FROM note_attachments WHERE id = ?')
  const insertNote = database.prepare(
    `INSERT OR IGNORE INTO notes (
       id, folder_id, title, body, body_json, is_pinned, is_checklist_mode, tags,
       created_at, updated_at
     ) VALUES (
       @id, @folderId, @title, @body, @bodyJson, 0, 0, '[]', @now, @now
     )`
  )

  for (const board of boards) {
    const orphans = listOrphans.all(board.id) as Array<{
      kind: string
      payload_json: string
      attachment_id: string | null
    }>
    if (orphans.length === 0) continue

    const blocks: NoteBlock[] = []
    for (const orphan of orphans) {
      if (orphan.kind === 'image') {
        if (orphan.attachment_id && attachmentExists.get(orphan.attachment_id)) {
          blocks.push({ id: randomUUID(), type: 'image', attachmentId: orphan.attachment_id })
        }
        continue
      }
      try {
        const payload = JSON.parse(orphan.payload_json) as { sketch?: unknown }
        const sketch = validateNoteSketchData(payload.sketch)
        if (sketch && sketch.strokes.length > 0) {
          blocks.push({ id: randomUUID(), type: 'sketch', sketch })
        }
      } catch {
        // Unreadable frame payload — the board row still holds it for rollback.
      }
    }
    if (blocks.length === 0) continue

    const boardName = board.name.trim() || 'Board'
    const intro = textBlock(`Images and drawings from the “${boardName}” board.`)
    const document = [intro, ...blocks]
    insertNote.run({
      id: collectorNoteId(board.id),
      folderId: targets.get(board.id) ?? DEFAULT_FOLDER_ID,
      title: `${boardName} — board items`,
      body: deriveNoteBodyText(document),
      bodyJson: serializeNoteBlocks(document),
      now
    })
  }
}

/**
 * Every note without a block document gets one: its plaintext body as a text
 * block, then an image block per attachment row in gallery order — the same
 * content, now inline in the document instead of stacked below it.
 */
function backfillBlockDocuments(database: SqliteDatabase): void {
  const notes = database
    .prepare('SELECT id, body FROM notes WHERE body_json IS NULL')
    .all() as Array<{ id: string; body: string }>
  if (notes.length === 0) return

  const listAttachments = database.prepare(
    'SELECT id FROM note_attachments WHERE note_id = ? ORDER BY created_at, id'
  )
  const update = database.prepare('UPDATE notes SET body_json = @bodyJson WHERE id = @id')

  for (const note of notes) {
    const blocks: NoteBlock[] = [textBlock(note.body)]
    const attachments = listAttachments.all(note.id) as Array<{ id: string }>
    for (const attachment of attachments) {
      blocks.push({ id: randomUUID(), type: 'image', attachmentId: attachment.id })
    }
    update.run({ id: note.id, bodyJson: serializeNoteBlocks(blocks) })
  }
}

export function ensureNotesRebuildMigration(database: SqliteDatabase): void {
  const marker = database
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(MIGRATION_MARKER_KEY) as { value: string } | undefined
  if (marker) return

  const now = new Date().toISOString()
  const run = database.transaction(() => {
    ensureDefaultFolder(database, now)

    if (tableExists(database, 'note_boards') && tableExists(database, 'board_items')) {
      const targets = buildBoardFolderTargets(database, now)
      rehomeCardNotes(database, targets)
      collectOrphanItems(database, targets, now)
    }

    backfillBlockDocuments(database)

    database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @now)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run({ key: MIGRATION_MARKER_KEY, value: now, now })
  })

  run()
}
