import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { NoteFolderRecord, NoteRecord } from '@shared/notes'
import { NotesPage } from '@renderer/pages/NotesPage'
import { installMossMock } from '../helpers/mossMock'
import { renderWithProviders } from '../helpers/renderWithProviders'

const folder: NoteFolderRecord = {
  id: 'default-notes-folder',
  name: 'Notes',
  sortOrder: 0,
  createdAt: '2026-07-01T09:00:00.000Z'
}

function note(id: string, title: string, body: string): NoteRecord {
  return {
    id,
    folderId: folder.id,
    title,
    body,
    isPinned: false,
    isChecklistMode: false,
    tags: [],
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-10T18:30:00.000Z',
    blocks: [{ id: `${id}-b1`, type: 'text', text: body }],
    ink: null
  }
}

const noteA = note('note-a', 'Groceries', 'eggs and oat milk')
const noteB = note('note-b', 'Journal', 'a quiet day')

/** The list+editor happy-path bridge: folders, list, open, attachments, save. */
function installNotesBridge(): {
  listNotes: ReturnType<typeof vi.fn>
  getNote: ReturnType<typeof vi.fn>
  updateNote: ReturnType<typeof vi.fn>
} {
  const listNotes = vi.fn(async () => [noteA, noteB])
  const getNote = vi.fn(async (id: string) => (id === noteA.id ? noteA : noteB))
  const updateNote = vi.fn(async (id: string) => (id === noteA.id ? noteA : noteB))
  installMossMock({
    notes: {
      listFolders: async () => [folder],
      listNotes,
      getNote,
      updateNote,
      listAttachments: async () => []
    }
  })
  return { listNotes, getNote, updateNote }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NotesPage list + editor data flow', () => {
  it('loads folders and notes on mount and lists both panes', async () => {
    const { listNotes } = installNotesBridge()
    renderWithProviders(<NotesPage />)

    expect(await screen.findByText('Groceries')).toBeTruthy()
    expect(screen.getByText('Journal')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All notes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New folder' }).classList.contains('moss-button')).toBe(
      true
    )
    // Unfiltered load: no folder filter, no search query.
    expect(listNotes).toHaveBeenCalledWith()
    // No note selected yet — the editor shows the first-run empty state instead.
    expect(screen.getByText('Create your first note')).toBeTruthy()
  })

  it('selecting a note fetches it and mirrors it into the editor drafts', async () => {
    const { getNote } = installNotesBridge()
    renderWithProviders(<NotesPage />)

    fireEvent.click(await screen.findByText('Groceries'))

    const title = await screen.findByLabelText<HTMLInputElement>('Note title')
    await waitFor(() => expect(title.value).toBe('Groceries'))
    expect(getNote).toHaveBeenCalledWith(noteA.id)
    const bodyBlock = screen.getByLabelText<HTMLTextAreaElement>('Note text')
    expect(bodyBlock.value).toBe('eggs and oat milk')
    expect(screen.getByRole('toolbar', { name: 'Note editor' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Checklist' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('autosave holds edits for the 450ms debounce, then flushes one coalesced update', async () => {
    const { updateNote } = installNotesBridge()
    renderWithProviders(<NotesPage />)

    fireEvent.click(await screen.findByText('Groceries'))
    const title = await screen.findByLabelText<HTMLInputElement>('Note title')
    await waitFor(() => expect(title.value).toBe('Groceries'))

    // Fake timers only from here — RTL's waitFor polling above needs real ones.
    vi.useFakeTimers()
    fireEvent.change(title, { target: { value: 'Groceries + hardware' } })
    // Inside the debounce window nothing is written…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(updateNote).not.toHaveBeenCalled()

    // …a second edit inside the window restarts it and coalesces…
    fireEvent.change(title, { target: { value: 'Groceries + hardware store' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(449)
    })
    expect(updateNote).not.toHaveBeenCalled()

    // …and 450ms after the last keystroke exactly one write lands.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(updateNote).toHaveBeenCalledTimes(1)
    expect(updateNote).toHaveBeenCalledWith(
      noteA.id,
      expect.objectContaining({ title: 'Groceries + hardware store' })
    )
  })

  it('switching notes flushes the pending draft before the next read (QA2-03 contract)', async () => {
    const { updateNote, getNote } = installNotesBridge()
    renderWithProviders(<NotesPage />)

    fireEvent.click(await screen.findByText('Groceries'))
    const title = await screen.findByLabelText<HTMLInputElement>('Note title')
    await waitFor(() => expect(title.value).toBe('Groceries'))

    vi.useFakeTimers()
    fireEvent.change(title, { target: { value: 'Groceries (draft)' } })
    expect(updateNote).not.toHaveBeenCalled()

    // Selecting the other note must persist the pending edit immediately —
    // no waiting out the debounce, so a stale refetch can never clobber it.
    fireEvent.click(screen.getByText('Journal'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(updateNote).toHaveBeenCalledTimes(1)
    expect(updateNote).toHaveBeenCalledWith(
      noteA.id,
      expect.objectContaining({ title: 'Groceries (draft)' })
    )
    expect(getNote).toHaveBeenCalledWith(noteB.id)
  })
})
