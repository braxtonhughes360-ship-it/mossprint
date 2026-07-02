export type SettingsSectionId =
  | 'you'
  | 'look'
  | 'modules'
  | 'news'
  | 'calendar'
  | 'inbox'
  | 'privacy'
  | 'about'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  hint: string
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'you', label: 'You', hint: 'Name & profile' },
  { id: 'look', label: 'Look', hint: 'Theme, accent, motion' },
  { id: 'modules', label: 'Modules', hint: 'Show or hide doors' },
  { id: 'news', label: 'News', hint: 'Widget & sources' },
  { id: 'calendar', label: 'Calendar', hint: 'Google, files, classes' },
  { id: 'inbox', label: 'Inbox', hint: 'Mail accounts' },
  { id: 'privacy', label: 'Privacy & data', hint: 'Where your data lives' },
  { id: 'about', label: 'About', hint: 'Version & updates' }
] as const

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value)
}

export function parseSettingsSection(value: string | null): SettingsSectionId {
  return value && isSettingsSectionId(value) ? value : 'you'
}

export function settingsSectionPath(section: SettingsSectionId): string {
  return section === 'you' ? '/settings' : `/settings?section=${section}`
}

export function SettingsNav({
  active,
  onSelect
}: {
  active: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}): React.JSX.Element {
  return (
    <nav className="settings-sidenav" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map((section) => {
        const isActive = section.id === active
        return (
          <button
            key={section.id}
            type="button"
            className={['settings-sidenav-button', isActive ? 'settings-sidenav-button-active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(section.id)}
          >
            <span className="settings-sidenav-label">{section.label}</span>
            <span className="settings-sidenav-hint nutrition-mono">{section.hint}</span>
          </button>
        )
      })}
    </nav>
  )
}
