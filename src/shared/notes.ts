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
  body?: string
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
