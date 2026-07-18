import '../SettingsPage.css'
import { SettingsChamber } from '../components/SettingsChamber'

export function SettingsPage(): React.JSX.Element {
  return (
    <div
      className="moss-arrival moss-arrival-settings"
      data-module="settings"
      data-texture="quiet"
    >
      <header className="moss-arrival-band moss-arrival-band-chamber settings-arrival-band">
        <div className="moss-env-light-fields" aria-hidden>
          <span className="moss-env-light-field moss-env-light-field-a" />
          <span className="moss-env-light-field moss-env-light-field-b" />
        </div>
        <span className="moss-env-air-veil moss-arrival-air-veil" aria-hidden />
        <div className="moss-arrival-band-inner module-arrival-head">
          <div className="module-arrival-title-block">
            <h1 className="display-arrival">Settings</h1>
          </div>
        </div>
      </header>

      <div className="moss-arrival-body settings-arrival-body">
        <SettingsChamber />
      </div>
    </div>
  )
}
