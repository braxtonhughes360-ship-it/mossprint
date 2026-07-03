import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CashAccountBalance,
  CategoryGroupRecord,
  CategoryRecord,
  PayeeRecord
} from '@shared/money'
import { formatMoneyCents, parseMoneyInput } from '@shared/money'
import type {
  MoneyReportsOverview,
  ReportFilters,
  ReportPresetRecord,
  ReportRangePreset,
  ReportViewMode
} from '@shared/moneyReports'
import { EMPTY_REPORT_FILTERS, normalizeMoneyReportsOverview, buildMoneyFlowViewData } from '@shared/moneyReports'
import { MossSelect } from './MossSelect'
import {
  MoneyCashFlowChart,
  MoneyNetWorthLine,
  MoneyReportHorizontalBars,
  MoneySparkline,
  MoneyWhereItWentFlow
} from './MoneyReportCharts'

interface MoneyReportsPanelProps {
  periodKey: string
  accounts: CashAccountBalance[]
  categories: CategoryRecord[]
  groups: CategoryGroupRecord[]
  payees: PayeeRecord[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

const RANGE_OPTIONS: Array<{ value: ReportRangePreset; label: string }> = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'year_to_date', label: 'Year to date' },
  { value: 'custom', label: 'Custom range' }
]

function deltaLabel(cents: number): string {
  if (cents === 0) return 'Even'
  const prefix = cents > 0 ? '+' : '−'
  return `${prefix}${formatMoneyCents(Math.abs(cents))}`
}

function deltaClass(cents: number, invert = false): string {
  if (cents === 0) return 'money-report-delta--even'
  const positive = cents > 0
  const good = invert ? !positive : positive
  return good ? 'money-report-delta--good' : 'money-report-delta--warn'
}

export function MoneyReportsPanel({
  periodKey,
  accounts,
  categories,
  groups,
  payees,
  busy,
  onMutate
}: MoneyReportsPanelProps): React.JSX.Element {
  const [filters, setFilters] = useState<ReportFilters>({ ...EMPTY_REPORT_FILTERS })
  const [viewMode, setViewMode] = useState<ReportViewMode>('chart')
  const [overview, setOverview] = useState<MoneyReportsOverview | null>(null)
  const [presets, setPresets] = useState<ReportPresetRecord[]>([])
  const [presetName, setPresetName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const loadReports = useCallback(async () => {
    if (!window.moss?.money) {
      setError('Money storage unavailable')
      setLoading(false)
      return
    }
    if (!window.moss.money.getReportsOverview) {
      setError('Reports need a full app restart — quit MOSS and run npm run dev again.')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const raw = await window.moss.money.getReportsOverview(filters, periodKey)
      setOverview(normalizeMoneyReportsOverview(raw, periodKey))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }

    try {
      const nextPresets = await window.moss.money.listReportPresets?.()
      setPresets(Array.isArray(nextPresets) ? nextPresets : [])
    } catch {
      setPresets([])
    }
  }, [filters, periodKey])

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  function patchFilters(patch: Partial<ReportFilters>): void {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  // Range lives in the always-visible toolbar; everything else is an "advanced"
  // filter that hides behind the disclosure so the default view stays calm.
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.accountId) count += 1
    if (filters.groupId) count += 1
    if (filters.categoryId) count += 1
    if (filters.payeeId) count += 1
    if (filters.tag) count += 1
    if (filters.minCents !== null) count += 1
    if (filters.maxCents !== null) count += 1
    return count
  }, [filters])

  function clearFilters(): void {
    setFilters((prev) => ({
      ...EMPTY_REPORT_FILTERS,
      rangePreset: prev.rangePreset,
      from: prev.from,
      to: prev.to
    }))
  }

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'All envelopes' },
      ...categories.map((cat) => ({ value: cat.id, label: cat.name }))
    ],
    [categories]
  )

  const groupOptions = useMemo(
    () => [
      { value: '', label: 'All groups' },
      ...groups.map((group) => ({ value: group.id, label: group.name }))
    ],
    [groups]
  )

  const accountOptions = useMemo(
    () => [
      { value: '', label: 'All accounts' },
      ...accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))
    ],
    [accounts]
  )

  const payeeOptions = useMemo(
    () => [
      { value: '', label: 'All payees' },
      ...payees.slice(0, 40).map((payee) => ({ value: payee.id, label: payee.name }))
    ],
    [payees]
  )

  const topSpend = overview?.spendingByCategory?.[0]
  const savingsOnTrack = overview?.savingsGlance?.filter((g) => g.onTrack).length ?? 0
  const savingsTotal = overview?.savingsGlance?.length ?? 0
  const netWorthSeries = overview?.netWorthSeries ?? []
  const netWorthLatest = netWorthSeries.length > 0 ? netWorthSeries[netWorthSeries.length - 1] : undefined
  const netWorthPrior = netWorthSeries.length >= 2 ? netWorthSeries[netWorthSeries.length - 2] : undefined
  const netWorthDelta =
    netWorthLatest && netWorthPrior ? netWorthLatest.totalCents - netWorthPrior.totalCents : 0

  const whereItWent = useMemo(() => {
    if (!overview) return null
    return buildMoneyFlowViewData(
      overview.transactionSummary.incomeCents,
      overview.spendingByCategory
    )
  }, [overview])

  return (
    <div className="money-reports-panel">
      <header className="money-reports-head">
        <div>
          <p className="money-reports-kicker">Reports</p>
          <h2 className="money-reports-title">
            {overview?.rangeLabel ?? 'Loading…'}
            <span className="money-reports-derived"> · derived from your ledger</span>
          </h2>
        </div>
        <div className="money-reports-view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={['money-reports-view-btn', viewMode === 'chart' ? 'money-reports-view-btn--active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={viewMode === 'chart'}
            onClick={() => setViewMode('chart')}
          >
            Chart
          </button>
          <button
            type="button"
            className={['money-reports-view-btn', viewMode === 'table' ? 'money-reports-view-btn--active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={viewMode === 'table'}
            onClick={() => setViewMode('table')}
          >
            Table
          </button>
        </div>
      </header>

      <div className="money-reports-toolbar">
        <label className="money-reports-range">
          <span className="money-reports-filter-label">Showing</span>
          <MossSelect
            className="money-select--register"
            ariaLabel="Date range"
            value={filters.rangePreset}
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(value) => {
              patchFilters({ rangePreset: value as ReportRangePreset })
              if (value === 'custom') setFiltersOpen(true)
            }}
          />
        </label>
        <div className="money-reports-toolbar-actions">
          {activeFilterCount > 0 && (
            <button type="button" className="money-reports-filter-clear" onClick={clearFilters}>
              Clear
            </button>
          )}
          <button
            type="button"
            className={['money-reports-filter-toggle', filtersOpen ? 'money-reports-filter-toggle--open' : '']
              .filter(Boolean)
              .join(' ')}
            aria-expanded={filtersOpen}
            aria-controls="money-reports-advanced"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="money-reports-filter-count" aria-label={`${activeFilterCount} active`}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="money-reports-advanced" id="money-reports-advanced">
          <div className="money-reports-filterbar">
            {filters.rangePreset === 'custom' && (
              <>
                <label className="money-reports-filter-field">
                  <span className="money-reports-filter-label">From</span>
                  <input
                    type="date"
                    className="money-input money-mono"
                    value={filters.from ?? ''}
                    onChange={(event) => patchFilters({ from: event.target.value || null })}
                  />
                </label>
                <label className="money-reports-filter-field">
                  <span className="money-reports-filter-label">To</span>
                  <input
                    type="date"
                    className="money-input money-mono"
                    value={filters.to ?? ''}
                    onChange={(event) => patchFilters({ to: event.target.value || null })}
                  />
                </label>
              </>
            )}
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Account</span>
              <MossSelect
                className="money-select--register"
                ariaLabel="Account filter"
                value={filters.accountId ?? ''}
                options={accountOptions}
                onChange={(value) => patchFilters({ accountId: value || null })}
              />
            </label>
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Group</span>
              <MossSelect
                className="money-select--register"
                ariaLabel="Group filter"
                value={filters.groupId ?? ''}
                options={groupOptions}
                onChange={(value) => patchFilters({ groupId: value || null })}
              />
            </label>
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Envelope</span>
              <MossSelect
                className="money-select--register"
                ariaLabel="Envelope filter"
                value={filters.categoryId ?? ''}
                options={categoryOptions}
                onChange={(value) => patchFilters({ categoryId: value || null })}
              />
            </label>
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Payee</span>
              <MossSelect
                className="money-select--register"
                ariaLabel="Payee filter"
                value={filters.payeeId ?? ''}
                options={payeeOptions}
                onChange={(value) => patchFilters({ payeeId: value || null })}
              />
            </label>
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Tag</span>
              <input
                type="text"
                className="money-input"
                placeholder="Any tag"
                value={filters.tag ?? ''}
                onChange={(event) => patchFilters({ tag: event.target.value.trim() || null })}
              />
            </label>
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Min</span>
              <input
                type="text"
                inputMode="decimal"
                className="money-input money-mono"
                placeholder="0"
                value={filters.minCents === null ? '' : (filters.minCents / 100).toString()}
                onChange={(event) => {
                  const cents = event.target.value ? parseMoneyInput(event.target.value) : null
                  patchFilters({ minCents: cents })
                }}
              />
            </label>
            <label className="money-reports-filter-field">
              <span className="money-reports-filter-label">Max</span>
              <input
                type="text"
                inputMode="decimal"
                className="money-input money-mono"
                placeholder="Any"
                value={filters.maxCents === null ? '' : (filters.maxCents / 100).toString()}
                onChange={(event) => {
                  const cents = event.target.value ? parseMoneyInput(event.target.value) : null
                  patchFilters({ maxCents: cents })
                }}
              />
            </label>
          </div>

          <div className="money-reports-presets">
            {presets.length > 0 && (
              <div className="money-reports-preset-list" role="list" aria-label="Saved report presets">
                {presets.map((preset) => (
                  <div key={preset.id} className="money-reports-preset-chip" role="listitem">
                    <button
                      type="button"
                      className="money-reports-preset-load"
                      disabled={busy}
                      onClick={() => {
                        setFilters(preset.filters)
                        setViewMode(preset.viewMode)
                      }}
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      className="money-reports-preset-delete"
                      aria-label={`Delete preset ${preset.name}`}
                      disabled={busy}
                      onClick={() => {
                        void onMutate(async () => {
                          await window.moss.money.deleteReportPreset?.(preset.id)
                          await loadReports()
                        })
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              className="money-reports-preset-save"
              onSubmit={(event) => {
                event.preventDefault()
                const name = presetName.trim()
                if (!name) return
                void onMutate(async () => {
                  await window.moss.money.createReportPreset?.({
                    name,
                    filters,
                    viewMode
                  })
                  setPresetName('')
                  await loadReports()
                })
              }}
            >
              <input
                type="text"
                className="money-input"
                placeholder="Save current filters as…"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
              />
              <button type="submit" className="money-button money-button--ghost" disabled={busy || !presetName.trim()}>
                Save preset
              </button>
            </form>
          </div>
        </div>
      )}

      {error && <p className="money-error">{error}</p>}
      {loading && !overview && <p className="money-reports-loading">Loading reports…</p>}

      {overview && !overview.hasData && !loading && (
        <div className="money-reports-empty">
          <p className="money-reports-empty-title">Nothing to report yet</p>
          <p className="money-reports-empty-copy">{overview.emptyWhy}</p>
        </div>
      )}

      {overview && overview.hasData && (
        <>
          <div className="money-reports-summary-grid">
            <article className="money-reports-summary-card">
              <p className="money-reports-summary-kicker">Where it went</p>
              <p className="money-reports-summary-value money-mono">
                {topSpend ? formatMoneyCents(topSpend.spentCents) : '—'}
              </p>
              <p className="money-reports-summary-detail">
                {topSpend
                  ? `Top: ${topSpend.categoryName}${topSpend.groupName ? ` · ${topSpend.groupName}` : ''}`
                  : 'No spending in this range'}
              </p>
            </article>

            <article className="money-reports-summary-card">
              <p className="money-reports-summary-kicker">Vs last month</p>
              <p className="money-reports-summary-value money-mono">
                {formatMoneyCents(overview.comparison.current.spentCents)}
              </p>
              <p className={`money-reports-summary-delta money-mono ${deltaClass(overview.comparison.deltaSpentCents, true)}`}>
                {deltaLabel(overview.comparison.deltaSpentCents)} spent
              </p>
              <p className="money-reports-summary-detail">{overview.comparison.why}</p>
            </article>

            <article className="money-reports-summary-card">
              <p className="money-reports-summary-kicker">Savings</p>
              <p className="money-reports-summary-value money-mono">
                {savingsTotal > 0 ? `${savingsOnTrack}/${savingsTotal} on track` : 'No goals'}
              </p>
              <p className="money-reports-summary-detail">
                {savingsTotal > 0
                  ? overview.savingsGlance.find((g) => !g.onTrack)?.why ||
                    overview.savingsGlance[0]?.why ||
                    'All goals on pace this month.'
                  : 'Create a savings goal on the Budget tab.'}
              </p>
            </article>

            <article className="money-reports-summary-card">
              <p className="money-reports-summary-kicker">Net worth</p>
              <p className="money-reports-summary-value money-mono">
                {netWorthLatest ? formatMoneyCents(netWorthLatest.totalCents) : '—'}
              </p>
              {netWorthSeries.length >= 1 && (
                <MoneySparkline values={netWorthSeries.map((p) => p.totalCents)} />
              )}
              {netWorthPrior && (
                <p className={`money-reports-summary-delta money-mono ${deltaClass(netWorthDelta)}`}>
                  {deltaLabel(netWorthDelta)} vs prior month
                </p>
              )}
              {netWorthLatest?.estimated && (
                <p className="money-reports-summary-detail">
                  <span className="money-chip">Estimated</span> investment history uses current quotes where snapshots are missing.
                </p>
              )}
            </article>
          </div>

          <section className="money-reports-section" aria-labelledby="money-report-where">
            <div className="money-reports-section-head">
              <h3 id="money-report-where" className="money-reports-section-title">
                Where it went
              </h3>
              <p className="money-reports-section-meta">
                {whereItWent
                  ? `${formatMoneyCents(whereItWent.incomeCents > 0 ? whereItWent.incomeCents : whereItWent.spentCents)} in this period`
                  : 'Money in → where it went out'}
              </p>
            </div>
            {viewMode === 'chart' ? (
              whereItWent ? (
                <MoneyWhereItWentFlow data={whereItWent} />
              ) : (
                <p className="money-reports-section-empty">
                  No spending matched these filters — import or log expenses to see the flow.
                </p>
              )
            ) : whereItWent ? (
              <table className="money-reports-table">
                <thead>
                  <tr>
                    <th scope="col">Group</th>
                    <th scope="col">Envelope</th>
                    <th scope="col" className="money-reports-table-num">
                      Spent
                    </th>
                    <th scope="col" className="money-reports-table-num">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {whereItWent.groups.flatMap((group) =>
                    group.topCategories.map((cat, index) => (
                      <tr key={`${group.id}-${cat.id}`}>
                        <td>{index === 0 ? group.name : ''}</td>
                        <td>{cat.name}</td>
                        <td className="money-reports-table-num money-mono">
                          {formatMoneyCents(cat.spentCents)}
                        </td>
                        <td className="money-reports-table-num money-mono">
                          {Math.round(cat.shareOfSpent * 100)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <p className="money-reports-section-empty">No spending matched these filters.</p>
            )}
          </section>

          <section className="money-reports-section" aria-labelledby="money-report-spending">
            <div className="money-reports-section-head">
              <h3 id="money-report-spending" className="money-reports-section-title">
                Spending by envelope
              </h3>
              <p className="money-reports-section-meta money-mono">
                {formatMoneyCents(overview.transactionSummary.expenseCents)} spent this period
              </p>
            </div>
            {viewMode === 'chart' && overview.spendingByCategory.length > 0 && (
              <p className="money-reports-section-hint">
                Amounts are what you spent. Bar length compares to your biggest expense — not your
                budget limit.
              </p>
            )}
            {overview.spendingByCategory.length === 0 ? (
              <p className="money-reports-section-empty">No spending matched these filters.</p>
            ) : viewMode === 'chart' ? (
              <MoneyReportHorizontalBars
                rows={overview.spendingByCategory.map((row) => ({
                  id: row.categoryId,
                  label: row.categoryName,
                  value: row.spentCents,
                  sublabel: row.groupName ?? undefined
                }))}
                formatValue={formatMoneyCents}
              />
            ) : (
              <table className="money-reports-table">
                <thead>
                  <tr>
                    <th scope="col">Envelope</th>
                    <th scope="col">Group</th>
                    <th scope="col" className="money-reports-table-num">
                      Spent
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.spendingByCategory.map((row) => (
                    <tr key={row.categoryId}>
                      <td>{row.categoryName}</td>
                      <td>{row.groupName ?? '—'}</td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.spentCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="money-reports-section" aria-labelledby="money-report-cashflow">
            <div className="money-reports-section-head">
              <h3 id="money-report-cashflow" className="money-reports-section-title">
                Cash flow
              </h3>
              <p className="money-reports-section-meta">Money in − money out</p>
            </div>
            {viewMode === 'chart' ? (
              <MoneyCashFlowChart series={overview.cashFlowSeries} />
            ) : (
              <table className="money-reports-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="money-reports-table-num">
                      In
                    </th>
                    <th scope="col" className="money-reports-table-num">
                      Out
                    </th>
                    <th scope="col" className="money-reports-table-num">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.cashFlowSeries.map((row) => (
                    <tr key={row.periodKey}>
                      <td>{row.label}</td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.incomeCents)}
                      </td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.spentCents)}
                      </td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.netFlowCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="money-reports-section" aria-labelledby="money-report-networth">
            <div className="money-reports-section-head">
              <h3 id="money-report-networth" className="money-reports-section-title">
                Net worth trend
              </h3>
              <p className="money-reports-section-meta">Cash + investments · local only</p>
            </div>
            {viewMode === 'chart' ? (
              <MoneyNetWorthLine series={overview.netWorthSeries} />
            ) : (
              <table className="money-reports-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="money-reports-table-num">
                      Cash
                    </th>
                    <th scope="col" className="money-reports-table-num">
                      Investments
                    </th>
                    <th scope="col" className="money-reports-table-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.netWorthSeries.map((row) => (
                    <tr key={row.periodKey}>
                      <td>
                        {row.label}
                        {row.estimated && (
                          <span className="money-chip money-reports-est-chip">Est.</span>
                        )}
                      </td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.cashCents)}
                      </td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.investmentCents)}
                      </td>
                      <td className="money-reports-table-num money-mono">
                        {formatMoneyCents(row.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {overview.savingsGlance.length > 0 && (
            <section className="money-reports-section" aria-labelledby="money-report-savings">
              <div className="money-reports-section-head">
                <h3 id="money-report-savings" className="money-reports-section-title">
                  Savings goals
                </h3>
              </div>
              <ul className="money-reports-savings-list">
                {overview.savingsGlance.map((goal) => (
                  <li key={goal.goalId} className="money-reports-savings-row">
                    <div className="money-reports-savings-head">
                      <span className="money-reports-savings-name">{goal.name}</span>
                      <span className="money-mono">
                        {formatMoneyCents(goal.savedCents)} / {formatMoneyCents(goal.targetCents)}
                      </span>
                    </div>
                    <span className="money-reports-savings-track" aria-hidden>
                      <span
                        className="money-reports-savings-fill"
                        style={{ width: `${Math.round(goal.progress * 100)}%` }}
                      />
                    </span>
                    <p className="money-reports-savings-why">
                      {goal.onTrack ? (
                        goal.why
                      ) : (
                        <>
                          <span className="money-flow-status money-flow-status--tight">
                            Needs attention
                          </span>
                          {goal.why ? ` · ${goal.why}` : ''}
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
