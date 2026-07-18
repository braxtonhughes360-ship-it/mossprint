import type { CaptureKind } from '@shared/capture'
import type { AppRouteId } from '@shared/types'
import { NAV_ITEMS } from '@shared/types'

const KIND_TO_NAV_ID: Record<CaptureKind, AppRouteId> = {
  money: 'money',
  nutrition: 'nutrition',
  calendar: 'calendar',
  note: 'notes'
}

export function captureModuleNav(kind: CaptureKind): { label: string; path: string } {
  const id = KIND_TO_NAV_ID[kind]
  const item = NAV_ITEMS.find((row) => row.id === id)
  return { label: item?.label ?? kind, path: item?.path ?? '/' }
}
