import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../src/main/sqlite'

/**
 * R1 document rebuild: the block model helpers and the boards→notes reverse
 * migration. Same discipline as the B1 forward-migration tests it replaces —
 * idempotent, non-destructive, nothing dropped.
 */

const testRef = vi.hoisted(() => ({
  db: null as SqliteDatabase | null
}))

vi.mock('../src/main/database', () => ({
  getDb: () => {
    if (!testRef.db) throw new Error('test database not initialized')
    return testRef.db
  },
  getDatabasePath: () => '/tmp/moss-notes-rebuild-test/moss.sqlite'
}))

import { ensureNotesRebuildMigration, collectorNoteId } from '../src/main/notesRebuild'
import { ensureNoteBoardsTables } from '../src/main/noteBoardsSchema'
import { ensureNoteAttachmentsTable } from '../src/main/notesAttachmentsSchema'
import { listNotes, updateNote } from '../src/main/notes'
import type { NoteBlock, NoteSketchData } from '../src/shared/notes'
import {
  NOTE_INK_VERSION,
  NOTE_SKETCH_VERSION,
  deriveNoteBodyText,
  parseNoteBlocks,
  serializeNoteBlocks,
  validateNoteBlocks,
  validateNoteInkData
} from '../src/shared/notes'

const BASE_SCHEMA = `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE note_folders (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL,
    folder_id TEXT NOT NULL REFERENCES note_folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    body_json TEXT,
    ink_json TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_checklist_mode INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE note_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`

const NOW = '2026-07-08T00:00:00.000Z'

const SKETCH: NoteSketchData = {
  version: NOTE_SKETCH_VERSION,
  width: 320,
  height: 240,
  strokes: [{ tool: 'pen', color: 'ink', width: 4, points: [10, 10, 0.5, 60, 60, 0.6] }]
}

function makeDb(): SqliteDatabase {
  const raw = new DatabaseSync(':memory:') as unknown as SqliteDatabase & {
    transaction?: unknown
    exec: (sql: string) => void
  }
  raw.exec('PRAGMA foreign_keys = ON')
  raw.exec(BASE_SCHEMA)
  // node:sqlite has no .transaction(); shim better-sqlite3's shape for the code under test.
  ;(raw as { transaction?: unknown }).transaction = (fn: () => void) => () => {
    raw.exec('BEGIN')
    try {
      fn()
      raw.exec('COMMIT')
    } catch (err) {
      raw.exec('ROLLBACK')
      throw err
    }
  }
  return raw as unknown as SqliteDatabase
}

function insertFolder(db: SqliteDatabase, id: string, name: string): void {
  db.prepare(
    `INSERT INTO note_folders (id, name, sort_order, created_at) VALUES (?, ?, 0, ?)`
  ).run(id, name, NOW)
}

function insertNote(db: SqliteDatabase, id: string, folderId: string, title = '', body = ''): void {
  db.prepare(
    `INSERT INTO notes (id, folder_id, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, folderId, title, body, NOW, NOW)
}

function insertBoard(db: SqliteDatabase, id: string, name: string, parent: string | null): void {
  db.prepare(
    `INSERT INTO note_boards (id, name, parent_board_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, name, parent, NOW, NOW)
}

function insertItem(
  db: SqliteDatabase,
  id: string,
  boardId: string,
  kind: string,
  options: {
    noteId?: string
    attachmentId?: string
    payload?: string
    deletedAt?: string
  } = {}
): void {
  db.prepare(
    `INSERT INTO board_items (
       id, board_id, kind, x, y, w, h, z_index, payload_json, note_id, attachment_id,
       deleted_at, created_at, updated_at
     ) VALUES (?, ?, ?, 0, 0, 100, 100, 0, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    boardId,
    kind,
    options.payload ?? '{}',
    options.noteId ?? null,
    options.attachmentId ?? null,
    options.deletedAt ?? null,
    NOW,
    NOW
  )
}

function insertAttachment(db: SqliteDatabase, id: string, noteId: string): void {
  db.prepare(
    `INSERT INTO note_attachments (id, note_id, filename, mime, byte_size, created_at, presentation_style)
     VALUES (?, ?, 'img.png', 'image/png', 64, ?, '{"shape":"rounded","size":"full"}')`
  ).run(id, noteId, NOW)
}

function noteRow(db: SqliteDatabase, id: string): { folder_id: string; body_json: string | null } {
  return db
    .prepare('SELECT folder_id, body_json FROM notes WHERE id = ?')
    .get(id) as { folder_id: string; body_json: string | null }
}

describe('note block model', () => {
  it('validates and derives plaintext from blocks', () => {
    const blocks: NoteBlock[] = [
      { id: 'a', type: 'text', text: 'Hello' },
      { id: 'b', type: 'image', attachmentId: 'att-1' },
      { id: 'c', type: 'text', text: 'World' },
      { id: 'd', type: 'sketch', sketch: SKETCH },
      { id: 'e', type: 'checklist' }
    ]
    expect(validateNoteBlocks(blocks)).toEqual(blocks)
    expect(deriveNoteBodyText(blocks)).toBe('Hello\n\nWorld')
    expect(parseNoteBlocks(serializeNoteBlocks(blocks))).toEqual(blocks)
  })

  it('rejects malformed blocks whole', () => {
    expect(validateNoteBlocks([{ id: 'a', type: 'text' }])).toBeNull()
    expect(validateNoteBlocks([{ id: 'a', type: 'image', attachmentId: '' }])).toBeNull()
    expect(validateNoteBlocks([{ id: '', type: 'text', text: 'x' }])).toBeNull()
    expect(validateNoteBlocks([{ id: 'a', type: 'video' }])).toBeNull()
    expect(validateNoteBlocks('nope')).toBeNull()
  })

  it('validates ink data and rejects off-shape payloads', () => {
    const ink = { version: NOTE_INK_VERSION, width: 800, strokes: SKETCH.strokes }
    expect(validateNoteInkData(ink)).toEqual(ink)
    expect(validateNoteInkData({ ...ink, width: 0 })).toBeNull()
    expect(validateNoteInkData({ ...ink, width: 99999 })).toBeNull()
    expect(
      validateNoteInkData({
        ...ink,
        strokes: [{ tool: 'pen', color: 'ink', width: 4, points: [1, 999999999, 0.5] }]
      })
    ).toBeNull()
  })
})

describe('boards → notes reverse migration', () => {
  let db: SqliteDatabase

  beforeEach(() => {
    db = makeDb()
    testRef.db = db
    ensureNoteAttachmentsTable(db)
    ensureNoteBoardsTables(db)

    insertFolder(db, 'default-notes-folder', 'Notes')
    insertFolder(db, 'folder-1', 'Recipes')

    // Notes: one in a real folder (with a gallery attachment), one that a
    // board move re-homed, one hidden image-backing note.
    insertNote(db, 'note-a', 'folder-1', 'Soup', 'Tomato base')
    insertAttachment(db, 'att-a', 'note-a')
    insertNote(db, 'note-b', 'default-notes-folder', 'Moved card', 'Lives on the moodboard')
    insertNote(db, 'note-img', 'default-notes-folder', 'photo.png', '')
    insertAttachment(db, 'att-img', 'note-img')
    insertNote(db, 'note-tomb', 'folder-1', 'Removed from board', 'Still a note')

    // Boards: root, the folder board, and a user-created board.
    insertBoard(db, 'notes-root-board', 'Notes', null)
    insertBoard(db, 'folder-board-folder-1', 'Recipes', 'notes-root-board')
    insertBoard(db, 'user-board-1', 'Moodboard', 'notes-root-board')

    // Items: cards for the notes, a free image, a free sketch, and tombstones.
    insertItem(db, 'item-card-a', 'folder-board-folder-1', 'card', { noteId: 'note-a' })
    insertItem(db, 'item-card-b', 'user-board-1', 'card', { noteId: 'note-b' })
    insertItem(db, 'item-image', 'user-board-1', 'image', {
      noteId: 'note-img',
      attachmentId: 'att-img'
    })
    insertItem(db, 'item-sketch', 'notes-root-board', 'sketch', {
      payload: JSON.stringify({ sketch: SKETCH })
    })
    insertItem(db, 'item-tomb-card', 'user-board-1', 'card', {
      noteId: 'note-tomb',
      deletedAt: NOW
    })
    insertItem(db, 'item-tomb-image', 'user-board-1', 'image', {
      noteId: 'note-img',
      attachmentId: 'att-img',
      deletedAt: NOW
    })
  })

  it('re-homes cards, folders user boards, collects orphans, backfills documents', () => {
    ensureNotesRebuildMigration(db)

    // User board became a folder; its live card re-homed there.
    const boardFolder = db
      .prepare('SELECT name FROM note_folders WHERE id = ?')
      .get('board-folder-user-board-1') as { name: string } | undefined
    expect(boardFolder?.name).toBe('Moodboard')
    expect(noteRow(db, 'note-b').folder_id).toBe('board-folder-user-board-1')

    // Folder-board cards stay where their folder is; tombstoned card's note untouched.
    expect(noteRow(db, 'note-a').folder_id).toBe('folder-1')
    expect(noteRow(db, 'note-tomb').folder_id).toBe('folder-1')

    // Orphans landed as inline blocks in per-board collector notes.
    const moodboardCollector = noteRow(db, collectorNoteId('user-board-1'))
    const moodboardBlocks = parseNoteBlocks(moodboardCollector.body_json) ?? []
    expect(
      moodboardBlocks.filter((b) => b.type === 'image' && b.attachmentId === 'att-img')
    ).toHaveLength(1)

    const rootCollector = noteRow(db, collectorNoteId('notes-root-board'))
    const rootBlocks = parseNoteBlocks(rootCollector.body_json) ?? []
    const sketchBlocks = rootBlocks.filter((b) => b.type === 'sketch')
    expect(sketchBlocks).toHaveLength(1)
    expect(sketchBlocks[0].type === 'sketch' && sketchBlocks[0].sketch.strokes).toHaveLength(1)

    // Every note got a block document; gallery attachments became inline blocks.
    const noteABlocks = parseNoteBlocks(noteRow(db, 'note-a').body_json) ?? []
    expect(noteABlocks[0]).toMatchObject({ type: 'text', text: 'Tomato base' })
    expect(noteABlocks.filter((b) => b.type === 'image')).toHaveLength(1)

    // Non-destructive: every board row still present.
    const itemCount = db.prepare('SELECT COUNT(*) AS c FROM board_items').get() as { c: number }
    expect(itemCount.c).toBe(6)
  })

  it('is idempotent — a re-run adds nothing and re-homes nothing', () => {
    ensureNotesRebuildMigration(db)

    // The user reorganizes after migration; a re-run must not undo it.
    db.prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run('folder-1', 'note-b')
    const counts = (): { notes: number; folders: number } => ({
      notes: (db.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }).c,
      folders: (db.prepare('SELECT COUNT(*) AS c FROM note_folders').get() as { c: number }).c
    })
    const before = counts()

    ensureNotesRebuildMigration(db)

    expect(counts()).toEqual(before)
    expect(noteRow(db, 'note-b').folder_id).toBe('folder-1')
  })

  it('hides image-backing notes from the list; collectors and notes remain', () => {
    ensureNotesRebuildMigration(db)
    const listed = listNotes()
    const ids = listed.map((note) => note.id)
    expect(ids).not.toContain('note-img')
    expect(ids).toContain('note-a')
    expect(ids).toContain('note-b')
    expect(ids).toContain('note-tomb')
    expect(ids).toContain(collectorNoteId('user-board-1'))
  })

  it('updateNote replaces the document and derives the FTS body from text blocks', () => {
    ensureNotesRebuildMigration(db)
    const blocks: NoteBlock[] = [
      { id: 't1', type: 'text', text: 'First paragraph' },
      { id: 'i1', type: 'image', attachmentId: 'att-a' },
      { id: 't2', type: 'text', text: 'Second paragraph' }
    ]
    const updated = updateNote('note-a', { blocks })
    expect(updated.body).toBe('First paragraph\n\nSecond paragraph')
    expect(updated.blocks).toEqual(blocks)

    const ink = {
      version: NOTE_INK_VERSION,
      width: 720,
      strokes: SKETCH.strokes
    }
    expect(updateNote('note-a', { ink }).ink).toEqual(ink)
    // Ink writes never disturb the document.
    expect(noteRow(db, 'note-a').body_json).toBe(serializeNoteBlocks(blocks))
    expect(updateNote('note-a', { ink: null }).ink).toBeNull()

    expect(() => updateNote('note-a', { blocks: [{ id: '', type: 'text', text: '' }] })).toThrow()
  })
})
