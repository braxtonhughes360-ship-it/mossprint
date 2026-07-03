import { useNavigate } from 'react-router-dom'
import {
  ACCENT_PALETTES,
  DENSITY_PRESETS,
  type AccentPalette,
  type AmbientIntensity,
  type ColorMode,
  type InterfaceDensity,
  type MotionIntensity
} from '@shared/preferences'
import { usePreferences } from '../context/PreferencesProvider'
import { useProfile } from '../context/ProfileProvider'

/** "You" section — display name + re-run setup. */
export function ProfileIdentityPanel(): React.JSX.Element {
  const navigate = useNavigate()
  const { preferences, setPreferences } = usePreferences()
  const { activeProfile, refreshProfiles } = useProfile()

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Profile</p>
          <h2 className="settings-card-title">Your name</h2>
          <p className="settings-card-copy">Your name appears in the dashboard greeting.</p>
        </header>
        <label className="settings-field">
          <span className="settings-field-label">Display name</span>
          <input
            type="text"
            className="settings-text-input"
            value={preferences.profile?.displayName ?? ''}
            placeholder="e.g. Alex"
            maxLength={64}
            onChange={(event) => {
              const displayName = event.target.value
              setPreferences({ profile: { displayName } })
              if (activeProfile?.id) {
                void window.moss.profiles
                  .update(activeProfile.id, { displayName: displayName.trim() })
                  .then(() => refreshProfiles())
              }
            }}
          />
        </label>

        <div className="settings-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/setup')}>
            Run setup again
          </button>
        </div>
      </section>
    </div>
  )
}

/** "Look" section — mode, accent, motion, scale, atmosphere. */
export function AppearancePanel(): React.JSX.Element {
  const { preferences, setPreferences, resetPreferences } = usePreferences()

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Appearance</p>
          <h2 className="settings-card-title">Mode</h2>
          <p className="settings-card-copy">Light, dark, or follow your system.</p>
        </header>
        <SegmentedControl
          value={preferences.colorMode}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Auto' }
          ]}
          onChange={(value) => setPreferences({ colorMode: value as ColorMode })}
        />
      </section>

      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Climate</p>
          <h2 className="settings-card-title">Accent</h2>
          <p className="settings-card-copy">
            Shifts hero undertone, door fields, stage wash, and active controls. Preview the
            undertone before selecting.
          </p>
        </header>
        <ClimatePicker
          value={preferences.accentPalette}
          onChange={(value) => setPreferences({ accentPalette: value })}
        />
      </section>

      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Motion</p>
          <h2 className="settings-card-title">Presence</h2>
          <p className="settings-card-copy">
            Full enables lockup heartbeat, brand glow breathe, and phase transitions. Reduced
            keeps static fields. Off removes ambient motion.
          </p>
        </header>
        <SegmentedControl
          value={preferences.motionIntensity}
          options={[
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced' },
            { value: 'off', label: 'Off' }
          ]}
          onChange={(value) => setPreferences({ motionIntensity: value as MotionIntensity })}
        />
      </section>

      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Layout</p>
          <h2 className="settings-card-title">Scale</h2>
          <p className="settings-card-copy">
            Spatial rhythm — typography, spacing, and door geometry scale together. Independent
            from Field strength below.
          </p>
        </header>
        <ScalePicker
          value={preferences.density}
          onChange={(value) => setPreferences({ density: value })}
        />
      </section>

      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Atmosphere</p>
          <h2 className="settings-card-title">Field strength</h2>
          <p className="settings-card-copy">
            Off flattens surfaces. Low keeps a faint cradle. Standard brings full authored ambient
            presence across the shell. Independent of layout scale above.
          </p>
        </header>
        <SegmentedControl
          value={preferences.ambientIntensity}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'low', label: 'Low' },
            { value: 'standard', label: 'Standard' }
          ]}
          onChange={(value) => setPreferences({ ambientIntensity: value as AmbientIntensity })}
        />
      </section>

      <div className="settings-actions">
        <button type="button" className="btn-secondary" onClick={resetPreferences}>
          Reset to Moss defaults
        </button>
      </div>
    </div>
  )
}

function ScalePicker({
  value,
  onChange
}: {
  value: InterfaceDensity
  onChange: (value: InterfaceDensity) => void
}): React.JSX.Element {
  const options = Object.entries(DENSITY_PRESETS) as [
    InterfaceDensity,
    (typeof DENSITY_PRESETS)[InterfaceDensity]
  ][]

  return (
    <div className="scale-picker" role="radiogroup" aria-label="Layout scale">
      {options.map(([id, preset]) => {
        const active = value === id

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            className={['scale-option', active ? 'scale-option-active' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(id)}
          >
            <span className="scale-preview" data-scale={preset.preview} aria-hidden>
              <span className="scale-preview-hero" />
              <span className="scale-preview-doors">
                <span className="scale-preview-door" />
                <span className="scale-preview-door" />
              </span>
            </span>
            <span className="scale-label">{preset.label}</span>
            <span className="scale-copy">{preset.description}</span>
            {active && (
              <span className="scale-check" aria-hidden>
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ClimatePicker({
  value,
  onChange
}: {
  value: AccentPalette
  onChange: (value: AccentPalette) => void
}): React.JSX.Element {
  const options = Object.entries(ACCENT_PALETTES) as [AccentPalette, (typeof ACCENT_PALETTES)[AccentPalette]][]

  return (
    <div className="climate-picker" role="radiogroup" aria-label="Climate accent">
      {options.map(([id, palette]) => {
        const active = value === id

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            className={['climate-option', active ? 'climate-option-active' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(id)}
          >
            <span className="climate-preview" data-climate={id} aria-hidden />
            <span className="climate-label">{palette.label}</span>
            <span className="climate-copy">{palette.description}</span>
            {active && (
              <span className="climate-check" aria-hidden>
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented-control" role="group">
      {options.map((option) => {
        const active = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            className={['segmented-option', active ? 'segmented-option-active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {active && <span className="segmented-indicator" aria-hidden />}
            <span className="segmented-label">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
