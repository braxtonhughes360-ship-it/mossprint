import { randomUUID } from 'node:crypto'
import type {
  CreateNoteFolderInput,
  CreateNoteInput,
  CreateNoteTaskInput,
  NoteBlock,
  NoteFolderRecord,
  NoteRecord,
  NotesDoorSnapshot,
  NoteTaskRecord,
  UpdateNoteInput,
  UpdateNoteTaskInput
} from '@shared/notes'
import {
  DEFAULT_NOTE_FOLDER_NAME,
  NOTE_BODY_JSON_MAX_BYTES,
  NOTE_INK_STROKES_MAX_BYTES,
  deriveNoteBodyText,
  noteDisplayTitle,
  parseNoteBlocks,
  parseNoteInkData,
  parseNoteTags,
  serializeNoteBlocks,
  serializeNoteInkData,
  serializeNoteTags,
  validateNoteBlocks,
  validateNoteInkData
} from '@shared/notes'
import { getDb } from './database'
import { deleteAttachmentsForNote } from './notesAttachments'

const DEFAULT_FOLDER_ID = 'default-notes-folder'

/**
 * Boards-era `image` items hang their attachment on a hidden backing note.
 * Those rows are an implementation detail kept only for rollback — the list,
 * search, and door must never present one as "your note". `alias` is the
 * notes table's alias in the enclosing query.
 */
function notImageBacking(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM board_items bi WHERE bi.note_id = ${alias}.id AND bi.kind = 'image'
  )`
}

type NoteRow = {
  id: string
  folder_id: string
  title: string
  body: string
  is_pinned: number
  is_checklist_mode: number
  tags: string
  created_at: string
  updated_at: string
}

type FolderRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

type TaskRow = {
  id: string
  note_id: string
  label: string
  is_done: number
  sort_order: number
  created_at: string
}

function rowToFolder(row: FolderRow): NoteFolderRecord {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  }
}

function rowToNote(row: NoteRow, taskCounts?: { open: number; total: number }): NoteRecord {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned === 1,
    isChecklistMode: row.is_checklist_mode === 1,
    tags: parseNoteTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openTaskCount: taskCounts?.open,
    totalTaskCount: taskCounts?.total
  }
}

function rowToTask(row: TaskRow): NoteTaskRecord {
  return {
    id: row.id,
    noteId: row.note_id,
    label: row.label,
    isDone: row.is_done === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  }
}

export function ensureDefaultNoteFolder(): NoteFolderRecord {
  const database = getDb()
  const existing = database
    .prepare('SELECT id, name, sort_order, created_at FROM note_folders WHERE id = ?')
    .get(DEFAULT_FOLDER_ID) as FolderRow | undefined

  if (existing) {
    return rowToFolder(existing)
  }

  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO note_folders (id, name, sort_order, created_at)
       VALUES (@id, @name, 0, @now)`
    )
    .run({ id: DEFAULT_FOLDER_ID, name: DEFAULT_NOTE_FOLDER_NAME, now })

  return {
    id: DEFAULT_FOLDER_ID,
    name: DEFAULT_NOTE_FOLDER_NAME,
    sortOrder: 0,
    createdAt: now
  }
}

export function listNoteFolders(): NoteFolderRecord[] {
  ensureDefaultNoteFolder()
  const rows = getDb()
    .prepare('SELECT id, name, sort_order, created_at FROM note_folders ORDER BY sort_order, name')
    .all() as FolderRow[]
  return rows.map(rowToFolder)
}

export function createNoteFolder(input: CreateNoteFolderInput): NoteFolderRecord {
  const name = input.name.trim()
  if (!name) {
    throw new Error('Folder name is required')
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  const sortOrder = (
    getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM note_folders')
      .get() as { next: number }
  ).next

  getDb()
    .prepare(
      `INSERT INTO note_folders (id, name, sort_order, created_at)
       VALUES (@id, @name, @sortOrder, @now)`
    )
    .run({ id, name, sortOrder, now })

  return { id, name, sortOrder, createdAt: now }
}

export function renameNoteFolder(id: string, name: string): NoteFolderRecord {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Folder name is required')
  }
  if (id === DEFAULT_FOLDER_ID) {
    throw new Error('The default folder cannot be renamed')
  }

  const result = getDb()
    .prepare('UPDATE note_folders SET name = @name WHERE id = @id')
    .run({ id, name: trimmed })

  if (result.changes === 0) {
    throw new Error('Folder not found')
  }

  const row = getDb()
    .prepare('SELECT id, name, sort_order, created_at FROM note_folders WHERE id = ?')
    .get(id) as FolderRow

  return rowToFolder(row)
}

export function deleteNoteFolder(id: string): { ok: true } {
  if (id === DEFAULT_FOLDER_ID) {
    throw new Error('The default folder cannot be deleted')
  }

  const database = getDb()
  const defaultFolder = ensureDefaultNoteFolder()

  database.transaction(() => {
    database
      .prepare('UPDATE notes SET folder_id = @folderId WHERE folder_id = @id')
      .run({ folderId: defaultFolder.id, id })
    database.prepare('DELETE FROM note_folders WHERE id = ?').run(id)
  })()

  return { ok: true }
}

function taskCountsForNote(noteId: string): { open: number; total: number } {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_done = 0 THEN 1 ELSE 0 END) AS open_count
       FROM note_tasks WHERE note_id = ?`
    )
    .get(noteId) as { total: number; open_count: number | null }

  return {
    total: row.total ?? 0,
    open: row.open_count ?? 0
  }
}

function attachTaskCounts(notes: NoteRecord[]): NoteRecord[] {
  if (notes.length === 0) return notes
  return notes.map((note) => {
    if (!note.isChecklistMode) return note
    const counts = taskCountsForNote(note.id)
    return { ...note, openTaskCount: counts.open, totalTaskCount: counts.total }
  })
}

export function listNotes(folderId?: string, searchQuery?: string): NoteRecord[] {
  ensureDefaultNoteFolder()
  const database = getDb()
  const query = searchQuery?.trim()

  if (query) {
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '""')}"*`)
      .join(' ')

    const rows = database
      .prepare(
        `SELECT n.id, n.folder_id, n.title, n.body, n.is_pinned, n.is_checklist_mode,
                n.tags, n.created_at, n.updated_at
         FROM notes n
         JOIN notes_fts ON notes_fts.rowid = n.rowid
         WHERE notes_fts MATCH @query
           AND ${notImageBacking('n')}
           ${folderId ? 'AND n.folder_id = @folderId' : ''}
         ORDER BY n.is_pinned DESC, rank, n.updated_at DESC
         LIMIT 100`
      )
      .all({ query: ftsQuery, folderId }) as NoteRow[]

    return attachTaskCounts(rows.map((row) => rowToNote(row)))
  }

  const rows = folderId
    ? (database
        .prepare(
          `SELECT id, folder_id, title, body, is_pinned, is_checklist_mode, tags, created_at, updated_at
           FROM notes WHERE folder_id = @folderId AND ${notImageBacking('notes')}
           ORDER BY is_pinned DESC, updated_at DESC`
        )
        .all({ folderId }) as NoteRow[])
    : (database
        .prepare(
          `SELECT id, folder_id, title, body, is_pinned, is_checklist_mode, tags, created_at, updated_at
           FROM notes WHERE ${notImageBacking('notes')}
           ORDER BY is_pinned DESC, updated_at DESC`
        )
        .all() as NoteRow[])

  return attachTaskCounts(rows.map((row) => rowToNote(row)))
}

export function getNote(id: string): NoteRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, folder_id, title, body, body_json, ink_json, is_pinned, is_checklist_mode,
              tags, created_at, updated_at
       FROM notes WHERE id = ?`
    )
    .get(id) as (NoteRow & { body_json: string | null; ink_json: string | null }) | undefined

  if (!row) return null
  const base = rowToNote(row)
  // Fallback for a document that predates (or failed) the block backfill:
  // the plaintext body as one text block — same content, never a blank page.
  const blocks =
    parseNoteBlocks(row.body_json) ?? [{ id: randomUUID(), type: 'text' as const, text: row.body }]
  const ink = parseNoteInkData(row.ink_json)
  const note: NoteRecord = { ...base, blocks, ink }
  if (!note.isChecklistMode) return note
  const counts = taskCountsForNote(note.id)
  return { ...note, openTaskCount: counts.open, totalTaskCount: counts.total }
}

export function createNote(input: CreateNoteInput = {}): NoteRecord {
  const defaultFolder = ensureDefaultNoteFolder()
  const folderId = input.folderId ?? defaultFolder.id
  const id = randomUUID()
  const now = new Date().toISOString()
  const title = input.title?.trim() ?? ''
  const body = input.body ?? ''
  const bodyJson = serializeNoteBlocks([{ id: randomUUID(), type: 'text', text: body }])
  const isChecklistMode = input.isChecklistMode ?? false
  const tags = serializeNoteTags(input.tags ?? [])

  getDb()
    .prepare(
      `INSERT INTO notes (
         id, folder_id, title, body, body_json, is_pinned, is_checklist_mode, tags,
         created_at, updated_at
       ) VALUES (
         @id, @folderId, @title, @body, @bodyJson, 0, @isChecklistMode, @tags, @now, @now
       )`
    )
    .run({ id, folderId, title, body, bodyJson, isChecklistMode: isChecklistMode ? 1 : 0, tags, now })

  return getNote(id)!
}

export function updateNote(id: string, patch: UpdateNoteInput): NoteRecord {
  const existing = getNote(id)
  if (!existing) {
    throw new Error('Note not found')
  }

  const now = new Date().toISOString()
  const title = patch.title !== undefined ? patch.title.trim() : existing.title
  const folderId = patch.folderId ?? existing.folderId
  const isChecklistMode =
    patch.isChecklistMode !== undefined ? patch.isChecklistMode : existing.isChecklistMode
  const tags =
    patch.tags !== undefined ? serializeNoteTags(patch.tags) : serializeNoteTags(existing.tags)

  // The document is written whole: `blocks` replaces it (the block editor's
  // path), a bare `body` string (capture) becomes the text while any inline
  // image/sketch blocks survive. Either way notes.body is re-derived so the
  // FTS triggers index exactly what the document says.
  let blocks: NoteBlock[]
  if (patch.blocks !== undefined) {
    const validated = validateNoteBlocks(patch.blocks)
    if (!validated) {
      throw new Error('Note document is malformed')
    }
    blocks = validated
  } else if (patch.body !== undefined) {
    const bodyText = patch.body
    const kept = (existing.blocks ?? []).filter((block) => block.type !== 'text')
    blocks = [{ id: randomUUID(), type: 'text', text: bodyText }, ...kept]
  } else {
    blocks = existing.blocks ?? [{ id: randomUUID(), type: 'text', text: existing.body }]
  }
  const bodyJson = serializeNoteBlocks(blocks)
  if (bodyJson.length > NOTE_BODY_JSON_MAX_BYTES) {
    throw new Error('This note is too large to save')
  }
  const body = deriveNoteBodyText(blocks)

  // Ink is independent of the document: undefined leaves it alone, null clears.
  let inkJson: string | null
  if (patch.ink === undefined) {
    inkJson = existing.ink ? serializeNoteInkData(existing.ink) : null
  } else if (patch.ink === null) {
    inkJson = null
  } else {
    const validated = validateNoteInkData(patch.ink)
    if (!validated) {
      throw new Error('Note ink data is malformed')
    }
    inkJson = serializeNoteInkData(validated)
    if (inkJson.length > NOTE_INK_STROKES_MAX_BYTES) {
      throw new Error('This drawing is too detailed to save — undo some strokes first')
    }
  }

  getDb()
    .prepare(
      `UPDATE notes SET
         title = @title,
         body = @body,
         body_json = @bodyJson,
         ink_json = @inkJson,
         folder_id = @folderId,
         is_checklist_mode = @isChecklistMode,
         tags = @tags,
         updated_at = @now
       WHERE id = @id`
    )
    .run({
      id,
      title,
      body,
      bodyJson,
      inkJson,
      folderId,
      isChecklistMode: isChecklistMode ? 1 : 0,
      tags,
      now
    })

  return getNote(id)!
}

export function deleteNote(id: string): { ok: true } {
  const result = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error('Note not found')
  }
  // Rows cascade with the note; the on-disk image files need explicit GC.
  deleteAttachmentsForNote(id)
  return { ok: true }
}

export function setNotePinned(id: string, pinned: boolean): NoteRecord {
  const now = new Date().toISOString()
  const result = getDb()
    .prepare('UPDATE notes SET is_pinned = @pinned, updated_at = @now WHERE id = @id')
    .run({ id, pinned: pinned ? 1 : 0, now })

  if (result.changes === 0) {
    throw new Error('Note not found')
  }

  return getNote(id)!
}

export function searchNotes(query: string): NoteRecord[] {
  return listNotes(undefined, query)
}

export function listNoteTasks(noteId: string): NoteTaskRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, note_id, label, is_done, sort_order, created_at
       FROM note_tasks WHERE note_id = ?
       ORDER BY sort_order, created_at`
    )
    .all(noteId) as TaskRow[]

  return rows.map(rowToTask)
}

export function createNoteTask(input: CreateNoteTaskInput): NoteTaskRecord {
  const note = getNote(input.noteId)
  if (!note) {
    throw new Error('Note not found')
  }

  const label = input.label.trim()
  if (!label) {
    throw new Error('Task label is required')
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  const sortOrder =
    input.sortOrder ??
    (
      getDb()
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM note_tasks WHERE note_id = ?')
        .get(input.noteId) as { next: number }
    ).next

  getDb()
    .prepare(
      `INSERT INTO note_tasks (id, note_id, label, is_done, sort_order, created_at)
       VALUES (@id, @noteId, @label, 0, @sortOrder, @now)`
    )
    .run({ id, noteId: input.noteId, label, sortOrder, now })

  getDb()
    .prepare('UPDATE notes SET updated_at = @now, is_checklist_mode = 1 WHERE id = @noteId')
    .run({ now, noteId: input.noteId })

  return rowToTask(
    getDb()
      .prepare(
        `SELECT id, note_id, label, is_done, sort_order, created_at
         FROM note_tasks WHERE id = ?`
      )
      .get(id) as TaskRow
  )
}

export function updateNoteTask(id: string, patch: UpdateNoteTaskInput): NoteTaskRecord {
  const existing = getDb()
    .prepare(
      `SELECT id, note_id, label, is_done, sort_order, created_at
       FROM note_tasks WHERE id = ?`
    )
    .get(id) as TaskRow | undefined

  if (!existing) {
    throw new Error('Task not found')
  }

  const label = patch.label !== undefined ? patch.label.trim() : existing.label
  if (!label) {
    throw new Error('Task label is required')
  }

  const isDone = patch.isDone !== undefined ? (patch.isDone ? 1 : 0) : existing.is_done
  const sortOrder = patch.sortOrder ?? existing.sort_order
  const now = new Date().toISOString()

  getDb()
    .prepare(
      `UPDATE note_tasks SET label = @label, is_done = @isDone, sort_order = @sortOrder
       WHERE id = @id`
    )
    .run({ id, label, isDone, sortOrder })

  getDb()
    .prepare('UPDATE notes SET updated_at = @now WHERE id = @noteId')
    .run({ now, noteId: existing.note_id })

  return rowToTask(
    getDb()
      .prepare(
        `SELECT id, note_id, label, is_done, sort_order, created_at
         FROM note_tasks WHERE id = ?`
      )
      .get(id) as TaskRow
  )
}

export function toggleNoteTask(id: string): NoteTaskRecord {
  const existing = getDb()
    .prepare('SELECT is_done FROM note_tasks WHERE id = ?')
    .get(id) as { is_done: number } | undefined

  if (!existing) {
    throw new Error('Task not found')
  }

  return updateNoteTask(id, { isDone: existing.is_done !== 1 })
}

export function deleteNoteTask(id: string): { ok: true } {
  const result = getDb().prepare('DELETE FROM note_tasks WHERE id = ?').run(id)
  if (result.changes === 0) {
    throw new Error('Task not found')
  }
  return { ok: true }
}

export function getNotesDoorSnapshot(): NotesDoorSnapshot {
  ensureDefaultNoteFolder()
  const database = getDb()

  const pinnedRow = database
    .prepare(
      `SELECT id, title FROM notes WHERE is_pinned = 1 AND ${notImageBacking('notes')}
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get() as { id: string; title: string } | undefined

  const lastEditedRow = database
    .prepare(
      `SELECT id, title, updated_at FROM notes WHERE ${notImageBacking('notes')}
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get() as { id: string; title: string; updated_at: string } | undefined

  const openTaskCountRow = database
    .prepare('SELECT COUNT(*) AS count FROM note_tasks WHERE is_done = 0')
    .get() as { count: number }

  const checklistNoteRow = database
    .prepare(
      `SELECT n.id, n.title,
              SUM(CASE WHEN t.is_done = 1 THEN 1 ELSE 0 END) AS done,
              COUNT(t.id) AS total
       FROM notes n
       JOIN note_tasks t ON t.note_id = n.id
       WHERE n.is_checklist_mode = 1
       GROUP BY n.id
       HAVING total > 0
       ORDER BY n.is_pinned DESC, n.updated_at DESC
       LIMIT 1`
    )
    .get() as { id: string; title: string; done: number; total: number } | undefined

  return {
    pinnedNote: pinnedRow
      ? { id: pinnedRow.id, title: noteDisplayTitle(pinnedRow.title) }
      : null,
    openTaskCount: openTaskCountRow.count ?? 0,
    lastEdited: lastEditedRow
      ? {
          id: lastEditedRow.id,
          title: noteDisplayTitle(lastEditedRow.title),
          updatedAt: lastEditedRow.updated_at
        }
      : null,
    checklistProgress: checklistNoteRow
      ? {
          done: checklistNoteRow.done,
          total: checklistNoteRow.total,
          noteTitle: noteDisplayTitle(checklistNoteRow.title)
        }
      : null
  }
}
