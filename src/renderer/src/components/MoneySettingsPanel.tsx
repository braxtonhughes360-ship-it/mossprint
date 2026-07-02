import { useCallback, useEffect, useState } from 'react'
import type { MoneyTrustOverview, MoneyTrustSettings } from '@shared/moneyTrust'
import {
  DEFAULT_MONEY_TRUST_SETTINGS,
  MONEY_PRIVACY_COPY,
  normalizeMoneyTrustOverview
} from '@shared/moneyTrust'
import { SAVINGS_GOAL_TEMPLATES } from '@shared/moneySavings'
import { usePreferences } from '../context/PreferencesProvider'
import { MoneyTrustBadge } from './MoneyTrustBadge'
import { MossSelect } from './MossSelect'

interface MoneySettingsPanelProps {
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

const QUOTE_STALE_OPTIONS = [
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes (default)' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' }
]

const SAVINGS_TEMPLATE_OPTIONS = SAVINGS_GOAL_TEMPLATES.map((template) => ({
  value: template.kind,
  label: template.name
}))

/** Chips are reserved for data-provenance caveats — everything else reads as plain copy. */
const CHIP_WORTHY_KINDS = new Set(['imported', 'estimated', 'stale'])

export function MoneySettingsPanel({
  busy,
  onMutate
}: MoneySettingsPanelProps): React.JSX.Element {
  const { preferences, setPreferences } = usePreferences()
  const advancedToolsEnabled = preferences.modules.money.advancedToolsEnabled ?? false
  const investmentsEnabled = preferences.modules.money.investmentsEnabled

  const [settings, setSettings] = useState<MoneyTrustSettings>({ ...DEFAULT_MONEY_TRUST_SETTINGS })
  const [overview, setOverview] = useState<MoneyTrustOverview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!window.moss?.money?.getTrustSettings || !window.moss.money.getTrustOverview) {
      setLoadError('Trust settings are unavailable — restart the app to pick up the latest build.')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const [nextSettings, nextOverview] = await Promise.all([
        window.moss.money.getTrustSettings(),
        window.moss.money.getTrustOverview()
      ])
      setSettings(nextSettings)
      setOverview(normalizeMoneyTrustOverview(nextOverview))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load trust settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, busy])

  async function saveSettings(patch: Partial<MoneyTrustSettings>): Promise<void> {
    setNotice(null)
    await onMutate(async () => {
      const next = await window.moss.money.setTrustSettings?.(patch)
      if (next) setSettings(next)
      await load()
      setNotice('Settings saved.')
    })
  }

  async function refreshQuotes(): Promise<void> {
    if (!window.moss.money.refreshInvestmentQuotes) return
    setNotice(null)
    await onMutate(async () => {
      const result = await window.moss.money.refreshInvestmentQuotes()
      await load()
      setNotice(
        result.stale
          ? 'Some quotes could not refresh — try manual prices for thinly traded symbols.'
          : `Updated ${result.updated} quote${result.updated === 1 ? '' : 's'}.`
      )
    })
  }

  return (
    <div className="money-settings-panel">
      {loading && <p className="money-data-copy">Loading trust settings…</p>}
      {loadError && <p className="money-error">{loadError}</p>}

      <section className="money-data-card money-settings-card">
        <p className="money-data-kicker">Privacy</p>
        <h2 className="money-data-title">Your money stays here</h2>
        <p className="money-data-copy">{overview?.privacyCopy ?? MONEY_PRIVACY_COPY}</p>
        <p className="money-data-trust">
          No bank sync in MOSS — you choose what to type, import, or quote. Limits are stated plainly,
          not hidden behind upsells.
        </p>
      </section>

      <section className="money-data-card money-settings-card">
        <p className="money-data-kicker">Freshness</p>
        <h2 className="money-data-title">When numbers go stale</h2>
        <p className="money-data-copy">
          Market quotes age out after a while so portfolio totals do not pretend to be live trading
          data. You can refresh anytime or enter a manual price per holding.
        </p>
        <div className="money-settings-field">
          <span className="money-settings-label">Treat quotes as stale after</span>
          <MossSelect
            className="money-settings-select"
            value={String(settings.quoteStaleMinutes)}
            options={QUOTE_STALE_OPTIONS}
            onChange={(value) => void saveSettings({ quoteStaleMinutes: Number.parseInt(value, 10) })}
            ariaLabel="Quote stale threshold"
            disabled={busy}
          />
        </div>
        {investmentsEnabled && (
          <div className="money-settings-actions">
            <button
              type="button"
              className="money-button money-button--ghost"
              disabled={busy}
              onClick={() => void refreshQuotes()}
            >
              Refresh market quotes now
            </button>
            {overview?.investments.lastQuoteFetchedAt && (
              <p className="money-settings-meta money-mono">
                Last quote {new Date(overview.investments.lastQuoteFetchedAt).toLocaleString()}
                {overview.investments.quotesStale && (
                  <>
                    {' '}
                    · <MoneyTrustBadge kind="stale" why={overview.investments.why} />
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="money-data-card money-settings-card">
        <p className="money-data-kicker">Savings</p>
        <h2 className="money-data-title">New goal defaults</h2>
        <p className="money-data-copy">
          Pick the template that opens when you create a savings goal. You can always change the name
          and target before saving.
        </p>
        <div className="money-settings-field">
          <span className="money-settings-label">Default goal type</span>
          <MossSelect
            className="money-settings-select"
            value={settings.defaultSavingsGoalKind}
            options={SAVINGS_TEMPLATE_OPTIONS}
            onChange={(value) =>
              void saveSettings({
                defaultSavingsGoalKind: value as MoneyTrustSettings['defaultSavingsGoalKind']
              })
            }
            ariaLabel="Default savings goal template"
            disabled={busy}
          />
        </div>
        {overview && overview.savings.goalCount > 0 && (
          <p className="money-settings-meta">
            {overview.savings.offTrackCount > 0 ? (
              <>
                <MoneyTrustBadge kind="estimated" why={overview.savings.why} /> {overview.savings.why}
              </>
            ) : (
              overview.savings.why
            )}
          </p>
        )}
      </section>

      <section className="money-data-card money-settings-card">
        <p className="money-data-kicker">Ledger</p>
        <h2 className="money-data-title">Reconciliation state</h2>
        <p className="money-data-copy">
          {overview?.ledger.why ??
            'Every ledger row is manual — typed or logged here, or brought in via Import.'}
        </p>
        {overview && (
          <ul className="money-settings-stats">
            <li>
              <span className="money-settings-stat-label">Accounts</span>
              <span className="money-settings-stat-value money-mono">{overview.ledger.accountCount}</span>
            </li>
            <li>
              <span className="money-settings-stat-label">Pending</span>
              <span className="money-settings-stat-value money-mono">{overview.ledger.pendingCount}</span>
            </li>
            <li>
              <span className="money-settings-stat-label">Cleared, not reconciled</span>
              <span className="money-settings-stat-value money-mono">
                {overview.ledger.unreconciledCount}
              </span>
            </li>
            {overview.ledger.importedCount > 0 && (
              <li>
                <span className="money-settings-stat-label">Imported rows</span>
                <span className="money-settings-stat-value money-mono">
                  {overview.ledger.importedCount}
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      {overview && overview.surfaces.length > 0 && (
        <section className="money-data-card money-settings-card">
          <p className="money-data-kicker">Trust labels</p>
          <h2 className="money-data-title">What each number means</h2>
          <p className="money-data-copy">
            Every headline tells you whether it is something you entered, something calculated from
            your budget, or a quote that may be aging.
          </p>
          <ul className="money-settings-surfaces">
            {overview.surfaces.map((surface) => (
              <li key={surface.id} className="money-settings-surface">
                <div className="money-settings-surface-head">
                  <span className="money-settings-surface-label">{surface.label}</span>
                  {CHIP_WORTHY_KINDS.has(surface.kind) && (
                    <MoneyTrustBadge kind={surface.kind} why={surface.why} />
                  )}
                </div>
                <p className="money-settings-surface-why">{surface.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="money-data-card money-settings-card">
        <p className="money-data-kicker">Advanced</p>
        <h2 className="money-data-title">Technical terms</h2>
        <p className="money-data-copy">
          The default path uses plain language. Turn on Advanced to see terms like &ldquo;ledger
          net&rdquo; and variable-pay tools in the budget view.
        </p>
        <label className="preference-field preference-field-module money-settings-advanced">
          <span className="preference-field-copy">
            <span className="preference-label">Show advanced money tools</span>
            <span className="preference-hint">Also available in Settings → Modules.</span>
          </span>
          <input
            type="checkbox"
            checked={advancedToolsEnabled}
            onChange={(event) =>
              setPreferences({
                modules: {
                  money: {
                    ...preferences.modules.money,
                    advancedToolsEnabled: event.target.checked
                  }
                }
              })
            }
          />
        </label>
      </section>

      {notice && <p className="money-data-notice">{notice}</p>}
    </div>
  )
}
