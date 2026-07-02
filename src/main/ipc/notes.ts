import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type {
  CreateNoteFolderInput,
  CreateNoteInput,
  CreateNoteTaskInput,
  UpdateNoteInput,
  UpdateNoteTaskInput
} from '@shared/notes'
import {
  createNote,
  createNoteFolder,
  createNoteTask,
  deleteNote,
  deleteNoteFolder,
  deleteNoteTask,
  getNote,
  getNotesDoorSnapshot,
  listNoteFolders,
  listNotes,
  listNoteTasks,
  renameNoteFolder,
  searchNotes,
  setNotePinned,
  toggleNoteTask,
  updateNote,
  updateNoteTask
} from '../notes'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

export function registerNotesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST_FOLDERS, (event) => {
    assertTrustedSender(event)
    return listNoteFolders()
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_CREATE_FOLDER, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid folder input')
    }
    return createNoteFolder(input as CreateNoteFolderInput)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_RENAME_FOLDER, (event, id: unknown, name: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    assertNonEmptyString(name, 'name')
    return renameNoteFolder(id, name)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE_FOLDER, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return deleteNoteFolder(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.NOTES_LIST_NOTES,
    (event, folderId?: unknown, searchQuery?: unknown) => {
      assertTrustedSender(event)
      if (folderId !== undefined && typeof folderId !== 'string') {
        throw new Error('folderId must be a string')
      }
      if (searchQuery !== undefined && typeof searchQuery !== 'string') {
        throw new Error('searchQuery must be a string')
      }
      return listNotes(folderId, searchQuery)
    }
  )

  ipcMain.handle(IPC_CHANNELS.NOTES_GET_NOTE, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return getNote(id)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_CREATE_NOTE, (event, input?: unknown) => {
    assertTrustedSender(event)
    if (input !== undefined && typeof input !== 'object') {
      throw new Error('Invalid note input')
    }
    return createNote((input ?? {}) as CreateNoteInput)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_UPDATE_NOTE, (event, id: unknown, patch: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid note patch')
    }
    return updateNote(id, patch as UpdateNoteInput)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE_NOTE, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return deleteNote(id)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_SET_PIN, (event, id: unknown, pinned: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    if (typeof pinned !== 'boolean') {
      throw new Error('pinned must be a boolean')
    }
    return setNotePinned(id, pinned)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_SEARCH, (event, query: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(query, 'query')
    return searchNotes(query)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_LIST_TASKS, (event, noteId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(noteId, 'noteId')
    return listNoteTasks(noteId)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_CREATE_TASK, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid task input')
    }
    const payload = input as CreateNoteTaskInput
    assertNonEmptyString(payload.noteId, 'noteId')
    assertNonEmptyString(payload.label, 'label')
    return createNoteTask(payload)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_UPDATE_TASK, (event, id: unknown, patch: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid task patch')
    }
    return updateNoteTask(id, patch as UpdateNoteTaskInput)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_TOGGLE_TASK, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return toggleNoteTask(id)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE_TASK, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    return deleteNoteTask(id)
  })

  ipcMain.handle(IPC_CHANNELS.NOTES_GET_DOOR_SNAPSHOT, (event) => {
    assertTrustedSender(event)
    return getNotesDoorSnapshot()
  })
}
