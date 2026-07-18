import type { MossBridge } from '@shared/ipc'
import type { NotesDoorSnapshot } from '@shared/notes'
import { useDoorSnapshot, type DoorSnapshotResult } from './useDoorSnapshot'

const loadNotesDoorSnapshot = (channel: MossBridge['notes']): Promise<NotesDoorSnapshot> =>
  channel.getDoorSnapshot()

export const useNotesDoorSnapshot = (): DoorSnapshotResult<NotesDoorSnapshot> =>
  useDoorSnapshot(window.moss?.notes, { loadSnapshot: loadNotesDoorSnapshot })
