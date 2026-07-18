import '../NotesPage.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  NoteAttachmentRecord,
  NoteBlock,
  NoteFolderRecord,
  NoteImageBlock,
  NoteInkData,
  NoteRecord,
  NoteSketchBlock,
  NoteSketchColor,
  NoteSketchData,
  NoteSketchStrokeWidth,
  NoteSketchTool,
  NoteTaskRecord,
  UpdateNoteAttachmentInput
} from '@shared/notes'
import {
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_SKETCH_COLORS,
  NOTE_SKETCH_STROKE_WIDTHS,
  formatNoteCardDate,
  noteDisplayTitle
} from '@shared/notes'
import { MODULE_VISUAL } from '@shared/modules'
import { MossModal } from '../components/MossModal'
import { MossConfirmDialog } from '../components/MossConfirmDialog'
import { NoteSketchPad } from '../components/NoteSketchPad'
import { NoteImageBlockView, NoteSketchBlockView } from '../components/NoteBlocks'
import type { NoteInkLayerHandle } from '../components/NoteInkLayer'
import { NoteInkLayer } from '../components/NoteInkLayer'
import { INK_COLOR_LABELS, INK_WIDTH_LABELS, resolveSketchPalette } from '../lib/inkCanvas'
import { MossButton } from '../components/MossButton'
import { MossToolbar } from '../components/MossToolbar'
import { MossSelect } from '../components/MossSelect'
import { MossEmptyState } from '../components/MossEmptyState'
import { MossCheckbox } from '../components/MossCheckbox'

/**
 * The Notes workspace, rebuilt on the Apple Notes document model (R1):
 * folder rail · note list · the open document. Two nouns — folders and notes.
 * Text, images, checklists, and ink all live INSIDE the one document: images
 * are inline blocks at their insert position, drawing is a scroll-anchored
 * overlay on the page (R2), never a separate surface you navigate to.
 *
 * The autosave contract is the hardest-won piece of this module and carries
 * over verbatim: 450ms debounced saves through one pending ref, flushed
 * before every mutation and refetch so a stale read never clobbers a draft
 * (2026-06-29 audit; QA2-03).
 */

function textBlock(text: string): NoteBlock {
  return { id: crypto.randomUUID(), type: 'text', text }
}

function noteListPreview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** An editable document always has a text block to type into, first and last. */
function normalizeBlocksForEdit(blocks: NoteBlock[] | undefined): NoteBlock[] {
  const next = blocks && blocks.length > 0 ? [...blocks] : [textBlock('')]
  if (next[0].type !== 'text') next.unshift(textBlock(''))
  if (next[next.length - 1].type !== 'text') next.push(textBlock(''))
  return next
}

interface CaretPosition {
  blockId: string
  offset: number
}

/**
 * Insert blocks at the caret: the focused text block splits around the
 * insertion (image lands AT the cursor, like a PDF); no caret means the
 * document's tail. Returns the id of the text block to focus afterwards.
 */
function insertBlocksAtCaret(
  blocks: NoteBlock[],
  caret: CaretPosition | null,
  inserts: NoteBlock[]
): { next: NoteBlock[]; focusId: string } {
  const index = caret ? blocks.findIndex((b) => b.id === caret.blockId && b.type === 'text') : -1
  if (index === -1) {
    const tail = textBlock('')
    const last = blocks[blocks.length - 1]
    if (last && last.type === 'text' && last.text.trim() === '') {
      return {
        next: [...blocks.slice(0, -1), ...inserts, last],
        focusId: last.id
      }
    }
    return { next: [...blocks, ...inserts, tail], focusId: tail.id }
  }
  const target = blocks[index] as Extract<NoteBlock, { type: 'text' }>
  const offset = Math.min(caret?.offset ?? target.text.length, target.text.length)
  const before: NoteBlock = { ...target, text: target.text.slice(0, offset) }
  const after = textBlock(target.text.slice(offset))
  return {
    next: [...blocks.slice(0, index), before, ...inserts, after, ...blocks.slice(index + 1)],
    focusId: after.id
  }
}

type SketchEditorState =
  | { mode: 'new' }
  | { mode: 'edit-attachment'; attachment: NoteAttachmentRecord }
  | { mode: 'edit-block'; block: NoteSketchBlock }
  | null

type PendingSave = {
  noteId: string
  title?: string
  blocks?: NoteBlock[]
  ink?: NoteInkData
}

export function NotesPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.notes
  const queryClient = useQueryClient()
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [blocksDraft, setBlocksDraft] = useState<NoteBlock[]>([])
  const [newTaskLabel, setNewTaskLabel] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [folderModal, setFolderModal] = useState<
    { mode: 'create' } | { mode: 'rename'; folder: NoteFolderRecord } | null
  >(null)
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<NoteFolderRecord | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [sketchEditor, setSketchEditor] = useState<SketchEditorState>(null)
  const [sketchRevs, setSketchRevs] = useState<Record<string, number>>({})

  // R2 pen state — the toolbar lives on the document, the strokes on the overlay.
  const [penActive, setPenActive] = useState(false)
  const [inkTool, setInkTool] = useState<NoteSketchTool>('pen')
  const [inkColor, setInkColor] = useState<NoteSketchColor>('ink')
  const [inkWidth, setInkWidth] = useState<NoteSketchStrokeWidth>(4)
  const [inkStrokeCount, setInkStrokeCount] = useState(0)

  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const focusTitleForNoteRef = useRef<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const blockRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const caretRef = useRef<CaretPosition | null>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const inkLayerRef = useRef<NoteInkLayerHandle | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<PendingSave | null>(null)

  const inkPalette = useMemo(resolveSketchPalette, [])
  const bridgeReady = Boolean(window.moss?.notes)

  const foldersQuery = useQuery({
    queryKey: ['notes', 'folders'],
    queryFn: () => window.moss.notes.listFolders(),
    enabled: bridgeReady
  })

  const trimmedQuery = searchQuery.trim()
  const notesQuery = useQuery({
    queryKey: ['notes', 'list', trimmedQuery, selectedFolderId],
    queryFn: () =>
      trimmedQuery
        ? window.moss.notes.search(trimmedQuery)
        : selectedFolderId
          ? window.moss.notes.listNotes(selectedFolderId)
          : window.moss.notes.listNotes(),
    enabled: bridgeReady
  })

  const activeNoteQuery = useQuery({
    queryKey: ['notes', 'note', selectedNoteId],
    queryFn: async () => {
      const note = await window.moss.notes.getNote(selectedNoteId as string)
      if (!note) return { note: null, tasks: [] as NoteTaskRecord[] }
      const tasks = note.isChecklistMode ? await window.moss.notes.listTasks(note.id) : []
      return { note, tasks }
    },
    enabled: bridgeReady && Boolean(selectedNoteId),
    // Keep the previous note on screen while the next loads — no empty-editor flash.
    placeholderData: (prev) => prev
  })

  const attachmentsQuery = useQuery({
    queryKey: ['notes', 'attachments', selectedNoteId],
    queryFn: () => window.moss.notes.listAttachments(selectedNoteId as string),
    enabled: bridgeReady && Boolean(selectedNoteId)
  })

  const folders = foldersQuery.data ?? []
  const notes = notesQuery.data ?? []
  const activeNote = selectedNoteId ? (activeNoteQuery.data?.note ?? null) : null
  const tasks = selectedNoteId ? (activeNoteQuery.data?.tasks ?? []) : []
  const attachments = selectedNoteId ? (attachmentsQuery.data ?? []) : []
  const attachmentsById = useMemo(() => {
    const map = new Map<string, NoteAttachmentRecord>()
    for (const attachment of attachments) map.set(attachment.id, attachment)
    return map
  }, [attachments])

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  )

  // The overlay reseeds only on a note switch — a refetch mid-session must
  // never replace live strokes with a stale DB read.
  const activeNoteId = activeNote?.id ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialInk = useMemo(() => activeNote?.ink ?? null, [activeNoteId])

  const loadError = foldersQuery.error ?? notesQuery.error ?? activeNoteQuery.error
  const queryError = !bridgeReady
    ? 'Notes storage unavailable'
    : loadError
      ? loadError instanceof Error
        ? loadError.message
        : 'Failed to load notes'
      : null
  const error = mutationError ?? queryError

  // A sketch pad or pen session belongs to the note it was opened from.
  useEffect(() => {
    setSketchEditor(null)
    setPenActive(false)
    setInkTool('pen')
  }, [selectedNoteId])

  useEffect(() => {
    setInkStrokeCount(initialInk?.strokes.length ?? 0)
  }, [initialInk])

  // Persist any debounced edit immediately. Called before mutations and refreshes
  // so a refetch never clobbers in-progress drafts with a stale DB value.
  const flushPendingSave = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingSaveRef.current
    if (!pending) return
    pendingSaveRef.current = null
    try {
      await window.moss.notes.updateNote(pending.noteId, {
        ...(pending.title !== undefined ? { title: pending.title } : {}),
        ...(pending.blocks !== undefined ? { blocks: pending.blocks } : {}),
        ...(pending.ink !== undefined ? { ink: pending.ink } : {})
      })
      await queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to save note')
    }
  }, [queryClient])

  // Mirror the fetched note into the editor drafts — but never over a pending
  // (still-debounced) edit to the same note.
  useEffect(() => {
    if (activeNote) {
      if (pendingSaveRef.current?.noteId === activeNote.id) return
      setTitleDraft(activeNote.title)
      setBlocksDraft(normalizeBlocksForEdit(activeNote.blocks))
    } else {
      setTitleDraft('')
      setBlocksDraft([])
    }
  }, [activeNote])

  async function runMutation(task: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await flushPendingSave()
      await task()
      await queryClient.invalidateQueries({ queryKey: ['notes'] })
      setMutationError(null)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const scheduleSave = useCallback(
    (noteId: string, patch: Omit<PendingSave, 'noteId'>): void => {
      const pending = pendingSaveRef.current
      pendingSaveRef.current =
        pending && pending.noteId === noteId
          ? { ...pending, ...patch }
          : { noteId, ...patch }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = window.setTimeout(() => {
        void flushPendingSave()
      }, 450)
    },
    [flushPendingSave]
  )

  // Flush a pending draft when leaving the page or switching context,
  // so a quick navigate-away never drops the last keystrokes (or strokes).
  useEffect(
    () => () => {
      void flushPendingSave()
    },
    [flushPendingSave]
  )

  useEffect(() => {
    if (activeNote && focusTitleForNoteRef.current === activeNote.id) {
      focusTitleForNoteRef.current = null
      titleInputRef.current?.focus()
    }
  }, [activeNote])

  // Focus the text block created by an image/sketch insert once it renders.
  useEffect(() => {
    const target = pendingFocusRef.current
    if (!target) return
    pendingFocusRef.current = null
    window.requestAnimationFrame(() => {
      const node = blockRefs.current.get(target)
      if (node) {
        node.focus()
        node.setSelectionRange(0, 0)
      }
    })
  }, [blocksDraft])

  // Escape walks out one layer at a time: sketch pad → pen mode. Dialogs own their own Escape.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (deleteConfirmOpen || deleteFolderTarget || folderModal) return
      if (sketchEditor) {
        setSketchEditor(null)
        return
      }
      if (penActive) {
        setPenActive(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteConfirmOpen, deleteFolderTarget, folderModal, sketchEditor, penActive])

  function setBlocksAndSave(noteId: string, next: NoteBlock[]): void {
    setBlocksDraft(next)
    scheduleSave(noteId, { title: titleDraft, blocks: next })
  }

  async function handleCreateNote(): Promise<void> {
    await runMutation(async () => {
      const note = await window.moss.notes.createNote({
        folderId: trimmedQuery ? undefined : (selectedFolderId ?? undefined)
      })
      // A fresh note means the user is about to type — put the caret in the
      // title so "New note" → type just works (focused once it renders below).
      focusTitleForNoteRef.current = note.id
      setSearchQuery('')
      setSelectedNoteId(note.id)
    })
  }

  async function handleFolderModalConfirmed(): Promise<void> {
    const name = folderNameDraft.trim()
    const modal = folderModal
    if (!name || !modal) return
    setFolderModal(null)
    setFolderNameDraft('')
    await runMutation(async () => {
      if (modal.mode === 'create') {
        const folder = await window.moss.notes.createFolder({ name })
        setSelectedFolderId(folder.id)
        setSearchQuery('')
      } else {
        await window.moss.notes.renameFolder(modal.folder.id, name)
      }
    })
  }

  async function handleDeleteFolderConfirmed(): Promise<void> {
    const target = deleteFolderTarget
    if (!target) return
    setDeleteFolderTarget(null)
    await runMutation(async () => {
      await window.moss.notes.deleteFolder(target.id)
      setSelectedFolderId(null)
    })
  }

  async function handleDeleteNoteConfirmed(): Promise<void> {
    if (!activeNote) return
    const noteId = activeNote.id
    setDeleteConfirmOpen(false)
    await runMutation(async () => {
      await window.moss.notes.deleteNote(noteId)
      setSelectedNoteId(null)
    })
  }

  async function handleTogglePin(): Promise<void> {
    if (!activeNote) return
    await runMutation(async () => {
      await window.moss.notes.setPin(activeNote.id, !activeNote.isPinned)
    })
  }

  async function handleToggleChecklistMode(): Promise<void> {
    if (!activeNote) return
    await runMutation(async () => {
      await window.moss.notes.updateNote(activeNote.id, {
        isChecklistMode: !activeNote.isChecklistMode
      })
    })
  }

  async function handleMoveToFolder(folderId: string): Promise<void> {
    if (!activeNote || folderId === activeNote.folderId) return
    await runMutation(async () => {
      await window.moss.notes.updateNote(activeNote.id, { folderId })
    })
  }

  async function handleAddTask(): Promise<void> {
    if (!activeNote || !newTaskLabel.trim()) return
    await runMutation(async () => {
      await window.moss.notes.createTask({
        noteId: activeNote.id,
        label: newTaskLabel.trim()
      })
      setNewTaskLabel('')
    })
  }

  async function handleToggleTask(taskId: string): Promise<void> {
    await runMutation(async () => {
      await window.moss.notes.toggleTask(taskId)
    })
  }

  async function handleDeleteTask(taskId: string): Promise<void> {
    await runMutation(async () => {
      await window.moss.notes.deleteTask(taskId)
    })
  }

  /** Images land AT the caret as inline blocks — the point of the rebuild. */
  async function handleAddImages(files: File[]): Promise<void> {
    if (!activeNote) return
    const note = activeNote
    const images = files.filter((file) => !file.type || file.type.startsWith('image/'))
    if (images.length === 0) {
      setMutationError('Only PNG, JPEG, GIF, or WebP images can be added')
      return
    }
    const caret = caretRef.current
    const draft = blocksDraft
    await runMutation(async () => {
      const inserts: NoteBlock[] = []
      for (const file of images) {
        if (file.size > NOTE_ATTACHMENT_MAX_BYTES) {
          throw new Error(`“${file.name || 'Image'}” is over the 10 MB image limit`)
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        const attachment = await window.moss.notes.createAttachment({
          noteId: note.id,
          filename: file.name || 'Pasted image',
          bytes
        })
        inserts.push({ id: crypto.randomUUID(), type: 'image', attachmentId: attachment.id })
      }
      const { next, focusId } = insertBlocksAtCaret(draft, caret, inserts)
      await window.moss.notes.updateNote(note.id, { title: titleDraft, blocks: next })
      setBlocksDraft(next)
      pendingFocusRef.current = focusId
    })
  }

  async function handleSketchSave(sketch: NoteSketchData, png: Uint8Array): Promise<void> {
    const editor = sketchEditor
    if (!editor || !activeNote) return
    const note = activeNote
    const caret = caretRef.current
    const draft = blocksDraft
    await runMutation(async () => {
      if (editor.mode === 'edit-attachment') {
        await window.moss.notes.updateSketch(editor.attachment.id, { bytes: png, sketch })
        setSketchRevs((prev) => ({
          ...prev,
          [editor.attachment.id]: (prev[editor.attachment.id] ?? 0) + 1
        }))
      } else if (editor.mode === 'edit-block') {
        // Migrated board drawing: editing bakes it into a real sketch
        // attachment and the block upgrades to a normal image block.
        const attachment = await window.moss.notes.createAttachment({
          noteId: note.id,
          filename: 'Sketch.png',
          bytes: png,
          sketch
        })
        const next = draft.map((block): NoteBlock =>
          block.id === editor.block.id
            ? { id: block.id, type: 'image', attachmentId: attachment.id }
            : block
        )
        await window.moss.notes.updateNote(note.id, { title: titleDraft, blocks: next })
        setBlocksDraft(next)
      } else {
        const attachment = await window.moss.notes.createAttachment({
          noteId: note.id,
          filename: 'Sketch.png',
          bytes: png,
          sketch
        })
        const insert: NoteBlock = {
          id: crypto.randomUUID(),
          type: 'image',
          attachmentId: attachment.id
        }
        const { next, focusId } = insertBlocksAtCaret(draft, caret, [insert])
        await window.moss.notes.updateNote(note.id, { title: titleDraft, blocks: next })
        setBlocksDraft(next)
        pendingFocusRef.current = focusId
      }
      setSketchEditor(null)
    })
  }

  async function handleRemoveImageBlock(block: NoteImageBlock): Promise<void> {
    if (!activeNote) return
    const note = activeNote
    const draft = blocksDraft
    const owned = attachmentsById.get(block.attachmentId)
    await runMutation(async () => {
      const next = draft.filter((entry) => entry.id !== block.id)
      await window.moss.notes.updateNote(note.id, { title: titleDraft, blocks: next })
      if (owned) {
        await window.moss.notes.deleteAttachment(owned.id)
      }
      setBlocksDraft(normalizeBlocksForEdit(next))
    })
  }

  async function handleRemoveSketchBlock(block: NoteSketchBlock): Promise<void> {
    if (!activeNote) return
    const note = activeNote
    const draft = blocksDraft
    await runMutation(async () => {
      const next = draft.filter((entry) => entry.id !== block.id)
      await window.moss.notes.updateNote(note.id, { title: titleDraft, blocks: next })
      setBlocksDraft(normalizeBlocksForEdit(next))
    })
  }

  async function handleAttachmentStyleChange(
    attachmentId: string,
    patch: UpdateNoteAttachmentInput
  ): Promise<void> {
    await runMutation(async () => {
      await window.moss.notes.updateAttachment(attachmentId, patch)
    })
  }

  function handleTextBlockChange(blockId: string, text: string): void {
    if (!activeNote) return
    const next = blocksDraft.map((block) =>
      block.id === blockId && block.type === 'text' ? { ...block, text } : block
    )
    setBlocksAndSave(activeNote.id, next)
  }

  /** Backspace at a block boundary stitches split paragraphs back together. */
  function handleTextBlockKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    blockId: string
  ): void {
    if (event.key !== 'Backspace' || !activeNote) return
    const node = event.currentTarget
    if (node.selectionStart !== 0 || node.selectionEnd !== 0) return
    const index = blocksDraft.findIndex((block) => block.id === blockId)
    if (index <= 0) return
    const previous = blocksDraft[index - 1]
    const current = blocksDraft[index]
    if (previous.type !== 'text' || current.type !== 'text') return
    event.preventDefault()
    const joinOffset = previous.text.length
    const merged: NoteBlock = { ...previous, text: previous.text + current.text }
    const next = [
      ...blocksDraft.slice(0, index - 1),
      merged,
      ...blocksDraft.slice(index + 1)
    ]
    setBlocksAndSave(activeNote.id, next)
    window.requestAnimationFrame(() => {
      const target = blockRefs.current.get(previous.id)
      if (target) {
        target.focus()
        target.setSelectionRange(joinOffset, joinOffset)
      }
    })
  }

  function trackCaret(event: React.SyntheticEvent<HTMLTextAreaElement>, blockId: string): void {
    caretRef.current = { blockId, offset: event.currentTarget.selectionStart ?? 0 }
  }

  const handleInkCommit = useCallback(
    (ink: NoteInkData, strokeCount: number): void => {
      if (!activeNoteId) return
      setInkStrokeCount(strokeCount)
      scheduleSave(activeNoteId, { ink })
    },
    [activeNoteId, scheduleSave]
  )

  const handleInkError = useCallback((message: string): void => {
    setMutationError(message)
  }, [])

  const textBlockCount = blocksDraft.filter((block) => block.type === 'text').length
  const hasChecklistBlock = blocksDraft.some((block) => block.type === 'checklist')

  const checklistSection = activeNote?.isChecklistMode ? (
    <div className="notes-checklist">
      <ul className="notes-checklist-list">
        {tasks.map((task) => (
          <li key={task.id} className="notes-checklist-item">
            <MossCheckbox
              className="notes-checklist-row"
              checked={task.isDone}
              onChange={() => void handleToggleTask(task.id)}
              label={
                <span
                  className={[
                    'notes-checklist-label',
                    task.isDone ? 'notes-checklist-label--done' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {task.label}
                </span>
              }
            />
            <MossButton
              variant="icon"
              size="xs"
              tone="neutral"
              subtle
              className="notes-checklist-remove"
              aria-label={`Remove ${task.label}`}
              onClick={() => void handleDeleteTask(task.id)}
            >
              ×
            </MossButton>
          </li>
        ))}
      </ul>
      <form
        className="notes-checklist-add"
        onSubmit={(event) => {
          event.preventDefault()
          void handleAddTask()
        }}
      >
        <input
          className="preference-input"
          value={newTaskLabel}
          placeholder="Add checklist item"
          aria-label="New checklist item"
          onChange={(event) => setNewTaskLabel(event.target.value)}
        />
        <MossButton
          type="submit"
          size="sm"
          disabled={busy || !newTaskLabel.trim()}
        >
          Add
        </MossButton>
      </form>
    </div>
  ) : null

  function renderBlock(block: NoteBlock, index: number): React.JSX.Element | null {
    if (block.type === 'text') {
      const isOnlyText = textBlockCount === 1 && blocksDraft.length === 1
      return (
        <textarea
          key={block.id}
          ref={(node) => {
            if (node) blockRefs.current.set(block.id, node)
            else blockRefs.current.delete(block.id)
          }}
          className={['notes-body-input', 'notes-block-text', isOnlyText ? 'notes-block-text--solo' : '']
            .filter(Boolean)
            .join(' ')}
          value={block.text}
          placeholder={isOnlyText && index === 0 ? 'Write your note… drop or paste images anytime' : undefined}
          aria-label="Note text"
          readOnly={penActive}
          onChange={(event) => handleTextBlockChange(block.id, event.target.value)}
          onKeyDown={(event) => handleTextBlockKeyDown(event, block.id)}
          onSelect={(event) => trackCaret(event, block.id)}
          onFocus={(event) => trackCaret(event, block.id)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.items ?? [])
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file))
            if (files.length === 0) return
            event.preventDefault()
            void handleAddImages(files)
          }}
        />
      )
    }
    if (block.type === 'image') {
      return (
        <NoteImageBlockView
          key={block.id}
          block={block}
          attachment={attachmentsById.get(block.attachmentId) ?? null}
          busy={busy}
          sketchRev={sketchRevs[block.attachmentId] ?? 0}
          sketchPadOpen={sketchEditor !== null}
          onRemove={(target) => void handleRemoveImageBlock(target)}
          onStyleChange={(attachmentId, patch) =>
            void handleAttachmentStyleChange(attachmentId, patch)
          }
          onEditSketch={(attachment) => setSketchEditor({ mode: 'edit-attachment', attachment })}
        />
      )
    }
    if (block.type === 'sketch') {
      return (
        <NoteSketchBlockView
          key={block.id}
          block={block}
          busy={busy}
          sketchPadOpen={sketchEditor !== null}
          onEdit={(target) => setSketchEditor({ mode: 'edit-block', block: target })}
          onRemove={(target) => void handleRemoveSketchBlock(target)}
        />
      )
    }
    // Checklist marker block: the task list renders at its document position.
    return <div key={block.id}>{checklistSection}</div>
  }

  return (
    <div
      className="moss-arrival moss-arrival-notes"
      data-module="notes"
      data-texture={visual.texture}
    >
      <header className="moss-arrival-band notes-arrival-band">
        <div className="moss-arrival-band-inner module-arrival-head notes-arrival-head">
          <div className="module-arrival-title-block">
            <p className="notes-arrival-kicker">{visual.tag}</p>
            <h1 className="display-arrival">Notes</h1>
          </div>
          <div className="notes-arrival-actions">
            {notes.length > 0 && (
              <MossButton
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void handleCreateNote()}
              >
                New note
              </MossButton>
            )}
          </div>
        </div>
      </header>

      <div className="moss-arrival-body notes-arrival-body">
        {error && (
          <div className="error-banner">
            <p className="text-sm text-signal-error-text">{error}</p>
          </div>
        )}

        <div className="notes-layout">
          {/* — Pane 1: folder rail — */}
          <aside className="notes-folder-rail" aria-label="Folders">
            <div className="notes-sidebar-head">
              <span className="notes-sidebar-label nutrition-mono">Folders</span>
              <MossButton
                variant="icon"
                size="xs"
                tone="neutral"
                subtle
                aria-label="New folder"
                title="New folder"
                disabled={busy}
                onClick={() => {
                  setFolderNameDraft('')
                  setFolderModal({ mode: 'create' })
                }}
              >
                +
              </MossButton>
            </div>
            <div className="notes-folder-list">
              <button
                type="button"
                className={[
                  'notes-folder-btn',
                  selectedFolderId === null ? 'notes-folder-btn--active' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setSelectedFolderId(null)
                  setSearchQuery('')
                }}
              >
                All notes
              </button>
              {folders.map((folder) => (
                <div key={folder.id} className="notes-folder-row">
                  <button
                    type="button"
                    className={[
                      'notes-folder-btn',
                      folder.id === selectedFolderId ? 'notes-folder-btn--active' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      setSelectedFolderId(folder.id)
                      setSearchQuery('')
                    }}
                  >
                    {folder.name}
                  </button>
                  {folder.id !== 'default-notes-folder' && (
                    <span className="notes-folder-tools">
                      <MossButton
                        variant="icon"
                        size="xs"
                        tone="neutral"
                        aria-label={`Rename ${folder.name}`}
                        title="Rename folder"
                        disabled={busy}
                        onClick={() => {
                          setFolderNameDraft(folder.name)
                          setFolderModal({ mode: 'rename', folder })
                        }}
                      >
                        ✎
                      </MossButton>
                      <MossButton
                        variant="icon"
                        size="xs"
                        tone="neutral"
                        aria-label={`Delete ${folder.name}`}
                        title="Delete folder"
                        disabled={busy}
                        onClick={() => setDeleteFolderTarget(folder)}
                      >
                        ×
                      </MossButton>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* — Pane 2: note list — */}
          <aside className="notes-list-pane" aria-label="Notes">
            <div className="notes-sidebar-search">
              <input
                className="preference-input"
                type="search"
                placeholder="Search notes"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search notes"
              />
            </div>
            <div className="notes-sidebar-head">
              <p className="notes-sidebar-label nutrition-mono">
                {trimmedQuery ? 'Results' : selectedFolder ? selectedFolder.name : 'All notes'}
              </p>
              {!trimmedQuery && notes.length > 0 && (
                <MossButton
                  variant="icon"
                  size="xs"
                  tone="neutral"
                  subtle
                  aria-label="New note"
                  title="New note"
                  disabled={busy}
                  onClick={() => void handleCreateNote()}
                >
                  +
                </MossButton>
              )}
            </div>
            <div className="notes-list" role="list">
              {notes.length === 0 ? (
                <p className="notes-empty-copy notes-empty-copy--list">
                  {trimmedQuery ? 'No notes match this search.' : 'Your notes will appear here.'}
                </p>
              ) : (
                notes.map((note: NoteRecord) => (
                  <button
                    key={note.id}
                    type="button"
                    role="listitem"
                    className={[
                      'notes-row',
                      note.id === selectedNoteId ? 'notes-row--active' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      void flushPendingSave()
                      setSelectedNoteId(note.id)
                    }}
                  >
                    <span className="notes-row-head">
                      {note.isPinned && <span className="notes-row-pin" aria-label="Pinned" />}
                      <span className="notes-row-title">{noteDisplayTitle(note.title)}</span>
                      <span className="notes-row-date nutrition-mono">
                        {formatNoteCardDate(note.updatedAt)}
                      </span>
                    </span>
                    <span className="notes-row-preview">
                      {noteListPreview(note.body) ||
                        (note.isChecklistMode ? 'Checklist' : 'Empty note')}
                      {note.isChecklistMode && note.openTaskCount !== undefined
                        ? ` · ${note.openTaskCount} open`
                        : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* — Pane 3: the open document — */}
          <section
            className={['notes-editor', dropActive ? 'notes-editor--dropping' : '']
              .filter(Boolean)
              .join(' ')}
            aria-label="Note editor"
            onDragOver={(event) => {
              if (!activeNote || !event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              setDropActive(true)
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setDropActive(false)
            }}
            onDrop={(event) => {
              setDropActive(false)
              if (!activeNote || event.dataTransfer.files.length === 0) return
              event.preventDefault()
              void handleAddImages(Array.from(event.dataTransfer.files))
            }}
          >
            {!activeNote ? (
              <div className="notes-editor-empty">
                <MossEmptyState
                  className="notes-first-run"
                  kicker="Notes"
                  title="A clear place for what you want to keep"
                  body="Capture a thought, build a checklist, add an image, or draw right on the page. Everything stays organized in folders on this computer."
                  action={{
                    label: 'Create your first note',
                    variant: 'primary',
                    disabled: busy,
                    onClick: () => void handleCreateNote()
                  }}
                />
              </div>
            ) : (
              <>
                <header className="notes-editor-head">
                  <input
                    ref={titleInputRef}
                    className="notes-title-input display-arrival"
                    value={titleDraft}
                    placeholder="Title"
                    aria-label="Note title"
                    disabled={penActive}
                    onChange={(event) => {
                      const next = event.target.value
                      setTitleDraft(next)
                      scheduleSave(activeNote.id, { title: next, blocks: blocksDraft })
                    }}
                    onKeyDown={(event) => {
                      // Enter flows into the body, like every notes app.
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        const first = blocksDraft.find((block) => block.type === 'text')
                        if (first) blockRefs.current.get(first.id)?.focus()
                      }
                    }}
                  />
                  <MossToolbar
                    label="Note editor"
                    tone="document"
                    className="notes-editor-toolbar"
                  >
                    <MossToolbar.Group label="Note options">
                      <MossButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleTogglePin()}
                      >
                        {activeNote.isPinned ? 'Unpin' : 'Pin'}
                      </MossButton>
                      <MossButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        pressed={activeNote.isChecklistMode}
                        disabled={busy}
                        onClick={() => void handleToggleChecklistMode()}
                      >
                        Checklist
                      </MossButton>
                    </MossToolbar.Group>
                    <MossToolbar.Group label="Insert">
                      <MossButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        disabled={busy || penActive}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        Add image
                      </MossButton>
                      <MossButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        pressed={penActive}
                        disabled={busy || sketchEditor !== null}
                        onClick={() => setPenActive((current) => !current)}
                      >
                        Draw
                      </MossButton>
                    </MossToolbar.Group>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      multiple
                      hidden
                      aria-hidden
                      tabIndex={-1}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? [])
                        event.target.value = ''
                        if (files.length > 0) void handleAddImages(files)
                      }}
                    />
                    <MossToolbar.Group label="Folder" className="notes-toolbar-group--folder">
                      <div className="notes-folder-move">
                        <span className="notes-sidebar-label nutrition-mono">Folder</span>
                        <MossSelect
                          className="notes-folder-select"
                          value={activeNote.folderId}
                          options={folders.map((folder) => ({
                            value: folder.id,
                            label: folder.name
                          }))}
                          ariaLabel="Move note to folder"
                          disabled={busy || penActive}
                          onChange={(folderId) => void handleMoveToFolder(folderId)}
                        />
                      </div>
                    </MossToolbar.Group>
                    <MossButton
                      type="button"
                      variant="quiet"
                      size="sm"
                      className="notes-toolbar-delete"
                      disabled={busy}
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Delete
                    </MossButton>
                  </MossToolbar>

                  {penActive && (
                    <MossToolbar className="notes-ink-toolbar" label="Drawing tools">
                      <div className="notes-ink-toolbar-inner">
                        <MossToolbar.Group label="Tool">
                          {(['pen', 'eraser'] as const).map((entry) => (
                            <button
                              key={entry}
                              type="button"
                              className={[
                                'notes-attachment-style-btn',
                                inkTool === entry ? 'notes-attachment-style-btn--active' : ''
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              aria-pressed={inkTool === entry}
                              disabled={busy}
                              onClick={() => setInkTool(entry)}
                            >
                              {entry === 'pen' ? 'Pen' : 'Eraser'}
                            </button>
                          ))}
                        </MossToolbar.Group>
                        <MossToolbar.Group label="Stroke width">
                          {NOTE_SKETCH_STROKE_WIDTHS.map((width) => (
                            <button
                              key={width}
                              type="button"
                              className={[
                                'notes-attachment-style-btn',
                                inkWidth === width ? 'notes-attachment-style-btn--active' : ''
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              aria-pressed={inkWidth === width}
                              disabled={busy}
                              onClick={() => setInkWidth(width)}
                            >
                              {INK_WIDTH_LABELS[width]}
                            </button>
                          ))}
                        </MossToolbar.Group>
                        <MossToolbar.Group label="Ink color">
                          {NOTE_SKETCH_COLORS.map((entry) => (
                            <button
                              key={entry}
                              type="button"
                              className={[
                                'notes-sketch-swatch',
                                inkColor === entry ? 'notes-sketch-swatch--active' : ''
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{ background: inkPalette[entry] }}
                              aria-pressed={inkColor === entry}
                              aria-label={`${INK_COLOR_LABELS[entry]} ink`}
                              title={INK_COLOR_LABELS[entry]}
                              disabled={busy || inkTool === 'eraser'}
                              onClick={() => setInkColor(entry)}
                            />
                          ))}
                        </MossToolbar.Group>
                        <MossToolbar.Group label="Ink history">
                          <MossButton
                            variant="quiet"
                            size="xs"
                            disabled={busy || inkStrokeCount === 0}
                            onClick={() => inkLayerRef.current?.undo()}
                          >
                            Undo
                          </MossButton>
                          <MossButton
                            variant="quiet"
                            size="xs"
                            disabled={busy || inkStrokeCount === 0}
                            onClick={() => inkLayerRef.current?.clear()}
                          >
                            Clear
                          </MossButton>
                        </MossToolbar.Group>
                      </div>
                      <MossButton
                        type="button"
                        size="sm"
                        className="notes-ink-done"
                        onClick={() => setPenActive(false)}
                      >
                        Done
                      </MossButton>
                    </MossToolbar>
                  )}
                </header>

                <div
                  className="notes-doc-scroll"
                  ref={scrollerRef}
                  data-pen={penActive ? '' : undefined}
                >
                  <div className="notes-doc" key={activeNote.id}>
                    <NoteInkLayer
                      ref={inkLayerRef}
                      scrollerRef={scrollerRef}
                      initial={initialInk}
                      penActive={penActive}
                      tool={inkTool}
                      color={inkColor}
                      strokeWidth={inkWidth}
                      busy={busy}
                      onCommit={handleInkCommit}
                      onError={handleInkError}
                    />
                    {!hasChecklistBlock && checklistSection}
                    {blocksDraft.map((block, index) => renderBlock(block, index))}
                  </div>
                </div>

                {sketchEditor && (
                  <NoteSketchPad
                    heading={sketchEditor.mode === 'new' ? 'Draw a sketch' : 'Edit drawing'}
                    initial={
                      sketchEditor.mode === 'edit-attachment'
                        ? sketchEditor.attachment.sketch
                        : sketchEditor.mode === 'edit-block'
                          ? sketchEditor.block.sketch
                          : null
                    }
                    busy={busy}
                    overlay
                    onSave={(sketch, png) => void handleSketchSave(sketch, png)}
                    onCancel={() => setSketchEditor(null)}
                  />
                )}

                {dropActive && (
                  <div className="notes-drop-overlay" aria-hidden>
                    <p className="notes-drop-hint">Drop to add to this note</p>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {folderModal && (
        <MossModal
          onClose={() => setFolderModal(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="notes-folder-modal-title"
        >
          <form
            className="calendar-event-modal"
            onSubmit={(event) => {
              event.preventDefault()
              void handleFolderModalConfirmed()
            }}
          >
            <h2 id="notes-folder-modal-title" className="calendar-event-modal-title">
              {folderModal.mode === 'create' ? 'New folder' : 'Rename folder'}
            </h2>
            <input
              className="preference-input"
              value={folderNameDraft}
              placeholder="Folder name"
              aria-label="Folder name"
              autoFocus
              onChange={(event) => setFolderNameDraft(event.target.value)}
            />
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setFolderModal(null)}
              >
                Cancel
              </MossButton>
              <MossButton
                type="submit"
                size="sm"
                disabled={busy || !folderNameDraft.trim()}
              >
                {folderModal.mode === 'create' ? 'Create folder' : 'Rename'}
              </MossButton>
            </div>
          </form>
        </MossModal>
      )}

      {deleteFolderTarget && (
        <MossConfirmDialog
          title="Delete this folder?"
          body={`Notes in “${deleteFolderTarget.name}” move to your default Notes folder — nothing is deleted with it.`}
          confirmLabel="Delete folder"
          tone="danger"
          busy={busy}
          onConfirm={() => void handleDeleteFolderConfirmed()}
          onClose={() => setDeleteFolderTarget(null)}
        />
      )}

      {deleteConfirmOpen && activeNote && (
        <MossConfirmDialog
          title="Delete this note?"
          body={`“${noteDisplayTitle(activeNote.title)}” and its checklist items will be removed. This can’t be undone.`}
          confirmLabel="Delete note"
          tone="danger"
          busy={busy}
          onConfirm={() => void handleDeleteNoteConfirmed()}
          onClose={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  )
}
