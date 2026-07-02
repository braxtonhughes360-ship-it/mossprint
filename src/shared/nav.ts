import { NAV_ITEMS, type AppRouteId } from '@shared/types'

/** Stable module order — used by keyboard navigation (Alt+1…6, not shown in UI). */
export const NAV_ORDER: Record<AppRouteId, number> = {
  dashboard: 1,
  calendar: 2,
  money: 3,
  nutrition: 4,
  inbox: 5,
  notes: 6,
  settings: 7
}

export function getNavOrder(routeId: string): number {
  return NAV_ORDER[routeId as AppRouteId] ?? 0
}

export function getNavPathByOrder(order: number): string | null {
  const item = NAV_ITEMS.find((nav) => NAV_ORDER[nav.id] === order)
  return item?.path ?? null
}

export function formatNavShortcut(order: number): string {
  return `⌥${order}`
}
