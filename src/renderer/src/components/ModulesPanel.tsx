import type { ModulePreferences } from '@shared/preferences'
import { usePreferences } from '../context/PreferencesProvider'

const MODULE_ROWS = [
  {
    id: 'calendar' as const,
    label: 'Calendar',
    copy: 'Planning workspace and schedule doors.'
  },
  {
    id: 'money' as const,
    label: 'Financials',
    copy: 'Envelope budget, ledger, and dashboard readout.'
  },
  {
    id: 'nutrition' as const,
    label: 'Nutrition',
    copy: 'Fuel tracking module door and detail view.'
  },
  {
    id: 'inbox' as const,
    label: 'Inbox',
    copy: 'Comms filter module door and detail view.'
  },
  {
    id: 'notes' as const,
    label: 'Notes',
    copy: 'Quick capture, folders, checklists, and maintenance lists.'
  }
]

export function ModulesPanel(): React.JSX.Element {
  const { preferences, setPreferences } = usePreferences()
  const modules = preferences.modules

  function patchModules(patch: Partial<ModulePreferences>): void {
    setPreferences({ modules: patch })
  }

  return (
    <section className="settings-card">
      <header className="settings-card-head">
        <p className="settings-kicker">Modules</p>
        <h2 className="settings-card-title">Your install</h2>
        <p className="settings-card-copy">
          Same binary, different dashboard. Disabled modules hide nav links and atrium doors on
          this device.
        </p>
      </header>

      <div className="settings-stack settings-stack-tight">
        {MODULE_ROWS.map((row) => (
          <label key={row.id} className="preference-field preference-field-module">
            <span className="preference-field-copy">
              <span className="preference-label">{row.label}</span>
              <span className="preference-hint">{row.copy}</span>
            </span>
            <input
              type="checkbox"
              checked={modules[row.id].enabled}
              onChange={(event) =>
                patchModules({ [row.id]: { ...modules[row.id], enabled: event.target.checked } })
              }
            />
          </label>
        ))}

        {modules.money.enabled && (
          <>
            <label className="preference-field preference-field-module preference-field-nested">
              <span className="preference-field-copy">
                <span className="preference-label">Financials · Investments panel</span>
                <span className="preference-hint">
                  Optional 401k / brokerage balance snapshots in the Money detail view.
                </span>
              </span>
              <input
                type="checkbox"
                checked={modules.money.investmentsEnabled}
                onChange={(event) =>
                  patchModules({
                    money: { ...modules.money, investmentsEnabled: event.target.checked }
                  })
                }
              />
            </label>
            <label className="preference-field preference-field-module preference-field-nested">
              <span className="preference-field-copy">
                <span className="preference-label">Financials · Advanced tools</span>
                <span className="preference-hint">
                  Variable-pay forecast, hold buffer, and smallest-paycheck planning in the Budget
                  view.
                </span>
              </span>
              <input
                type="checkbox"
                checked={modules.money.advancedToolsEnabled}
                onChange={(event) =>
                  patchModules({
                    money: { ...modules.money, advancedToolsEnabled: event.target.checked }
                  })
                }
              />
            </label>
          </>
        )}
      </div>
    </section>
  )
}
