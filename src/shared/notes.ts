export const NOTES_MAINTENANCE_TAG = 'maintenance'

export const DEFAULT_NOTE_FOLDER_NAME = 'Notes'

export interface NoteFolderRecord {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export interface NoteRecord {
  id: string
  folderId: string
  title: string
  body: string
  isPinned: boolean
  isChecklistMode: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  openTaskCount?: number
  totalTaskCount?: number
  /** Full document — present on getNote, omitted from list payloads. */
  blocks?: NoteBlock[]
  /** Draw-anywhere overlay strokes — present on getNote, null when un-inked. */
  ink?: NoteInkData | null
}

export interface NoteTaskRecord {
  id: string
  noteId: string
  label: string
  isDone: boolean
  sortOrder: number
  createdAt: string
}

export interface CreateNoteFolderInput {
  name: string
}

export interface RenameNoteFolderInput {
  id: string
  name: string
}

export interface CreateNoteInput {
  folderId?: string
  title?: string
  body?: string
  isChecklistMode?: boolean
  tags?: string[]
}

export interface UpdateNoteInput {
  title?: string
  /** Legacy plaintext write (capture); the block editor sends `blocks` instead. */
  body?: string
  /** Full document replace — `body` is derived from the text blocks for FTS. */
  blocks?: NoteBlock[]
  /** Ink overlay replace; null clears it. Never touches body/blocks. */
  ink?: NoteInkData | null
  folderId?: string
  isChecklistMode?: boolean
  tags?: string[]
}

export interface CreateNoteTaskInput {
  noteId: string
  label: string
  sortOrder?: number
}

export interface UpdateNoteTaskInput {
  label?: string
  isDone?: boolean
  sortOrder?: number
}

export const NOTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

export const NOTE_ATTACHMENT_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
] as const

export type NoteAttachmentMime = (typeof NOTE_ATTACHMENT_MIMES)[number]

export const NOTE_ATTACHMENT_URL_SCHEME = 'moss-attachment'

/** Stable renderer-resolvable URL for an attachment; served by the main process. */
export function noteAttachmentUrl(id: string): string {
  return `${NOTE_ATTACHMENT_URL_SCHEME}://${id}`
}

export const NOTE_ATTACHMENT_SHAPES = ['rectangle', 'rounded', 'circle'] as const
export type NoteAttachmentShape = (typeof NOTE_ATTACHMENT_SHAPES)[number]

export const NOTE_ATTACHMENT_SIZES = ['small', 'medium', 'full'] as const
export type NoteAttachmentSize = (typeof NOTE_ATTACHMENT_SIZES)[number]

export interface NoteAttachmentStyle {
  shape: NoteAttachmentShape
  size: NoteAttachmentSize
}

export const DEFAULT_NOTE_ATTACHMENT_STYLE: NoteAttachmentStyle = {
  shape: 'rounded',
  size: 'full'
}

export const NOTE_SKETCH_VERSION = 1

/** Stroke JSON cap — well past minutes of continuous scribbling, well under the 10 MB image cap. */
export const NOTE_SKETCH_STROKES_MAX_BYTES = 512 * 1024

export const NOTE_SKETCH_MAX_DIMENSION = 2048

export const NOTE_SKETCH_TOOLS = ['pen', 'eraser'] as const
export type NoteSketchTool = (typeof NOTE_SKETCH_TOOLS)[number]

/** Semantic, not hex — resolved against the live theme tokens when the canvas renders. */
export const NOTE_SKETCH_COLORS = ['ink', 'accent', 'mark'] as const
export type NoteSketchColor = (typeof NOTE_SKETCH_COLORS)[number]

export const NOTE_SKETCH_STROKE_WIDTHS = [2, 4, 8] as const
export type NoteSketchStrokeWidth = (typeof NOTE_SKETCH_STROKE_WIDTHS)[number]

/** Erasers store the same base width; the renderer sweeps wider so erasing isn't fiddly. */
export const NOTE_SKETCH_ERASER_MULTIPLIER = 4

export interface NoteSketchStroke {
  tool: NoteSketchTool
  color: NoteSketchColor
  width: NoteSketchStrokeWidth
  /** Flat [x, y, pressure, …] triples in logical canvas coordinates. */
  points: number[]
}

export interface NoteSketchData {
  version: typeof NOTE_SKETCH_VERSION
  width: number
  height: number
  strokes: NoteSketchStroke[]
}

function isSketchDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= NOTE_SKETCH_MAX_DIMENSION
  )
}

export function validateNoteSketchStroke(value: unknown): NoteSketchStroke | null {
  if (!value || typeof value !== 'object') return null
  const stroke = value as { tool?: unknown; color?: unknown; width?: unknown; points?: unknown }
  if (!NOTE_SKETCH_TOOLS.includes(stroke.tool as NoteSketchTool)) return null
  if (!NOTE_SKETCH_COLORS.includes(stroke.color as NoteSketchColor)) return null
  if (!NOTE_SKETCH_STROKE_WIDTHS.includes(stroke.width as NoteSketchStrokeWidth)) return null
  if (!Array.isArray(stroke.points)) return null
  if (stroke.points.length === 0 || stroke.points.length % 3 !== 0) return null
  if (!stroke.points.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return null
  }
  return {
    tool: stroke.tool as NoteSketchTool,
    color: stroke.color as NoteSketchColor,
    width: stroke.width as NoteSketchStrokeWidth,
    points: stroke.points as number[]
  }
}

/** Strict: anything off-shape rejects the whole payload — sketches replay onto a live canvas. */
export function validateNoteSketchData(value: unknown): NoteSketchData | null {
  if (!value || typeof value !== 'object') return null
  const data = value as { version?: unknown; width?: unknown; height?: unknown; strokes?: unknown }
  if (data.version !== NOTE_SKETCH_VERSION) return null
  if (!isSketchDimension(data.width) || !isSketchDimension(data.height)) return null
  if (!Array.isArray(data.strokes)) return null
  const strokes: NoteSketchStroke[] = []
  for (const entry of data.strokes) {
    const stroke = validateNoteSketchStroke(entry)
    if (!stroke) return null
    strokes.push(stroke)
  }
  return { version: NOTE_SKETCH_VERSION, width: data.width, height: data.height, strokes }
}

export function parseNoteSketchData(raw: string | null | undefined): NoteSketchData | null {
  if (!raw) return null
  try {
    return validateNoteSketchData(JSON.parse(raw))
  } catch {
    return null
  }
}

export function serializeNoteSketchData(data: NoteSketchData): string {
  return JSON.stringify(data)
}

/* —— Document block model (R1) ——
 * A note is ONE document: an ordered list of blocks. Text blocks are plain
 * (placement, not formatting — the Markdown/rich-text non-goal holds); image
 * blocks point at a note_attachments row; sketch blocks carry N3 stroke JSON
 * inline (migrated board drawings have no baked PNG); the checklist block is a
 * position marker for the note's task list. `notes.body` stays the derived
 * plaintext of the text blocks so notes_fts keeps working with zero changes. */

export interface NoteTextBlock {
  id: string
  type: 'text'
  text: string
}

export interface NoteImageBlock {
  id: string
  type: 'image'
  attachmentId: string
}

export interface NoteChecklistBlock {
  id: string
  type: 'checklist'
}

export interface NoteSketchBlock {
  id: string
  type: 'sketch'
  sketch: NoteSketchData
}

export type NoteBlock = NoteTextBlock | NoteImageBlock | NoteChecklistBlock | NoteSketchBlock

/** Generous — a long document's block JSON is dwarfed by its text content. */
export const NOTE_BODY_JSON_MAX_BYTES = 2 * 1024 * 1024

function isBlockId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

/** Strict: one malformed block rejects the write — the document replays into a live editor. */
export function validateNoteBlocks(value: unknown): NoteBlock[] | null {
  if (!Array.isArray(value)) return null
  const blocks: NoteBlock[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const block = entry as { id?: unknown; type?: unknown; text?: unknown; attachmentId?: unknown; sketch?: unknown }
    if (!isBlockId(block.id)) return null
    if (block.type === 'text') {
      if (typeof block.text !== 'string') return null
      blocks.push({ id: block.id, type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (typeof block.attachmentId !== 'string' || block.attachmentId.length === 0) return null
      blocks.push({ id: block.id, type: 'image', attachmentId: block.attachmentId })
    } else if (block.type === 'checklist') {
      blocks.push({ id: block.id, type: 'checklist' })
    } else if (block.type === 'sketch') {
      const sketch = validateNoteSketchData(block.sketch)
      if (!sketch) return null
      blocks.push({ id: block.id, type: 'sketch', sketch })
    } else {
      return null
    }
  }
  return blocks
}

/** Lenient on read — a malformed stored document falls back to the plaintext body. */
export function parseNoteBlocks(raw: string | null | undefined): NoteBlock[] | null {
  if (!raw) return null
  try {
    return validateNoteBlocks(JSON.parse(raw))
  } catch {
    return null
  }
}

export function serializeNoteBlocks(blocks: NoteBlock[]): string {
  return JSON.stringify(blocks)
}

/** The FTS-facing plaintext: text blocks in document order. */
export function deriveNoteBodyText(blocks: NoteBlock[]): string {
  return blocks
    .filter((block): block is NoteTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
}

/* —— Per-note ink overlay (R2) ——
 * Draw anywhere ON the document: one stroke set per note in document
 * coordinates (CSS px from the document column's top-left at `width`).
 * Rendering scales strokes by liveWidth/width so ink stays anchored to the
 * paper when the column resizes. Same N3 stroke format as sketches. */

export const NOTE_INK_VERSION = 1

export const NOTE_INK_MAX_WIDTH = 4096

/** Document y-extent cap — far past any real note, guards absurd payloads. */
export const NOTE_INK_MAX_HEIGHT = 200_000

export const NOTE_INK_STROKES_MAX_BYTES = 1024 * 1024

export interface NoteInkData {
  version: typeof NOTE_INK_VERSION
  /** Logical document-column width the strokes were recorded against. */
  width: number
  strokes: NoteSketchStroke[]
}

export function validateNoteInkData(value: unknown): NoteInkData | null {
  if (!value || typeof value !== 'object') return null
  const data = value as { version?: unknown; width?: unknown; strokes?: unknown }
  if (data.version !== NOTE_INK_VERSION) return null
  if (
    typeof data.width !== 'number' ||
    !Number.isInteger(data.width) ||
    data.width <= 0 ||
    data.width > NOTE_INK_MAX_WIDTH
  ) {
    return null
  }
  if (!Array.isArray(data.strokes)) return null
  const strokes: NoteSketchStroke[] = []
  for (const entry of data.strokes) {
    const stroke = validateNoteSketchStroke(entry)
    if (!stroke) return null
    for (let i = 0; i < stroke.points.length; i += 3) {
      if (stroke.points[i + 1] < -NOTE_INK_MAX_HEIGHT || stroke.points[i + 1] > NOTE_INK_MAX_HEIGHT) {
        return null
      }
    }
    strokes.push(stroke)
  }
  return { version: NOTE_INK_VERSION, width: data.width, strokes }
}

export function parseNoteInkData(raw: string | null | undefined): NoteInkData | null {
  if (!raw) return null
  try {
    return validateNoteInkData(JSON.parse(raw))
  } catch {
    return null
  }
}

export function serializeNoteInkData(data: NoteInkData): string {
  return JSON.stringify(data)
}

export interface NoteAttachmentRecord {
  id: string
  noteId: string
  filename: string
  mime: NoteAttachmentMime
  byteSize: number
  createdAt: string
  url: string
  style: NoteAttachmentStyle
  /** Present only for sketches — the editable stroke source the PNG was baked from. */
  sketch: NoteSketchData | null
}

export interface CreateNoteAttachmentInput {
  noteId: string
  filename: string
  bytes: Uint8Array
  sketch?: NoteSketchData
}

export interface UpdateNoteSketchInput {
  bytes: Uint8Array
  sketch: NoteSketchData
}

export interface UpdateNoteAttachmentInput {
  shape?: NoteAttachmentShape
  size?: NoteAttachmentSize
}

export function parseNoteAttachmentStyle(raw: string | null | undefined): NoteAttachmentStyle {
  if (!raw) return DEFAULT_NOTE_ATTACHMENT_STYLE
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return DEFAULT_NOTE_ATTACHMENT_STYLE
    const record = parsed as { shape?: unknown; size?: unknown }
    return {
      shape: NOTE_ATTACHMENT_SHAPES.includes(record.shape as NoteAttachmentShape)
        ? (record.shape as NoteAttachmentShape)
        : DEFAULT_NOTE_ATTACHMENT_STYLE.shape,
      size: NOTE_ATTACHMENT_SIZES.includes(record.size as NoteAttachmentSize)
        ? (record.size as NoteAttachmentSize)
        : DEFAULT_NOTE_ATTACHMENT_STYLE.size
    }
  } catch {
    return DEFAULT_NOTE_ATTACHMENT_STYLE
  }
}

export function serializeNoteAttachmentStyle(style: NoteAttachmentStyle): string {
  return JSON.stringify(style)
}

export function mergeNoteAttachmentStyle(
  current: NoteAttachmentStyle,
  patch: UpdateNoteAttachmentInput
): NoteAttachmentStyle {
  return {
    shape: patch.shape ?? current.shape,
    size: patch.size ?? current.size
  }
}

export interface NotesDoorSnapshot {
  pinnedNote: { id: string; title: string } | null
  openTaskCount: number
  lastEdited: { id: string; title: string; updatedAt: string } | null
  checklistProgress: { done: number; total: number; noteTitle: string } | null
}

export function noteDisplayTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed || 'Untitled'
}

export function formatOpenTasksLine(openCount: number): string {
  if (openCount <= 0) return 'No open tasks'
  return openCount === 1 ? '1 open task' : `${openCount} open tasks`
}

/**
 * Compact Apple-Notes-style dateline for a board card: time for today,
 * "Yesterday", weekday within the week, else a short date (year only if not
 * this year). Empty string for an unparseable timestamp.
 */
export function formatNoteCardDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (dayDiff <= 0) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  }).format(date)
}

export function parseNoteTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

export function serializeNoteTags(tags: string[]): string {
  return JSON.stringify(tags.filter((tag) => tag.trim().length > 0))
}

export function noteHasTag(note: Pick<NoteRecord, 'tags'>, tag: string): boolean {
  return note.tags.includes(tag)
}
