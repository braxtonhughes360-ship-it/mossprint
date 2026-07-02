import { NAV_ITEMS, type AppRouteId } from '@shared/types'
import { NAV_ORDER } from '@shared/nav'

/** Nav order index for direction-aware slides (Dribbble tab-switch / carousel pattern). */
export function getRouteOrder(pathname: string): number {
  if (pathname === '/') return NAV_ORDER.dashboard
  if (pathname.startsWith('/settings')) return NAV_ORDER.settings

  const segment = pathname.split('/').filter(Boolean)[0]
  const item = NAV_ITEMS.find((nav) => nav.path === `/${segment}`)
  if (!item) return NAV_ORDER.dashboard

  return NAV_ORDER[item.id as AppRouteId]
}

/** 1 = forward (down the nav), -1 = back (up the nav). */
export function getRouteDirection(fromPath: string, toPath: string): number {
  const from = getRouteOrder(fromPath)
  const to = getRouteOrder(toPath)
  if (to === from) return 1
  return to > from ? 1 : -1
}
