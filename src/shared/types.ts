export const APP_NAME = 'MOSS'
export const APP_TAGLINE = 'Modular Operating System for Self'

export type AppRouteId =
  | 'dashboard'
  | 'calendar'
  | 'money'
  | 'nutrition'
  | 'inbox'
  | 'notes'
  | 'settings'

export interface NavItem {
  id: AppRouteId
  label: string
  path: string
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    description: 'Your day, composed'
  },
  {
    id: 'calendar',
    label: 'Calendar',
    path: '/calendar',
    description: 'Time and planning'
  },
  {
    id: 'money',
    label: 'Financials',
    path: '/money',
    description: 'Capital, clarified'
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    path: '/nutrition',
    description: 'Fuel, measured'
  },
  {
    id: 'inbox',
    label: 'Inbox',
    path: '/inbox',
    description: 'Comms, filtered'
  },
  {
    id: 'notes',
    label: 'Notes',
    path: '/notes',
    description: 'Capture, organized'
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    description: 'Preferences and system'
  }
]

export interface SettingRecord {
  key: string
  value: string
  updatedAt: string
}

export interface DatabaseHealthResult {
  ok: boolean
  wroteAt: string
  readBack: string
  databasePath: string
  message: string
}

export interface DatabasePingResult {
  ok: boolean
  value: string | null
  updatedAt: string | null
  databasePath: string
}
