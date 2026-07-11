import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type {
  CreateNoteAttachmentInput,
  NoteAttachmentMime,
  NoteAttachmentRecord,
  UpdateNoteAttachmentInput,
  UpdateNoteSketchInput
} from '@shared/notes'
import {
  DEFAULT_NOTE_ATTACHMENT_STYLE,
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_ATTACHMENT_SHAPES,
  NOTE_ATTACHMENT_SIZES,
  NOTE_SKETCH_STROKES_MAX_BYTES,
  mergeNoteAttachmentStyle,
  noteAttachmentUrl,
  parseNoteAttachmentStyle,
  parseNoteSketchData,
  serializeNoteAttachmentStyle,
  serializeNoteSketchData,
  validateNoteSketchData
} from '@shared/notes'
import { getDatabasePath, getDb } from './database'

const MIME_EXTENSION: Record<NoteAttachmentMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

const MAX_FILENAME_LENGTH = 120

type AttachmentRow = {
  id: string
  note_id: string
  filename: string
  mime: string
  byte_size: number
  created_at: string
  presentation_style: string
  sketch_strokes: string | null
}

/**
 * Attachment files live next to the profile database, so profile delete
 * (`rmSync(profileDirectory, { recursive: true })` in profiles.ts) wipes them
 * with everything else. Never store attachments outside this directory.
 */
export function noteAttachmentsRoot(): string {
  return join(dirname(getDatabasePath()), 'attachments')
}

/** Content sniffing — the claimed mime/extension from the renderer is never trusted. */
export function sniffImageMime(bytes: Uint8Array): NoteAttachmentMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(/[/\\:\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .trim()
  return cleaned || 'Image'
}

function rowToRecord(row: AttachmentRow): NoteAttachmentRecord {
  return {
    id: row.id,
    noteId: row.note_id,
    filename: row.filename,
    mime: row.mime as NoteAttachmentMime,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    url: noteAttachmentUrl(row.id),
    style: parseNoteAttachmentStyle(row.presentation_style),
    sketch: parseNoteSketchData(row.sketch_strokes)
  }
}

/**
 * Sketches must be PNG (that's what the canvas bakes) and their stroke JSON is
 * validated strictly — it replays onto a live canvas when the sketch is re-edited.
 */
function serializeSketchInput(sketch: unknown): string {
  const validated = validateNoteSketchData(sketch)
  if (!validated) {
    throw new Error('Sketch stroke data is malformed')
  }
  const serialized = serializeNoteSketchData(validated)
  if (serialized.length > NOTE_SKETCH_STROKES_MAX_BYTES) {
    throw new Error('Sketch stroke data is too large')
  }
  return serialized
}

function attachmentFilePath(noteId: string, id: string, mime: NoteAttachmentMime): string {
  const root = resolve(noteAttachmentsRoot())
  const path = resolve(root, noteId, `${id}.${MIME_EXTENSION[mime]}`)
  if (!path.startsWith(root + sep)) {
    throw new Error('Attachment path escapes the profile directory')
  }
  return path
}

function getAttachmentRow(id: string): AttachmentRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, note_id, filename, mime, byte_size, created_at, presentation_style, sketch_strokes
       FROM note_attachments WHERE id = ?`
    )
    .get(id) as AttachmentRow | undefined
}

function assertAttachmentStylePatch(patch: UpdateNoteAttachmentInput): void {
  if (patch.shape !== undefined && !NOTE_ATTACHMENT_SHAPES.includes(patch.shape)) {
    throw new Error('shape must be rectangle, rounded, or circle')
  }
  if (patch.size !== undefined && !NOTE_ATTACHMENT_SIZES.includes(patch.size)) {
    throw new Error('size must be small, medium, or full')
  }
  if (patch.shape === undefined && patch.size === undefined) {
    throw new Error('At least one style field is required')
  }
}

function touchNote(noteId: string, now: string): void {
  getDb().prepare('UPDATE notes SET updated_at = @now WHERE id = @noteId').run({ now, noteId })
}

export function createNoteAttachment(input: CreateNoteAttachmentInput): NoteAttachmentRecord {
  const database = getDb()
  const note = database.prepare('SELECT id FROM notes WHERE id = ?').get(input.noteId) as
    | { id: string }
    | undefined
  if (!note) {
    throw new Error('Note not found')
  }

  const bytes = input.bytes
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new Error('Image data is empty')
  }
  if (bytes.length > NOTE_ATTACHMENT_MAX_BYTES) {
    throw new Error('Images are capped at 10 MB')
  }

  const mime = sniffImageMime(bytes)
  if (!mime) {
    throw new Error('Only PNG, JPEG, GIF, or WebP images can be attached')
  }

  let sketchStrokes: string | null = null
  if (input.sketch !== undefined) {
    if (mime !== 'image/png') {
      throw new Error('Sketches must be PNG images')
    }
    sketchStrokes = serializeSketchInput(input.sketch)
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  const filename = sanitizeFilename(input.filename)
  // B5 (§4 sweep): sketches used to land at full width with their size/shape
  // controls clipped below the fold. A sketch is content the user just made at a
  // deliberate size, so it defaults to a medium frame; photos still land full.
  const defaultStyle =
    sketchStrokes !== null
      ? { ...DEFAULT_NOTE_ATTACHMENT_STYLE, size: 'medium' as const }
      : DEFAULT_NOTE_ATTACHMENT_STYLE
  const presentationStyle = serializeNoteAttachmentStyle(defaultStyle)
  const filePath = attachmentFilePath(input.noteId, id, mime)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, bytes)

  try {
    database
      .prepare(
        `INSERT INTO note_attachments (
           id, note_id, filename, mime, byte_size, created_at, presentation_style, sketch_strokes
         ) VALUES (@id, @noteId, @filename, @mime, @byteSize, @now, @presentationStyle, @sketchStrokes)`
      )
      .run({
        id,
        noteId: input.noteId,
        filename,
        mime,
        byteSize: bytes.length,
        now,
        presentationStyle,
        sketchStrokes
      })
    touchNote(input.noteId, now)
  } catch (err) {
    try {
      unlinkSync(filePath)
    } catch {
      // best effort — the row insert failed, don't mask that error
    }
    throw err
  }

  return rowToRecord(getAttachmentRow(id)!)
}

export function listNoteAttachments(noteId: string): NoteAttachmentRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, note_id, filename, mime, byte_size, created_at, presentation_style, sketch_strokes
       FROM note_attachments WHERE note_id = ?
       ORDER BY created_at, id`
    )
    .all(noteId) as AttachmentRow[]
  return rows.map(rowToRecord)
}

export function updateNoteAttachment(
  id: string,
  patch: UpdateNoteAttachmentInput
): NoteAttachmentRecord {
  assertAttachmentStylePatch(patch)

  const database = getDb()
  const row = getAttachmentRow(id)
  if (!row) {
    throw new Error('Attachment not found')
  }

  const style = mergeNoteAttachmentStyle(parseNoteAttachmentStyle(row.presentation_style), patch)
  const now = new Date().toISOString()

  database
    .prepare('UPDATE note_attachments SET presentation_style = @style WHERE id = @id')
    .run({ id, style: serializeNoteAttachmentStyle(style) })
  touchNote(row.note_id, now)

  return rowToRecord(getAttachmentRow(id)!)
}

/**
 * In-place sketch edit: replaces the baked PNG and its stroke source together, keeping
 * the attachment id (and moss-attachment URL — served with `Cache-Control: no-store`)
 * stable. Strokes commit before the file write: if the write fails, the strokes are
 * still the source of truth and the next save re-bakes the PNG from them.
 */
export function updateNoteSketch(id: string, input: UpdateNoteSketchInput): NoteAttachmentRecord {
  const row = getAttachmentRow(id)
  if (!row) {
    throw new Error('Attachment not found')
  }
  if (!row.sketch_strokes) {
    throw new Error('Attachment is not a sketch')
  }

  const bytes = input.bytes
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new Error('Image data is empty')
  }
  if (bytes.length > NOTE_ATTACHMENT_MAX_BYTES) {
    throw new Error('Images are capped at 10 MB')
  }
  if (sniffImageMime(bytes) !== 'image/png') {
    throw new Error('Sketches must be PNG images')
  }

  const sketchStrokes = serializeSketchInput(input.sketch)
  const now = new Date().toISOString()

  getDb()
    .prepare(
      `UPDATE note_attachments
       SET byte_size = @byteSize, sketch_strokes = @sketchStrokes
       WHERE id = @id`
    )
    .run({ id, byteSize: bytes.length, sketchStrokes })
  touchNote(row.note_id, now)

  const filePath = attachmentFilePath(row.note_id, id, 'image/png')
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, bytes)

  return rowToRecord(getAttachmentRow(id)!)
}

export function getNoteAttachment(id: string): NoteAttachmentRecord | null {
  const row = getAttachmentRow(id)
  return row ? rowToRecord(row) : null
}

/** Resolve an attachment to an on-disk file for the moss-attachment: protocol. */
export function resolveNoteAttachmentFile(
  id: string
): { path: string; mime: NoteAttachmentMime } | null {
  const row = getAttachmentRow(id)
  if (!row) return null
  const mime = row.mime as NoteAttachmentMime
  if (!(mime in MIME_EXTENSION)) return null
  const path = attachmentFilePath(row.note_id, row.id, mime)
  if (!existsSync(path)) return null
  return { path, mime }
}

export function deleteNoteAttachment(id: string): { ok: true } {
  const database = getDb()
  const row = getAttachmentRow(id)
  if (!row) {
    throw new Error('Attachment not found')
  }

  const now = new Date().toISOString()
  database.prepare('DELETE FROM note_attachments WHERE id = ?').run(id)
  touchNote(row.note_id, now)

  const path = attachmentFilePath(row.note_id, row.id, row.mime as NoteAttachmentMime)
  try {
    unlinkSync(path)
    const noteDir = dirname(path)
    if (readdirSync(noteDir).length === 0) {
      rmSync(noteDir, { recursive: true, force: true })
    }
  } catch {
    // best effort — a missing file must not block removing the row
  }

  return { ok: true }
}

/** GC for note delete: remove this note's rows and its attachment directory. */
export function deleteAttachmentsForNote(noteId: string): void {
  getDb().prepare('DELETE FROM note_attachments WHERE note_id = ?').run(noteId)
  const root = resolve(noteAttachmentsRoot())
  const dir = resolve(root, noteId)
  if (!dir.startsWith(root + sep)) {
    throw new Error('Attachment path escapes the profile directory')
  }
  rmSync(dir, { recursive: true, force: true })
}
