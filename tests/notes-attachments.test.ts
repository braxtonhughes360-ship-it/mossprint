import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { SqliteDatabase } from '../src/main/sqlite'

const testRef = vi.hoisted(() => ({
  db: null as SqliteDatabase | null,
  dbPath: ''
}))

vi.mock('../src/main/database', () => ({
  getDb: () => {
    if (!testRef.db) throw new Error('test database not initialized')
    return testRef.db
  },
  getDatabasePath: () => {
    if (!testRef.dbPath) throw new Error('test database path not initialized')
    return testRef.dbPath
  }
}))

import {
  createNoteAttachment,
  deleteAttachmentsForNote,
  deleteNoteAttachment,
  listNoteAttachments,
  noteAttachmentsRoot,
  resolveNoteAttachmentFile,
  sniffImageMime,
  updateNoteAttachment,
  updateNoteSketch
} from '../src/main/notesAttachments'
import { ensureNoteAttachmentsTable } from '../src/main/notesAttachmentsSchema'
import { deleteNote } from '../src/main/notes'
import type { NoteSketchData } from '../src/shared/notes'
import {
  DEFAULT_NOTE_ATTACHMENT_STYLE,
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_SKETCH_VERSION,
  parseNoteAttachmentStyle,
  parseNoteSketchData,
  serializeNoteSketchData,
  validateNoteSketchData
} from '../src/shared/notes'

const NOTES_SCHEMA = `
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
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_checklist_mode INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`

const NOTE_ID = 'note-1'

function pngBytes(padding = 64): Uint8Array {
  const bytes = new Uint8Array(8 + padding)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

function jpegBytes(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return bytes
}

function gifBytes(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  return bytes
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
  return bytes
}

let profileDir = ''

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'moss-notes-attachments-'))
  testRef.dbPath = join(profileDir, 'moss.sqlite')

  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  raw.exec(NOTES_SCHEMA)
  testRef.db = raw as unknown as SqliteDatabase
  ensureNoteAttachmentsTable(testRef.db)

  testRef.db
    .prepare(
      `INSERT INTO note_folders (id, name, sort_order, created_at)
       VALUES ('folder-1', 'Notes', 0, '2026-07-03T00:00:00.000Z')`
    )
    .run()
  testRef.db
    .prepare(
      `INSERT INTO notes (id, folder_id, title, body, created_at, updated_at)
       VALUES ('${NOTE_ID}', 'folder-1', 'Test note', '', '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z')`
    )
    .run()
})

afterEach(() => {
  rmSync(profileDir, { recursive: true, force: true })
})

describe('sniffImageMime', () => {
  it('detects the four allowed formats and rejects everything else', () => {
    expect(sniffImageMime(pngBytes())).toBe('image/png')
    expect(sniffImageMime(jpegBytes())).toBe('image/jpeg')
    expect(sniffImageMime(gifBytes())).toBe('image/gif')
    expect(sniffImageMime(webpBytes())).toBe('image/webp')
    expect(sniffImageMime(new TextEncoder().encode('plain text file'))).toBeNull()
    expect(sniffImageMime(new Uint8Array(0))).toBeNull()
  })
})

describe('createNoteAttachment', () => {
  it('writes the file under the profile directory and persists a row', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })

    expect(record.noteId).toBe(NOTE_ID)
    expect(record.mime).toBe('image/png')
    expect(record.filename).toBe('photo.png')
    expect(record.url).toBe(`moss-attachment://${record.id}`)
    expect(record.style).toEqual(DEFAULT_NOTE_ATTACHMENT_STYLE)

    const resolved = resolveNoteAttachmentFile(record.id)
    expect(resolved?.mime).toBe('image/png')
    expect(existsSync(resolved!.path)).toBe(true)
    // The profile-delete invariant: the file must live INSIDE the profile directory,
    // so profiles.ts `rmSync(profileDirectory, { recursive: true })` wipes it.
    expect(resolved!.path.startsWith(profileDir + sep)).toBe(true)

    expect(listNoteAttachments(NOTE_ID)).toHaveLength(1)
  })

  it('sniffs content instead of trusting the filename', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'disguised.png',
      bytes: jpegBytes()
    })
    expect(record.mime).toBe('image/jpeg')
    expect(resolveNoteAttachmentFile(record.id)!.path.endsWith('.jpg')).toBe(true)
  })

  it('strips path separators and control characters from filenames', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: '../..\\evil\u0000name.png',
      bytes: pngBytes()
    })
    expect(record.filename).not.toMatch(/[/\\\u0000]/)
  })

  it('rejects non-image bytes', () => {
    expect(() =>
      createNoteAttachment({
        noteId: NOTE_ID,
        filename: 'notes.txt',
        bytes: new TextEncoder().encode('not an image')
      })
    ).toThrow(/PNG, JPEG, GIF, or WebP/)
    expect(existsSync(noteAttachmentsRoot())).toBe(false)
  })

  it('rejects images over the size cap', () => {
    expect(() =>
      createNoteAttachment({
        noteId: NOTE_ID,
        filename: 'huge.png',
        bytes: pngBytes(NOTE_ATTACHMENT_MAX_BYTES)
      })
    ).toThrow(/10 MB/)
  })

  it('rejects attachments for a missing note', () => {
    expect(() =>
      createNoteAttachment({ noteId: 'missing', filename: 'a.png', bytes: pngBytes() })
    ).toThrow('Note not found')
  })

  it('touches the note updated_at so list ordering reflects the change', () => {
    createNoteAttachment({ noteId: NOTE_ID, filename: 'a.png', bytes: pngBytes() })
    const row = testRef.db!
      .prepare('SELECT updated_at FROM notes WHERE id = ?')
      .get(NOTE_ID) as { updated_at: string }
    expect(row.updated_at > '2026-07-03T00:00:00.000Z').toBe(true)
  })
})

describe('updateNoteAttachment', () => {
  it('persists presentation style without touching the image file', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    const path = resolveNoteAttachmentFile(record.id)!.path

    const updated = updateNoteAttachment(record.id, { shape: 'circle', size: 'small' })

    expect(updated.style).toEqual({ shape: 'circle', size: 'small' })
    expect(existsSync(path)).toBe(true)
    expect(listNoteAttachments(NOTE_ID)[0]?.style).toEqual({ shape: 'circle', size: 'small' })
  })

  it('merges partial style patches', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })

    updateNoteAttachment(record.id, { shape: 'rectangle' })
    expect(listNoteAttachments(NOTE_ID)[0]?.style).toEqual({
      shape: 'rectangle',
      size: 'full'
    })

    updateNoteAttachment(record.id, { size: 'medium' })
    expect(listNoteAttachments(NOTE_ID)[0]?.style).toEqual({
      shape: 'rectangle',
      size: 'medium'
    })
  })

  it('rejects invalid style values and unknown attachments', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })

    expect(() => updateNoteAttachment(record.id, { shape: 'oval' as 'circle' })).toThrow(/rectangle/)
    expect(() => updateNoteAttachment(record.id, { size: 'tiny' as 'small' })).toThrow(/small/)
    expect(() => updateNoteAttachment(record.id, {})).toThrow(/At least one/)
    expect(() => updateNoteAttachment('missing', { shape: 'circle' })).toThrow('Attachment not found')
  })

  it('touches the note updated_at', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    const before = testRef.db!
      .prepare('SELECT updated_at FROM notes WHERE id = ?')
      .get(NOTE_ID) as { updated_at: string }

    updateNoteAttachment(record.id, { shape: 'circle' })

    const after = testRef.db!
      .prepare('SELECT updated_at FROM notes WHERE id = ?')
      .get(NOTE_ID) as { updated_at: string }
    expect(after.updated_at >= before.updated_at).toBe(true)
  })
})

function sketchData(overrides: Partial<NoteSketchData> = {}): NoteSketchData {
  return {
    version: NOTE_SKETCH_VERSION,
    width: 800,
    height: 500,
    strokes: [
      { tool: 'pen', color: 'ink', width: 4, points: [10, 10, 0.5, 40, 40, 0.5] },
      { tool: 'eraser', color: 'ink', width: 8, points: [20, 20, 0.5] }
    ],
    ...overrides
  }
}

describe('sketch stroke validation', () => {
  it('round-trips a valid sketch through serialize/parse', () => {
    const data = sketchData()
    expect(parseNoteSketchData(serializeNoteSketchData(data))).toEqual(data)
  })

  it('rejects the whole payload for any off-shape input', () => {
    expect(validateNoteSketchData(null)).toBeNull()
    expect(validateNoteSketchData('scribble')).toBeNull()
    expect(validateNoteSketchData(sketchData({ version: 2 as 1 }))).toBeNull()
    expect(validateNoteSketchData(sketchData({ width: 0 }))).toBeNull()
    expect(validateNoteSketchData(sketchData({ height: 4096 }))).toBeNull()
    expect(validateNoteSketchData(sketchData({ width: 800.5 }))).toBeNull()
    const base = sketchData().strokes[0]
    for (const stroke of [
      { ...base, tool: 'marker' },
      { ...base, color: 'red' },
      { ...base, width: 3 },
      { ...base, points: [] },
      { ...base, points: [1, 2] },
      { ...base, points: [1, 2, Number.NaN] }
    ]) {
      expect(
        validateNoteSketchData(sketchData({ strokes: [stroke as NoteSketchData['strokes'][0]] }))
      ).toBeNull()
    }
  })

  it('parseNoteSketchData tolerates null and garbage', () => {
    expect(parseNoteSketchData(null)).toBeNull()
    expect(parseNoteSketchData('')).toBeNull()
    expect(parseNoteSketchData('not json')).toBeNull()
    expect(parseNoteSketchData('{"version":1}')).toBeNull()
  })
})

describe('sketch attachments', () => {
  it('creates a sketch attachment whose stroke source round-trips', () => {
    const data = sketchData()
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'Sketch.png',
      bytes: pngBytes(),
      sketch: data
    })

    expect(record.mime).toBe('image/png')
    expect(record.sketch).toEqual(data)
    expect(listNoteAttachments(NOTE_ID)[0]?.sketch).toEqual(data)
  })

  it('plain image attachments carry no sketch source', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    expect(record.sketch).toBeNull()
  })

  it('sketches default to a medium frame; photos still land full (B5 §4 sweep)', () => {
    const sketch = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'Sketch.png',
      bytes: pngBytes(),
      sketch: sketchData()
    })
    expect(sketch.style).toEqual({ shape: 'rounded', size: 'medium' })

    const photo = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    expect(photo.style).toEqual({ shape: 'rounded', size: 'full' })
  })

  it('rejects sketches whose bytes are not PNG', () => {
    expect(() =>
      createNoteAttachment({
        noteId: NOTE_ID,
        filename: 'Sketch.png',
        bytes: jpegBytes(),
        sketch: sketchData()
      })
    ).toThrow(/PNG/)
  })

  it('rejects malformed stroke data', () => {
    expect(() =>
      createNoteAttachment({
        noteId: NOTE_ID,
        filename: 'Sketch.png',
        bytes: pngBytes(),
        sketch: sketchData({ width: 0 })
      })
    ).toThrow(/malformed/)
  })

  it('rejects stroke JSON over the size cap', () => {
    // 40k triples ≈ 700 KB serialized — over the 512 KB cap.
    const points = Array.from({ length: 120000 }, (_, i) => (i % 3 === 2 ? 0.5 : i))
    expect(() =>
      createNoteAttachment({
        noteId: NOTE_ID,
        filename: 'Sketch.png',
        bytes: pngBytes(),
        sketch: sketchData({ strokes: [{ tool: 'pen', color: 'ink', width: 4, points }] })
      })
    ).toThrow(/too large/)
  })
})

describe('updateNoteSketch', () => {
  it('replaces the PNG and stroke source in place, keeping id and url stable', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'Sketch.png',
      bytes: pngBytes(),
      sketch: sketchData()
    })
    const nextSketch = sketchData({
      strokes: [{ tool: 'pen', color: 'accent', width: 2, points: [1, 1, 0.5, 2, 2, 0.75] }]
    })

    const updated = updateNoteSketch(record.id, { bytes: pngBytes(256), sketch: nextSketch })

    expect(updated.id).toBe(record.id)
    expect(updated.url).toBe(record.url)
    expect(updated.sketch).toEqual(nextSketch)
    expect(updated.byteSize).toBe(pngBytes(256).length)
    expect(existsSync(resolveNoteAttachmentFile(record.id)!.path)).toBe(true)
    expect(listNoteAttachments(NOTE_ID)).toHaveLength(1)
  })

  it('rejects edits to attachments that are not sketches', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    expect(() =>
      updateNoteSketch(record.id, { bytes: pngBytes(), sketch: sketchData() })
    ).toThrow(/not a sketch/)
  })

  it('rejects non-PNG bytes, malformed strokes, and unknown attachments', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'Sketch.png',
      bytes: pngBytes(),
      sketch: sketchData()
    })
    expect(() => updateNoteSketch(record.id, { bytes: jpegBytes(), sketch: sketchData() })).toThrow(
      /PNG/
    )
    expect(() =>
      updateNoteSketch(record.id, {
        bytes: pngBytes(),
        sketch: sketchData({ strokes: [], version: 9 as 1 })
      })
    ).toThrow(/malformed/)
    expect(() => updateNoteSketch('missing', { bytes: pngBytes(), sketch: sketchData() })).toThrow(
      'Attachment not found'
    )
  })

  it('touches the note updated_at', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'Sketch.png',
      bytes: pngBytes(),
      sketch: sketchData()
    })
    const before = testRef.db!
      .prepare('SELECT updated_at FROM notes WHERE id = ?')
      .get(NOTE_ID) as { updated_at: string }

    updateNoteSketch(record.id, { bytes: pngBytes(128), sketch: sketchData() })

    const after = testRef.db!
      .prepare('SELECT updated_at FROM notes WHERE id = ?')
      .get(NOTE_ID) as { updated_at: string }
    expect(after.updated_at >= before.updated_at).toBe(true)
  })
})

describe('parseNoteAttachmentStyle', () => {
  it('falls back to defaults for missing or invalid JSON', () => {
    expect(parseNoteAttachmentStyle(null)).toEqual(DEFAULT_NOTE_ATTACHMENT_STYLE)
    expect(parseNoteAttachmentStyle('not json')).toEqual(DEFAULT_NOTE_ATTACHMENT_STYLE)
    expect(parseNoteAttachmentStyle('{"shape":"oval","size":"tiny"}')).toEqual(
      DEFAULT_NOTE_ATTACHMENT_STYLE
    )
  })
})

describe('deleteNoteAttachment', () => {
  it('removes the row and the file on disk', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    const path = resolveNoteAttachmentFile(record.id)!.path

    deleteNoteAttachment(record.id)

    expect(existsSync(path)).toBe(false)
    expect(listNoteAttachments(NOTE_ID)).toHaveLength(0)
    expect(resolveNoteAttachmentFile(record.id)).toBeNull()
  })

  it('throws for an unknown attachment', () => {
    expect(() => deleteNoteAttachment('missing')).toThrow('Attachment not found')
  })
})

describe('note delete GC', () => {
  it('deleteNote removes the attachment rows and the note directory', () => {
    createNoteAttachment({ noteId: NOTE_ID, filename: 'a.png', bytes: pngBytes() })
    createNoteAttachment({ noteId: NOTE_ID, filename: 'b.png', bytes: gifBytes() })
    const noteDir = join(noteAttachmentsRoot(), NOTE_ID)
    expect(readdirSync(noteDir)).toHaveLength(2)

    deleteNote(NOTE_ID)

    expect(existsSync(noteDir)).toBe(false)
    expect(
      testRef.db!.prepare('SELECT COUNT(*) AS count FROM note_attachments').get() as {
        count: number
      }
    ).toMatchObject({ count: 0 })
  })

  it('deleteAttachmentsForNote is safe on a note with no attachments', () => {
    expect(() => deleteAttachmentsForNote(NOTE_ID)).not.toThrow()
  })
})

describe('profile delete wipes attachments', () => {
  it('removing the profile directory (what deleteProfile does) removes all attachment files', () => {
    const record = createNoteAttachment({
      noteId: NOTE_ID,
      filename: 'photo.png',
      bytes: pngBytes()
    })
    const path = resolveNoteAttachmentFile(record.id)!.path
    expect(existsSync(path)).toBe(true)

    // profiles.ts deleteProfile: rmSync(profileDirectory(profileId), { recursive: true, force: true })
    rmSync(profileDir, { recursive: true, force: true })

    expect(existsSync(path)).toBe(false)
    expect(existsSync(noteAttachmentsRoot())).toBe(false)
  })
})
