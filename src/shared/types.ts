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

/** D1 — Settings → Privacy & data "Your data" card. */
export interface DataOverviewProfile {
  id: string
  displayName: string
  /** Size on disk of the profile's directory (DB + key file + attachments). */
  bytes: number
}

export interface DataOverview {
  /** The profiles tree — where every profile's encrypted data lives. */
  dataRoot: string
  /** True when the operator moved data out of the default app-support dir. */
  isCustomLocation: boolean
  /** The default location (userData) — the target for "move back to default". */
  defaultDataRoot: string
  totalBytes: number
  profiles: DataOverviewProfile[]
  /** Bundled local-AI model location (always in userData; not moved). */
  modelDir: string
  modelBytes: number
}

export type MoveDataFolderResult =
  | { ok: true; newRoot: string }
  | {
      ok: false
      error: string
      /** True when DB handles were closed before the failure — a reload rebinds them. */
      locked?: boolean
    }
