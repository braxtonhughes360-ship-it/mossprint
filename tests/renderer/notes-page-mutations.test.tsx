import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient, focusManager } from '@tanstack/react-query'
import type {
  NoteAttachmentRecord,
  NoteBlock,
  NoteFolderRecord,
  NoteRecord,
  NoteTaskRecord
} from '@shared/notes'
import { DEFAULT_NOTE_ATTACHMENT_STYLE, NOTE_ATTACHMENT_MAX_BYTES } from '@shared/notes'
import { NotesPage } from '@renderer/pages/NotesPage'
import { ProfileProvider } from '@renderer/context/ProfileProvider'
import { PreferencesProvider } from '@renderer/context/PreferencesProvider'
import { installMossMock } from '../helpers/mossMock'
import { renderWithProviders } from '../helpers/renderWithProviders'

/**
 * W4b pin suite: NotesPage's mutation → invalidation → refetch contract AS IT
 * BEHAVES TODAY. Every mutation flows through runMutation (flush pending draft
 * → write → invalidate ['notes']), so each test asserts BOTH halves: the IPC
 * write hit the bridge with the right arguments, and the invalidation-driven
 * refetch made the change visible in the UI. The bridge below is a small
 * in-memory notes store so refetches return post-mutation state, the way the
 * real SQLite-backed main process does.
 */

const DEFAULT_FOLDER_ID = 'default-notes-folder'

function folder(id: string, name: string, sortOrder = 0): NoteFolderRecord {
  return { id, name, sortOrder, createdAt: '2026-07-01T09:00:00.000Z' }
}

function textBlock(id: string, text: string): NoteBlock {
  return { id, type: 'text', text }
}

function note(id: string, title: string, body: string, extra: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    folderId: DEFAULT_FOLDER_ID,
    title,
    body,
    isPinned: false,
    isChecklistMode: false,
    tags: [],
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-10T18:30:00.000Z',
    blocks: [textBlock(`${id}-b1`, body)],
    ink: null,
    ...extra
  }
}

interface StoreSeed {
  folders?: NoteFolderRecord[]
  notes?: NoteRecord[]
  tasks?: NoteTaskRecord[]
  attachments?: NoteAttachmentRecord[]
}

/**
 * Stateful bridge: mutations change the store, reads serve current state.
 * Every method is a vi.fn typed against MossBridge['notes'] (the W4a seam
 * lint-checks the shapes), so tests can assert calls AND observe refetches.
 */
function installNotesStore(seed: StoreSeed = {}): {
  listFolders: ReturnType<typeof vi.fn>
  createFolder: ReturnType<typeof vi.fn>
  renameFolder: ReturnType<typeof vi.fn>
  deleteFolder: ReturnType<typeof vi.fn>
  listNotes: ReturnType<typeof vi.fn>
  getNote: ReturnType<typeof vi.fn>
  createNote: ReturnType<typeof vi.fn>
  updateNote: ReturnType<typeof vi.fn>
  deleteNote: ReturnType<typeof vi.fn>
  setPin: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
  listTasks: ReturnType<typeof vi.fn>
  createTask: ReturnType<typeof vi.fn>
  toggleTask: ReturnType<typeof vi.fn>
  deleteTask: ReturnType<typeof vi.fn>
  listAttachments: ReturnType<typeof vi.fn>
  createAttachment: ReturnType<typeof vi.fn>
  updateAttachment: ReturnType<typeof vi.fn>
  deleteAttachment: ReturnType<typeof vi.fn>
} {
  let idCounter = 0
  const nextId = (prefix: string): string => `${prefix}-${++idCounter}`
  const now = (): string => '2026-07-14T10:00:00.000Z'

  const folders: NoteFolderRecord[] = seed.folders ?? [folder(DEFAULT_FOLDER_ID, 'Notes')]
  let notes: NoteRecord[] = seed.notes ?? []
  let tasks: NoteTaskRecord[] = seed.tasks ?? []
  let attachments: NoteAttachmentRecord[] = seed.attachments ?? []

  const bodyFromBlocks = (blocks: NoteBlock[]): string =>
    blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim()

  const bridge = {
    listFolders: vi.fn(async (): Promise<NoteFolderRecord[]> => [...folders]),
    createFolder: vi.fn(async (input: { name: string }): Promise<NoteFolderRecord> => {
      const created = folder(nextId('folder'), input.name, folders.length)
      folders.push(created)
      return created
    }),
    renameFolder: vi.fn(async (id: string, name: string): Promise<NoteFolderRecord> => {
      const target = folders.find((entry) => entry.id === id)
      if (!target) throw new Error(`no folder ${id}`)
      target.name = name
      return { ...target }
    }),
    deleteFolder: vi.fn(async (id: string): Promise<{ ok: true }> => {
      folders.splice(
        folders.findIndex((entry) => entry.id === id),
        1
      )
      // Mirror main-process behavior: orphaned notes move to the default folder.
      notes = notes.map((entry) =>
        entry.folderId === id ? { ...entry, folderId: DEFAULT_FOLDER_ID } : entry
      )
      return { ok: true as const }
    }),
    listNotes: vi.fn(async (folderId?: string): Promise<NoteRecord[]> =>
      notes.filter((entry) => (folderId ? entry.folderId === folderId : true))
    ),
    getNote: vi.fn(
      async (id: string): Promise<NoteRecord | null> =>
        notes.find((entry) => entry.id === id) ?? null
    ),
    createNote: vi.fn(async (input?: { folderId?: string; title?: string }): Promise<NoteRecord> => {
      const created = note(nextId('note'), input?.title ?? '', '', {
        folderId: input?.folderId ?? DEFAULT_FOLDER_ID,
        blocks: []
      })
      notes.push(created)
      return created
    }),
    updateNote: vi.fn(async (id: string, patch: Partial<NoteRecord>): Promise<NoteRecord> => {
      const index = notes.findIndex((entry) => entry.id === id)
      if (index === -1) throw new Error(`no note ${id}`)
      const next = { ...notes[index], ...patch, updatedAt: now() }
      if (patch.blocks) next.body = bodyFromBlocks(patch.blocks)
      notes[index] = next
      return next
    }),
    deleteNote: vi.fn(async (id: string): Promise<{ ok: true }> => {
      notes = notes.filter((entry) => entry.id !== id)
      tasks = tasks.filter((entry) => entry.noteId !== id)
      return { ok: true as const }
    }),
    setPin: vi.fn(async (id: string, pinned: boolean): Promise<NoteRecord> => {
      const index = notes.findIndex((entry) => entry.id === id)
      notes[index] = { ...notes[index], isPinned: pinned }
      return notes[index]
    }),
    search: vi.fn(async (query: string): Promise<NoteRecord[]> => {
      const needle = query.toLowerCase()
      return notes.filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle)
      )
    }),
    listTasks: vi.fn(async (noteId: string): Promise<NoteTaskRecord[]> =>
      tasks.filter((entry) => entry.noteId === noteId)
    ),
    createTask: vi.fn(async (input: { noteId: string; label: string }): Promise<NoteTaskRecord> => {
      const created: NoteTaskRecord = {
        id: nextId('task'),
        noteId: input.noteId,
        label: input.label,
        isDone: false,
        sortOrder: tasks.length,
        createdAt: now()
      }
      tasks.push(created)
      return created
    }),
    toggleTask: vi.fn(async (id: string): Promise<NoteTaskRecord> => {
      const index = tasks.findIndex((entry) => entry.id === id)
      tasks[index] = { ...tasks[index], isDone: !tasks[index].isDone }
      return tasks[index]
    }),
    deleteTask: vi.fn(async (id: string): Promise<{ ok: true }> => {
      tasks = tasks.filter((entry) => entry.id !== id)
      return { ok: true as const }
    }),
    listAttachments: vi.fn(async (noteId: string): Promise<NoteAttachmentRecord[]> =>
      attachments.filter((entry) => entry.noteId === noteId)
    ),
    createAttachment: vi.fn(
      async (input: {
        noteId: string
        filename: string
        bytes: Uint8Array
      }): Promise<NoteAttachmentRecord> => {
        const id = nextId('att')
        const created: NoteAttachmentRecord = {
          id,
          noteId: input.noteId,
          filename: input.filename,
          mime: 'image/png',
          byteSize: input.bytes.length,
          createdAt: now(),
          url: `moss-attachment://${id}`,
          style: DEFAULT_NOTE_ATTACHMENT_STYLE,
          sketch: null
        }
        attachments.push(created)
        return created
      }
    ),
    updateAttachment: vi.fn(
      async (
        id: string,
        patch: { shape?: NoteAttachmentRecord['style']['shape']; size?: NoteAttachmentRecord['style']['size'] }
      ): Promise<NoteAttachmentRecord> => {
        const index = attachments.findIndex((entry) => entry.id === id)
        attachments[index] = {
          ...attachments[index],
          style: { ...attachments[index].style, ...patch }
        }
        return attachments[index]
      }
    ),
    deleteAttachment: vi.fn(async (id: string): Promise<{ ok: true }> => {
      attachments = attachments.filter((entry) => entry.id !== id)
      return { ok: true as const }
    })
  }

  installMossMock({
    notes: bridge,
    // The folder modal and confirm dialogs mount MossModal → useMotionGates →
    // usePreferences, so this suite renders under the real Profile/Preferences
    // providers (matching main.tsx). Keep their mount path quiet: no profiles,
    // no idle-lock subscription — preferences stay at device defaults.
    profiles: {
      list: async () => [],
      onIdleLocked: () => () => {}
    }
  })
  return bridge
}

/** NotesPage under the provider tree it gets in prod (main.tsx). */
function renderNotes(queryClient?: QueryClient): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ProfileProvider>
      <PreferencesProvider>
        <NotesPage />
      </PreferencesProvider>
    </ProfileProvider>,
    queryClient
  )
}

function seedTwoNotes(): StoreSeed {
  return {
    folders: [folder(DEFAULT_FOLDER_ID, 'Notes'), folder('folder-personal', 'Personal', 1)],
    notes: [note('note-a', 'Groceries', 'eggs and oat milk'), note('note-b', 'Journal', 'a quiet day')]
  }
}

async function openNote(title: string): Promise<HTMLInputElement> {
  fireEvent.click(await screen.findByText(title))
  const input = await screen.findByLabelText<HTMLInputElement>('Note title')
  await waitFor(() => expect(input.value).toBe(title))
  return input
}

afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

describe('NotesPage mutations write through the bridge and refetch via invalidation', () => {
  it('creating a note writes createNote, refetches the list, and opens the new note', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await screen.findByText('Groceries')
    const listCallsBefore = bridge.listNotes.mock.calls.length

    fireEvent.click(screen.getAllByRole('button', { name: 'New note' })[0])

    await waitFor(() => expect(bridge.createNote).toHaveBeenCalledTimes(1))
    expect(bridge.createNote).toHaveBeenCalledWith({ folderId: undefined })
    // Invalidation refetches the list; the stateful store now includes the new note.
    await waitFor(() =>
      expect(bridge.listNotes.mock.calls.length).toBeGreaterThan(listCallsBefore)
    )
    expect(await screen.findByText('Empty note')).toBeTruthy()
    // The fresh note opens with the caret in the title (focus-once contract).
    const title = await screen.findByLabelText<HTMLInputElement>('Note title')
    await waitFor(() => expect(document.activeElement).toBe(title))
    expect(title.value).toBe('')
  })

  it('pin toggle writes setPin and the refetched note flips the control and list marker', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await openNote('Groceries')

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))

    await waitFor(() => expect(bridge.setPin).toHaveBeenCalledWith('note-a', true))
    expect(await screen.findByRole('button', { name: 'Unpin' })).toBeTruthy()
    expect(await screen.findByLabelText('Pinned')).toBeTruthy()
  })

  it('toggling checklist mode writes updateNote and the refetched note loads its tasks', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await openNote('Groceries')
    expect(bridge.listTasks).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Checklist' }))

    await waitFor(() =>
      expect(bridge.updateNote).toHaveBeenCalledWith('note-a', { isChecklistMode: true })
    )
    // The refetched note is in checklist mode, so the note query now loads tasks.
    await waitFor(() => expect(bridge.listTasks).toHaveBeenCalledWith('note-a'))
    expect(await screen.findByLabelText('New checklist item')).toBeTruthy()
  })

  it('checklist tasks: add, toggle, and delete each write through and rerender from refetch', async () => {
    const bridge = installNotesStore({
      ...seedTwoNotes(),
      notes: [note('note-a', 'Groceries', 'eggs and oat milk', { isChecklistMode: true })],
      tasks: [
        {
          id: 'task-milk',
          noteId: 'note-a',
          label: 'Milk',
          isDone: false,
          sortOrder: 0,
          createdAt: '2026-07-10T18:30:00.000Z'
        }
      ]
    })
    renderNotes()
    await openNote('Groceries')

    // Add
    fireEvent.change(await screen.findByLabelText('New checklist item'), {
      target: { value: 'Buy eggs' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(bridge.createTask).toHaveBeenCalledWith({ noteId: 'note-a', label: 'Buy eggs' })
    )
    expect(await screen.findByText('Buy eggs')).toBeTruthy()

    // Toggle
    const milkCheckbox = screen.getByRole('checkbox', { name: 'Milk' })
    expect(milkCheckbox.closest('label')?.classList.contains('moss-checkbox')).toBe(true)
    expect(screen.getByRole('button', { name: 'Remove Milk' }).classList.contains('moss-button')).toBe(
      true
    )
    fireEvent.click(milkCheckbox)
    await waitFor(() => expect(bridge.toggleTask).toHaveBeenCalledWith('task-milk'))
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Milk' }).checked).toBe(true)
    )

    // Delete
    fireEvent.click(screen.getByRole('button', { name: 'Remove Milk' }))
    await waitFor(() => expect(bridge.deleteTask).toHaveBeenCalledWith('task-milk'))
    await waitFor(() => expect(screen.queryByText('Milk')).toBeNull())
  })

  it('creating a folder writes createFolder, selects it, and refetches the folder-scoped list', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await screen.findByText('Groceries')

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(await screen.findByLabelText('Folder name'), {
      target: { value: 'Recipes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))

    await waitFor(() => expect(bridge.createFolder).toHaveBeenCalledWith({ name: 'Recipes' }))
    const created = (await bridge.createFolder.mock.results[0].value) as NoteFolderRecord
    // Selecting the new folder changes the list query key → folder-scoped fetch.
    await waitFor(() => expect(bridge.listNotes).toHaveBeenCalledWith(created.id))
    expect(await screen.findByRole('button', { name: 'Recipes' })).toBeTruthy()
    expect(await screen.findByText('Your notes will appear here.')).toBeTruthy()
  })

  it('renaming a folder writes renameFolder and the refetched rail shows the new name', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await screen.findByRole('button', { name: 'Personal' })

    fireEvent.click(screen.getByRole('button', { name: 'Rename Personal' }))
    const input = await screen.findByLabelText<HTMLInputElement>('Folder name')
    expect(input.value).toBe('Personal')
    fireEvent.change(input, { target: { value: 'Home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(bridge.renameFolder).toHaveBeenCalledWith('folder-personal', 'Home'))
    expect(await screen.findByRole('button', { name: 'Home' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Personal' })).toBeNull())
  })

  it('deleting the selected folder writes deleteFolder and resets the list to unfiltered', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await screen.findByText('Groceries')

    fireEvent.click(screen.getByRole('button', { name: 'Personal' }))
    await waitFor(() => expect(bridge.listNotes).toHaveBeenCalledWith('folder-personal'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Personal' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete folder' }))

    await waitFor(() => expect(bridge.deleteFolder).toHaveBeenCalledWith('folder-personal'))
    // Selection resets to "All notes" — the list query returns to the unfiltered key.
    await waitFor(() => expect(bridge.listNotes).toHaveBeenLastCalledWith())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Personal' })).toBeNull())
    expect(await screen.findByText('Groceries')).toBeTruthy()
  })

  it('moving a note to a folder writes updateNote with the target folderId', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await openNote('Groceries')

    const trigger = screen.getByRole('combobox', { name: 'Move note to folder' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const option = await screen.findByRole('option', { name: 'Personal' })
    fireEvent.keyDown(option, { key: 'Enter' })

    await waitFor(() =>
      expect(bridge.updateNote).toHaveBeenCalledWith('note-a', { folderId: 'folder-personal' })
    )
  })

  it('deleting a note writes deleteNote, clears the editor, and refetches the list', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await openNote('Groceries')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(bridge.deleteNote).toHaveBeenCalledWith('note-a'))
    // Editor returns to the no-selection empty state; the refetched list drops the note.
    expect(await screen.findByText('Create your first note')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Groceries')).toBeNull())
    expect(screen.getByText('Journal')).toBeTruthy()
  })

  it('a pending debounced edit flushes BEFORE the next mutation writes (QA2-03 contract)', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    const title = await openNote('Groceries')

    vi.useFakeTimers()
    fireEvent.change(title, { target: { value: 'Groceries!' } })
    expect(bridge.updateNote).not.toHaveBeenCalled()

    // Pin while the 450ms debounce is still pending: the draft must persist first.
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(bridge.updateNote).toHaveBeenCalledTimes(1)
    expect(bridge.updateNote).toHaveBeenCalledWith(
      'note-a',
      expect.objectContaining({ title: 'Groceries!' })
    )
    expect(bridge.setPin).toHaveBeenCalledTimes(1)
    expect(bridge.updateNote.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.setPin.mock.invocationCallOrder[0]
    )

    // The cleared debounce timer must not fire a second, duplicate write.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(bridge.updateNote).toHaveBeenCalledTimes(1)
  })

  it('a failed mutation surfaces its message and the next success clears it', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    bridge.deleteNote.mockRejectedValueOnce(new Error('vault is read-only'))
    renderNotes()
    await openNote('Groceries')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete note' }))
    expect(await screen.findByText('vault is read-only')).toBeTruthy()

    // Next successful mutation clears the banner (runMutation resets on success).
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(screen.queryByText('vault is read-only')).toBeNull())
  })

  it('adding an image writes createAttachment then the document blocks, and the figure renders', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    const { container } = renderNotes()
    await openNote('Groceries')

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() =>
      expect(bridge.createAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: 'note-a', filename: 'photo.png' })
      )
    )
    await waitFor(() =>
      expect(bridge.updateNote).toHaveBeenCalledWith(
        'note-a',
        expect.objectContaining({
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'image' })])
        })
      )
    )
    expect(await screen.findByAltText('photo.png')).toBeTruthy()
  })

  it('an oversized image is rejected with the limit message before any write', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    const { container } = renderNotes()
    await openNote('Groceries')

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'huge.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: NOTE_ATTACHMENT_MAX_BYTES + 1 })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText(/over the 10 MB image limit/)).toBeTruthy()
    expect(bridge.createAttachment).not.toHaveBeenCalled()
    expect(bridge.updateNote).not.toHaveBeenCalled()
  })

  it('image style change and removal write updateAttachment / deleteAttachment', async () => {
    const seeded = seedTwoNotes()
    const bridge = installNotesStore({
      ...seeded,
      notes: [
        note('note-a', 'Groceries', 'eggs and oat milk', {
          blocks: [
            textBlock('note-a-b1', 'eggs and oat milk'),
            { id: 'note-a-img', type: 'image', attachmentId: 'att-photo' },
            textBlock('note-a-b2', '')
          ]
        })
      ],
      attachments: [
        {
          id: 'att-photo',
          noteId: 'note-a',
          filename: 'photo.png',
          mime: 'image/png',
          byteSize: 3,
          createdAt: '2026-07-10T18:30:00.000Z',
          url: 'moss-attachment://att-photo',
          style: { shape: 'rectangle', size: 'medium' },
          sketch: null
        }
      ]
    })
    renderNotes()
    await openNote('Groceries')
    await screen.findByAltText('photo.png')

    fireEvent.click(screen.getByRole('button', { name: 'Soft shape' }))
    await waitFor(() =>
      expect(bridge.updateAttachment).toHaveBeenCalledWith('att-photo', { shape: 'rounded' })
    )
    // Refetched style renders active (and therefore disabled) on the toolbar.
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Soft shape' }).disabled).toBe(
        true
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove image photo.png' }))
    await waitFor(() => expect(bridge.deleteAttachment).toHaveBeenCalledWith('att-photo'))
    expect(bridge.updateNote).toHaveBeenCalledWith(
      'note-a',
      expect.objectContaining({
        blocks: expect.not.arrayContaining([expect.objectContaining({ type: 'image' })])
      })
    )
    await waitFor(() => expect(screen.queryByAltText('photo.png')).toBeNull())
  })
})

describe('NotesPage refetch triggers', () => {
  it('search-as-you-type refetches through notes.search; folder click scopes listNotes and clears search', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    renderNotes()
    await screen.findByText('Groceries')

    const searchBox = screen.getByLabelText<HTMLInputElement>('Search notes')
    fireEvent.change(searchBox, { target: { value: 'quiet' } })

    await waitFor(() => expect(bridge.search).toHaveBeenCalledWith('quiet'))
    expect(await screen.findByText('Results')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Groceries')).toBeNull())
    expect(screen.getByText('Journal')).toBeTruthy()

    // Picking a folder exits search mode and scopes the list to that folder.
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }))
    await waitFor(() => expect(bridge.listNotes).toHaveBeenCalledWith('folder-personal'))
    expect(searchBox.value).toBe('')
  })

  it('window refocus refetches the notes queries under the production client posture', async () => {
    const bridge = installNotesStore(seedTwoNotes())
    // Mirror src/renderer/src/queryClient.ts focus behavior; staleTime 0 so the
    // refocus refetch is immediate instead of waiting out the 15s window.
    const prodPostureClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: true, staleTime: 0 },
        mutations: { retry: false }
      }
    })
    renderNotes(prodPostureClient)
    await screen.findByText('Groceries')
    const listCallsBefore = bridge.listNotes.mock.calls.length

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await waitFor(() =>
      expect(bridge.listNotes.mock.calls.length).toBeGreaterThan(listCallsBefore)
    )
  })
})
