import { registerProfileHandlers } from './ipc/profiles'
import { registerDatabaseHandlers } from './ipc/database'
import { registerMoneyHandlers } from './ipc/money'
import { registerNutritionHandlers } from './ipc/nutrition'
import { registerCalendarHandlers } from './ipc/calendar'
import { registerMailHandlers } from './ipc/mail'
import { registerNewsHandlers } from './ipc/news'
import { registerNotesHandlers } from './ipc/notes'
import { registerNoteAttachmentProtocol } from './notesAttachmentProtocol'
import { registerGoalsHandlers } from './ipc/goals'
import { registerShellHandlers } from './ipc/shell'
import { registerCaptureHandlers } from './ipc/capture'
import { registerUpdatesHandlers } from './ipc/updates'

/**
 * Wire every src/main/ipc/ module (plus the note-attachment protocol) at app.ready.
 * Call order is load-bearing — keep it 1:1 with the pre-split whenReady block.
 */
export function registerIpcHandlers(): void {
  registerProfileHandlers()
  registerDatabaseHandlers()
  registerMoneyHandlers()
  registerNutritionHandlers()
  registerCalendarHandlers()
  registerMailHandlers()
  registerNewsHandlers()
  registerNotesHandlers()
  registerNoteAttachmentProtocol()
  registerGoalsHandlers()
  registerShellHandlers()
  registerCaptureHandlers()
  registerUpdatesHandlers()
}
