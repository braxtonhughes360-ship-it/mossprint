import type { MossBridge } from '@shared/ipc'
import type { MailDoorSnapshot } from '@shared/mail'
import { useDoorSnapshot, type DoorSnapshotResult } from './useDoorSnapshot'

const loadInboxDoorSnapshot = (channel: MossBridge['mail']): Promise<MailDoorSnapshot> =>
  channel.getDoorSnapshot()

function getInboxDoorChannel(): MossBridge['mail'] | undefined {
  const channel = window.moss?.mail as Partial<MossBridge['mail']> | undefined
  return typeof channel?.getDoorSnapshot === 'function' ? (channel as MossBridge['mail']) : undefined
}

export const useInboxDoorSnapshot = (): DoorSnapshotResult<MailDoorSnapshot> =>
  useDoorSnapshot(getInboxDoorChannel(), { loadSnapshot: loadInboxDoorSnapshot })
