import type { CalendarDoorSnapshot } from '@shared/calendar'
import type { MossBridge } from '@shared/ipc'
import { useDoorSnapshot, type DoorSnapshotResult } from './useDoorSnapshot'

const loadCalendarDoorSnapshot = (channel: MossBridge['calendar']): Promise<CalendarDoorSnapshot> =>
  channel.getDoorSnapshot()

function getCalendarDoorChannel(): MossBridge['calendar'] | undefined {
  const channel = window.moss?.calendar as Partial<MossBridge['calendar']> | undefined
  return typeof channel?.getDoorSnapshot === 'function'
    ? (channel as MossBridge['calendar'])
    : undefined
}

export const useCalendarDoorSnapshot = (): DoorSnapshotResult<CalendarDoorSnapshot> =>
  useDoorSnapshot(getCalendarDoorChannel(), { loadSnapshot: loadCalendarDoorSnapshot })
