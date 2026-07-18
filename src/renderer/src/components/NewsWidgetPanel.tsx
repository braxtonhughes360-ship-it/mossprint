/** Dashboard news widget settings — lives in Settings, not the module nav. */

import type { NewsBriefingMode, NewsWidgetLayout } from '@shared/news'
import { MossCard } from './MossCard'
import { MossCheckbox } from './MossCheckbox'
import { MossSelect } from './MossSelect'

export interface NewsWidgetConfig {
  enabled?: boolean
  maxItems?: number
  widgetLayout?: NewsWidgetLayout
  briefingMode?: NewsBriefingMode
  maxPerSource?: number
}

export interface NewsWidgetPanelProps {
  enabled?: boolean
  maxItems?: number
  widgetLayout?: NewsWidgetLayout
  briefingMode?: NewsBriefingMode
  maxPerSource?: number
  onChange?: (patch: NewsWidgetConfig) => void
}

const WIDGET_LAYOUTS: Array<{ value: NewsWidgetLayout; label: string }> = [
  { value: 'compact', label: 'Small — Top & Local columns (2 each)' },
  { value: 'split', label: 'Medium — Top & Local columns (3 each)' },
  { value: 'full', label: 'Maxed — lead story + full grids (4 each)' }
]

const STORY_MODES: Array<{ value: NewsBriefingMode; label: string }> = [
  { value: 'balanced', label: 'Balanced — rotate across feeds' },
  { value: 'latest', label: 'Latest overall — pure recency' },
  { value: 'priority', label: 'Priority — higher-priority feeds first' }
]

export function NewsWidgetPanel({
  enabled = true,
  maxItems = 9,
  widgetLayout = 'split',
  briefingMode = 'balanced',
  maxPerSource = 2,
  onChange
}: NewsWidgetPanelProps): React.JSX.Element {
  return (
    <MossCard className="settings-card">
      <header className="settings-card-head">
        <p className="settings-kicker">Dashboard</p>
        <h2 className="settings-card-title">News briefing</h2>
        <p className="settings-card-copy">
          Small and Medium show Top & Local columns (no lead photo). Maxed adds a lead story and denser grids.
          Story selection spreads headlines across your subscribed feeds.
        </p>
      </header>

      <div className="settings-stack settings-stack-tight">
        <div className="preference-field">
          <MossCheckbox
            label="Show on dashboard"
            checked={enabled}
            onChange={(event) => onChange?.({ enabled: event.target.checked })}
          />
        </div>

        <div className="preference-field">
          <span className="preference-label">Widget layout</span>
          <MossSelect
            className="moss-select--block"
            value={widgetLayout}
            options={WIDGET_LAYOUTS}
            onChange={(next) => onChange?.({ widgetLayout: next as NewsWidgetLayout })}
            ariaLabel="Widget layout"
          />
        </div>

        {widgetLayout === 'full' && (
          <div className="preference-field">
            <span className="preference-label">Max headlines</span>
            <MossSelect
              className="moss-select--block"
              value={String(maxItems)}
              options={[9, 10, 11, 12].map((value) => ({
                value: String(value),
                label: `${value}${value === 9 ? ' (recommended)' : ''}`
              }))}
              onChange={(next) => onChange?.({ maxItems: Number(next) })}
              ariaLabel="Max headlines"
            />
          </div>
        )}

        <div className="preference-field">
          <span className="preference-label">Story selection</span>
          <MossSelect
            className="moss-select--block"
            value={briefingMode}
            options={STORY_MODES}
            onChange={(next) => onChange?.({ briefingMode: next as NewsBriefingMode })}
            ariaLabel="Story selection"
          />
        </div>

        {briefingMode !== 'latest' && (
          <div className="preference-field">
            <span className="preference-label">Max per feed (widget)</span>
            <MossSelect
              className="moss-select--block"
              value={String(maxPerSource)}
              options={[1, 2].map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(next) => onChange?.({ maxPerSource: Number(next) })}
              ariaLabel="Max per feed"
            />
          </div>
        )}
      </div>
    </MossCard>
  )
}
