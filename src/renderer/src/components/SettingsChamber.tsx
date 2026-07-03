import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePreferences } from '../context/PreferencesProvider'
import { AppearancePanel, ProfileIdentityPanel } from './AppearancePanel'
import { ProfileSecurityPanel } from './ProfileSecurityPanel'
import { CalendarSourcesPanel } from './CalendarSourcesPanel'
import { MailAccountsPanel } from './MailAccountsPanel'
import { NewsSourcesPanel } from './NewsSourcesPanel'
import { LocalDataPanel } from './LocalDataPanel'
import { AboutPanel } from './AboutPanel'
import { LocalAiPanel } from './LocalAiPanel'
import { ModulesPanel } from './ModulesPanel'
import { NewsWidgetPanel } from './NewsWidgetPanel'
import {
  SettingsNav,
  SETTINGS_SECTIONS,
  parseSettingsSection,
  type SettingsSectionId
} from './SettingsNav'

export function SettingsChamber(): React.JSX.Element {
  const { preferences, setPreferences } = usePreferences()
  const [searchParams, setSearchParams] = useSearchParams()
  const [active, setActive] = useState<SettingsSectionId>(() =>
    parseSettingsSection(searchParams.get('section'))
  )
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActive(parseSettingsSection(searchParams.get('section')))
  }, [searchParams])

  const select = (id: SettingsSectionId): void => {
    setActive(id)
    if (id === 'you') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ section: id }, { replace: true })
    }
    // Bring the chosen section into view without nesting a scroll region.
    contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const section = SETTINGS_SECTIONS.find((entry) => entry.id === active) ?? SETTINGS_SECTIONS[0]!

  return (
    <div className="moss-settings-chamber moss-arrival-slab">
      <div className="settings-shell">
        <SettingsNav active={active} onSelect={select} />

        <div className="settings-content" ref={contentRef}>
          <header className="settings-content-head">
            <p className="settings-kicker">{section.label}</p>
            <p className="settings-content-hint">{section.hint}</p>
          </header>

          {active === 'you' && (
            <>
              <ProfileIdentityPanel />
              <ProfileSecurityPanel />
            </>
          )}

          {active === 'look' && <AppearancePanel />}

          {active === 'modules' && <ModulesPanel />}

          {active === 'localai' && <LocalAiPanel />}

          {active === 'news' && (
            <>
              <NewsWidgetPanel
                enabled={preferences.modules.news.enabled}
                maxItems={preferences.modules.news.maxItems}
                widgetLayout={preferences.modules.news.widgetLayout}
                briefingMode={preferences.modules.news.briefingMode}
                maxPerSource={preferences.modules.news.maxPerSource}
                onChange={(patch) =>
                  setPreferences({
                    modules: {
                      news: { ...preferences.modules.news, ...patch }
                    }
                  })
                }
              />
              <NewsSourcesPanel />
            </>
          )}

          {active === 'calendar' && <CalendarSourcesPanel />}

          {active === 'inbox' && <MailAccountsPanel />}

          {active === 'privacy' && (
            <section className="settings-card settings-card-memory">
              <header className="settings-card-head">
                <p className="settings-kicker">Storage</p>
                <h2 className="settings-card-title">Your data, on your disk</h2>
                <p className="settings-card-copy">
                  MOSS keeps everything you enter in one encrypted file on this computer — no
                  account, no cloud, nothing leaves unless you export it. This tab is the receipt:
                  see where that file lives and check it&apos;s healthy.
                </p>
              </header>
              <LocalDataPanel />
            </section>
          )}

          {active === 'about' && <AboutPanel />}
        </div>
      </div>
    </div>
  )
}
