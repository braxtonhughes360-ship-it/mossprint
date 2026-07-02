import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { NoteTaskRecord } from '@shared/notes'
import {
  NOTES_MAINTENANCE_TAG,
  noteDisplayTitle,
  noteHasTag
} from '@shared/notes'
import { MODULE_VISUAL } from '@shared/modules'
import { MossModal } from '../components/MossModal'
import { MossConfirmDialog } from '../components/MossConfirmDialog'

function formatEditedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

export function NotesPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.notes
  const queryClient = useQueryClient()
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [newTaskLabel, setNewTaskLabel] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<{ noteId: string; title: string; body: string } | null>(null)

  const bridgeReady = Boolean(window.moss?.notes)

  const foldersQuery = useQuery({
    queryKey: ['notes', 'folders'],
    queryFn: () => window.moss.notes.listFolders(),
    enabled: bridgeReady
  })

  // Sidebar list — keyed by the active search/folder scope.
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

  const folders = foldersQuery.data ?? []
  const notes = notesQuery.data ?? []
  const activeNote = selectedNoteId ? (activeNoteQuery.data?.note ?? null) : null
  const tasks = selectedNoteId ? (activeNoteQuery.data?.tasks ?? []) : []

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  )

  const loadError = foldersQuery.error ?? notesQuery.error ?? activeNoteQuery.error
  const queryError = !bridgeReady
    ? 'Notes storage unavailable'
    : loadError
      ? loadError instanceof Error
        ? loadError.message
        : 'Failed to load notes'
      : null
  const error = mutationError ?? queryError

  // Default to the first folder once folders arrive.
  useEffect(() => {
    const loaded = foldersQuery.data
    if (!loaded) return
    setSelectedFolderId((current) => current ?? loaded[0]?.id ?? null)
  }, [foldersQuery.data])

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
        title: pending.title,
        body: pending.body
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
      setBodyDraft(activeNote.body)
    } else {
      setTitleDraft('')
      setBodyDraft('')
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

  function scheduleSave(noteId: string, title: string, body: string): void {
    pendingSaveRef.current = { noteId, title, body }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushPendingSave()
    }, 450)
  }

  // Flush a pending draft when leaving the page or switching folder/search context,
  // so a quick navigate-away never drops the last keystrokes.
  useEffect(
    () => () => {
      void flushPendingSave()
    },
    [flushPendingSave]
  )

  async function handleCreateNote(): Promise<void> {
    await runMutation(async () => {
      const note = await window.moss.notes.createNote({
        folderId: selectedFolderId ?? undefined
      })
      setSelectedNoteId(note.id)
    })
  }

  async function handleCreateFolderConfirmed(): Promise<void> {
    const name = folderNameDraft.trim()
    if (!name) return
    setFolderModalOpen(false)
    setFolderNameDraft('')
    await runMutation(async () => {
      const folder = await window.moss.notes.createFolder({ name })
      setSelectedFolderId(folder.id)
      setSearchQuery('')
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

  async function handleToggleMaintenanceTag(): Promise<void> {
    if (!activeNote) return
    const tags = activeNote.tags.includes(NOTES_MAINTENANCE_TAG)
      ? activeNote.tags.filter((tag) => tag !== NOTES_MAINTENANCE_TAG)
      : [...activeNote.tags, NOTES_MAINTENANCE_TAG]
    await runMutation(async () => {
      await window.moss.notes.updateNote(activeNote.id, { tags })
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

  return (
    <div className="moss-arrival moss-arrival-notes" data-module="notes" data-texture={visual.texture}>
      <header className="moss-arrival-band notes-arrival-band">
        <div className="moss-arrival-band-inner module-arrival-head notes-arrival-head">
          <div className="module-arrival-title-block">
            <p className="notes-arrival-kicker">{visual.tag}</p>
            <h1 className="display-arrival">Notes</h1>
          </div>
          <div className="notes-arrival-actions">
            <button
              type="button"
              className="money-button money-button--compact"
              disabled={busy}
              onClick={() => void handleCreateNote()}
            >
              New note
            </button>
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
          <aside className="notes-sidebar" aria-label="Folders and notes">
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

            {!searchQuery.trim() && (
              <div className="notes-folder-list">
                <div className="notes-sidebar-head">
                  <span className="notes-sidebar-label nutrition-mono">Folders</span>
                  <button
                    type="button"
                    className="notes-sidebar-icon-btn"
                    aria-label="Add folder"
                    disabled={busy}
                    onClick={() => {
                      setFolderNameDraft('')
                      setFolderModalOpen(true)
                    }}
                  >
                    +
                  </button>
                </div>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
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
                ))}
              </div>
            )}

            <div className="notes-list">
              <p className="notes-sidebar-label nutrition-mono">
                {searchQuery.trim()
                  ? 'Results'
                  : selectedFolder
                    ? selectedFolder.name
                    : 'All notes'}
              </p>
              {notes.length === 0 ? (
                <p className="notes-empty-copy">No notes yet.</p>
              ) : (
                notes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={[
                      'notes-list-item',
                      note.id === selectedNoteId ? 'notes-list-item--active' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSelectedNoteId(note.id)}
                  >
                    <span className="notes-list-item-title">
                      {note.isPinned && (
                        <span className="notes-list-item-pin nutrition-mono" aria-hidden>
                          Pin ·{' '}
                        </span>
                      )}
                      {noteDisplayTitle(note.title)}
                    </span>
                    <span className="notes-list-item-meta nutrition-mono">
                      {formatEditedAt(note.updatedAt)}
                      {note.isChecklistMode && note.openTaskCount !== undefined
                        ? ` · ${note.openTaskCount} open`
                        : ''}
                      {noteHasTag(note, NOTES_MAINTENANCE_TAG) ? ' · maintenance' : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="notes-editor" aria-label="Note editor">
            {!activeNote ? (
              <div className="notes-editor-empty">
                <p>Select a note or create one to start writing.</p>
              </div>
            ) : (
              <>
                <header className="notes-editor-head">
                  <input
                    className="notes-title-input display-arrival"
                    value={titleDraft}
                    placeholder="Title"
                    aria-label="Note title"
                    onChange={(event) => {
                      const next = event.target.value
                      setTitleDraft(next)
                      scheduleSave(activeNote.id, next, bodyDraft)
                    }}
                  />
                  <div className="notes-editor-toolbar">
                    <button
                      type="button"
                      className="money-button money-button--ghost money-button--compact"
                      disabled={busy}
                      onClick={() => void handleTogglePin()}
                    >
                      {activeNote.isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      className={[
                        'money-button money-button--ghost money-button--compact',
                        noteHasTag(activeNote, NOTES_MAINTENANCE_TAG)
                          ? 'notes-toolbar-btn--active'
                          : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={busy}
                      onClick={() => void handleToggleMaintenanceTag()}
                    >
                      Maintenance
                    </button>
                    <button
                      type="button"
                      className={[
                        'money-button money-button--ghost money-button--compact',
                        activeNote.isChecklistMode ? 'notes-toolbar-btn--active' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={busy}
                      onClick={() => void handleToggleChecklistMode()}
                    >
                      Checklist
                    </button>
                    <button
                      type="button"
                      className="money-button money-button--ghost money-button--compact"
                      disabled={busy}
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Delete
                    </button>
                  </div>
                </header>

                {activeNote.isChecklistMode && (
                  <div className="notes-checklist">
                    <ul className="notes-checklist-list">
                      {tasks.map((task) => (
                        <li key={task.id} className="notes-checklist-item">
                          <label className="notes-checklist-row">
                            <input
                              type="checkbox"
                              checked={task.isDone}
                              onChange={() => void handleToggleTask(task.id)}
                            />
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
                          </label>
                          <button
                            type="button"
                            className="notes-checklist-remove"
                            aria-label={`Remove ${task.label}`}
                            onClick={() => void handleDeleteTask(task.id)}
                          >
                            ×
                          </button>
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
                      <button
                        type="submit"
                        className="money-button money-button--compact"
                        disabled={busy || !newTaskLabel.trim()}
                      >
                        Add
                      </button>
                    </form>
                  </div>
                )}

                <textarea
                  className="notes-body-input"
                  value={bodyDraft}
                  placeholder="Write your note…"
                  aria-label="Note body"
                  onChange={(event) => {
                    const next = event.target.value
                    setBodyDraft(next)
                    scheduleSave(activeNote.id, titleDraft, next)
                  }}
                />
              </>
            )}
          </section>
        </div>
      </div>

      {folderModalOpen && (
        <MossModal
          onClose={() => setFolderModalOpen(false)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="notes-folder-modal-title"
        >
          <form
            className="calendar-event-modal"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreateFolderConfirmed()
            }}
          >
            <h2 id="notes-folder-modal-title" className="calendar-event-modal-title">
              New folder
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
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setFolderModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="money-button money-button--compact"
                disabled={busy || !folderNameDraft.trim()}
              >
                Create folder
              </button>
            </div>
          </form>
        </MossModal>
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
