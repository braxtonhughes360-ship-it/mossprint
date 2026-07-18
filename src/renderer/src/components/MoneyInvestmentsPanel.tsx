import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  InvestmentAccountType,
  InvestmentActivityType,
  InvestmentHoldingRecord,
  InvestmentSnapshotRecord,
  InvestmentsOverview
} from '@shared/money'
import {
  formatMoneyCents,
  holdingPriceCents,
  normalizeInvestmentsOverview,
  parseMoneyInput
} from '@shared/money'
import { MoneyAllocationBar } from './MoneyAllocationBar'
import { MossSelect } from './MossSelect'
import { MossButton } from './MossButton'
import { MossDateField } from './MossDateField'

const ACCOUNT_TYPES: InvestmentAccountType[] = ['401k', 'brokerage', 'ira', 'other']

const ACTIVITY_TYPES: Array<{ value: InvestmentActivityType; label: string }> = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'fee', label: 'Fee' },
  { value: 'interest', label: 'Interest' }
]

const ALLOCATION_PRESETS = ['Stocks', 'Bonds', 'Cash', 'Real estate', 'Other']

function formatAccountType(type: InvestmentAccountType): string {
  if (type === '401k') return '401(k)'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function formatAsOfDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(iso))
}

function formatQuoteTime(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

function formatQuoteAge(iso: string | null): string {
  if (!iso) return 'never refreshed'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return formatAsOfDate(iso)
}

function formatShares(quantity: number): string {
  if (Number.isInteger(quantity) || Math.abs(quantity - Math.round(quantity)) < 0.001) {
    return String(Math.round(quantity))
  }
  return quantity.toFixed(quantity < 1 ? 4 : 2)
}

function formatActivityType(type: InvestmentActivityType): string {
  return ACTIVITY_TYPES.find((row) => row.value === type)?.label ?? type
}

function formatPerformancePercent(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function formatDayChangePercent(value: number): string {
  if (value === 0) return '0.0%'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

/** Money with an explicit + for gains (formatMoneyCents already prefixes − for losses). */
function formatSignedMoneyCents(cents: number): string {
  const formatted = formatMoneyCents(cents)
  return cents > 0 ? `+${formatted}` : formatted
}

const ALLOCATION_SLICE_COLORS = [
  'oklch(0.52 0.13 145)',
  'oklch(0.65 0.14 65)',
  'oklch(0.58 0.14 240)',
  'oklch(0.58 0.14 285)',
  'oklch(0.55 0.12 32)'
] as const

const ACCOUNT_TYPE_COLORS: Record<InvestmentAccountType, string> = {
  '401k': ALLOCATION_SLICE_COLORS[0],
  brokerage: ALLOCATION_SLICE_COLORS[2],
  ira: ALLOCATION_SLICE_COLORS[3],
  other: ALLOCATION_SLICE_COLORS[4]
}

function allocationColorForTag(tag: string, index: number): string {
  const normalized = tag.toLowerCase().trim()
  if (normalized.includes('bond')) return ALLOCATION_SLICE_COLORS[1]
  if (normalized.includes('intl') && normalized.includes('equity')) return ALLOCATION_SLICE_COLORS[2]
  if (normalized.includes('equity') || normalized.includes('stock')) return ALLOCATION_SLICE_COLORS[0]
  if (normalized.includes('cash')) return 'oklch(0.62 0.04 145)'
  return ALLOCATION_SLICE_COLORS[index % ALLOCATION_SLICE_COLORS.length]
}

function allocationSegmentClass(tag: string, index: number): string {
  const normalized = tag.toLowerCase().trim()
  const slug = normalized.replace(/\s+/g, '-')
  if (slug === 'intl-equity') return 'money-portfolio-allocation-segment--intl-equity'
  if (['stocks', 'bonds', 'cash', 'real-estate', 'other', 'unclassified'].includes(slug)) {
    return `money-portfolio-allocation-segment--${slug}`
  }
  if (normalized.includes('bond')) return 'money-portfolio-allocation-segment--bonds'
  if (normalized.includes('intl') && normalized.includes('equity')) {
    return 'money-portfolio-allocation-segment--intl-equity'
  }
  if (normalized.includes('equity') || normalized.includes('stock')) {
    return 'money-portfolio-allocation-segment--stocks'
  }
  if (normalized.includes('cash')) return 'money-portfolio-allocation-segment--cash'
  return `money-portfolio-allocation-segment--tag-${index % 5}`
}

interface FlatHolding {
  holding: InvestmentHoldingRecord
  accountLabel: string
  accountType: InvestmentAccountType
}

function flattenHoldings(overview: InvestmentsOverview): FlatHolding[] {
  const rows: FlatHolding[] = []
  for (const accountRow of overview.accounts) {
    for (const holding of accountRow.holdings ?? []) {
      rows.push({
        holding,
        accountLabel: accountRow.account.label,
        accountType: accountRow.account.accountType
      })
    }
  }
  return rows.sort((a, b) => b.holding.marketValueCents - a.holding.marketValueCents)
}

function latestQuoteFetchedAt(holdings: FlatHolding[]): string | null {
  let latest: string | null = null
  for (const row of holdings) {
    const fetchedAt = row.holding.quoteFetchedAt
    if (fetchedAt && (!latest || fetchedAt > latest)) {
      latest = fetchedAt
    }
  }
  return latest
}

interface MoneyInvestmentsPanelProps {
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

export function MoneyInvestmentsPanel({
  busy,
  onMutate
}: MoneyInvestmentsPanelProps): React.JSX.Element {
  const [overview, setOverview] = useState<InvestmentsOverview | null>(null)
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<InvestmentSnapshotRecord[]>([])
  const [accountLabel, setAccountLabel] = useState('')
  const [accountType, setAccountType] = useState<InvestmentAccountType>('401k')
  const [snapshotAccountId, setSnapshotAccountId] = useState('')
  const [snapshotAmount, setSnapshotAmount] = useState('')
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [holdingSymbol, setHoldingSymbol] = useState('')
  const [holdingQuantity, setHoldingQuantity] = useState('')
  const [holdingCostBasis, setHoldingCostBasis] = useState('')
  const [holdingAllocationTag, setHoldingAllocationTag] = useState('Stocks')
  const [activityAccountId, setActivityAccountId] = useState('')
  const [activityType, setActivityType] = useState<InvestmentActivityType>('buy')
  const [activitySymbol, setActivitySymbol] = useState('')
  const [activityQuantity, setActivityQuantity] = useState('')
  const [activityAmount, setActivityAmount] = useState('')
  const [activityDate, setActivityDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [activityMemo, setActivityMemo] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  async function loadOverview(): Promise<void> {
    if (!window.moss?.money?.getInvestments) {
      setLoadError('Investment storage unavailable — restart the app to load the latest bridge.')
      return
    }

    try {
      const next = normalizeInvestmentsOverview(await window.moss.money.getInvestments())
      setOverview(next)
      setLoadError(null)
      if (!snapshotAccountId && next.accounts.length > 0) {
        setSnapshotAccountId(next.accounts[0].account.id)
        setActivityAccountId(next.accounts[0].account.id)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load investments')
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  useEffect(() => {
    if (!expandedAccountId || !window.moss?.money) {
      setSnapshots([])
      return
    }
    void window.moss.money.listInvestmentSnapshots(expandedAccountId, 8).then(setSnapshots)
  }, [expandedAccountId])

  const flatHoldings = useMemo(
    () => (overview ? flattenHoldings(overview) : []),
    [overview]
  )

  const lastQuoteAt = useMemo(() => latestQuoteFetchedAt(flatHoldings), [flatHoldings])

  const accountTypeAllocation = useMemo(() => {
    if (!overview?.accounts.length) return []
    const byType = new Map<InvestmentAccountType, number>()
    for (const row of overview.accounts) {
      const value = row.valueCents > 0 ? row.valueCents : (row.latestSnapshot?.valueCents ?? 0)
      if (value <= 0) continue
      byType.set(row.account.accountType, (byType.get(row.account.accountType) ?? 0) + value)
    }
    return Array.from(byType.entries()).sort((a, b) => b[1] - a[1])
  }, [overview])

  const portfolioTotal = overview?.holdingsTotalCents ?? overview?.totalCents ?? 0
  const hasHoldings = flatHoldings.length > 0
  const quotesLive = hasHoldings && !overview?.quotesStale
  const hasPerformanceData = (overview?.performance ?? []).some((row) => row.changePercent !== null)

  // Portfolio "Today" — honest intraday change aggregated from live quotes (not snapshots).
  const portfolioDayChange = useMemo(() => {
    let changeCents = 0
    let prevTotal = 0
    let contributing = 0
    for (const { holding } of flatHoldings) {
      const pct = holding.quoteDayChangePercent
      const isManual = Boolean(holding.manualPriceCents && !holding.quotePriceCents)
      if (pct === null || isManual || holding.quoteStale || holding.marketValueCents <= 0) continue
      const prev = holding.marketValueCents / (1 + pct / 100)
      if (!Number.isFinite(prev) || prev <= 0) continue
      changeCents += holding.marketValueCents - prev
      prevTotal += prev
      contributing += 1
    }
    if (contributing === 0 || prevTotal <= 0) return null
    return { changeCents: Math.round(changeCents), changePercent: (changeCents / prevTotal) * 100 }
  }, [flatHoldings])

  // Auto-refresh once when quotes are stale on load (throttled across remounts; never loops).
  const autoRefreshedRef = useRef(false)
  useEffect(() => {
    if (autoRefreshedRef.current) return
    if (!overview || !hasHoldings || !overview.quotesStale) return
    if (!window.moss?.money?.refreshInvestmentQuotes) return
    let lastAt = 0
    try {
      lastAt = Number(sessionStorage.getItem('moss.invest.autoRefreshAt')) || 0
    } catch {
      lastAt = 0
    }
    if (Date.now() - lastAt < 5 * 60_000) return
    autoRefreshedRef.current = true
    try {
      sessionStorage.setItem('moss.invest.autoRefreshAt', String(Date.now()))
    } catch {
      // best-effort throttle only
    }
    void refreshAfterMutation(async () => {
      await window.moss.money.refreshInvestmentQuotes()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, hasHoldings])

  async function refreshAfterMutation(task: () => Promise<void>): Promise<void> {
    await onMutate(async () => {
      await task()
      await loadOverview()
      if (expandedAccountId && window.moss?.money) {
        const nextSnapshots = await window.moss.money.listInvestmentSnapshots(expandedAccountId, 8)
        setSnapshots(nextSnapshots)
      }
    })
  }

  const activityNeedsSymbol = activityType === 'buy' || activityType === 'sell'

  return (
    <div className="money-workspace">
      <section className="money-instrument-panel money-portfolio-hero" aria-label="Portfolio total">
        <div className="money-instrument-head">
          <div>
            <p className="money-instrument-kicker">Portfolio</p>
            <p className="money-portfolio-total money-mono">{formatMoneyCents(portfolioTotal)}</p>
            {quotesLive && portfolioDayChange && (
              <p
                className={[
                  'money-portfolio-today money-mono',
                  portfolioDayChange.changeCents >= 0
                    ? 'money-register-amount--in'
                    : 'money-register-amount--out'
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                Today {formatSignedMoneyCents(portfolioDayChange.changeCents)} (
                {formatDayChangePercent(portfolioDayChange.changePercent)})
              </p>
            )}
            {hasHoldings ? (
              <p className="money-portfolio-caption money-invest-quote-status">
                {quotesLive ? (
                  <>
                    <span className="money-invest-quote-live">Live</span>
                    {' · '}
                    Quotes {formatQuoteAge(lastQuoteAt)}
                    {lastQuoteAt && (
                      <>
                        {' '}
                        <span className="money-invest-quote-asof">({formatQuoteTime(lastQuoteAt)})</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="money-chip money-chip--warn">Stale</span>
                    {' · '}
                    Last quote {formatQuoteAge(lastQuoteAt)}
                    {lastQuoteAt && (
                      <>
                        {' '}
                        <span className="money-invest-quote-asof">({formatQuoteTime(lastQuoteAt)})</span>
                      </>
                    )}
                    {' — refresh for current prices'}
                  </>
                )}
              </p>
            ) : (
              <p className="money-portfolio-caption">
                {overview?.accounts.length ?? 0} account
                {(overview?.accounts.length ?? 0) === 1 ? '' : 's'}
                {' · manual snapshots'}
              </p>
            )}
            <p className="money-portfolio-caption money-invest-track-note">
              Track positions you enter — MOSS doesn&apos;t place trades or give advice.
            </p>
          </div>
          {hasHoldings && (
            <MossButton
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                void refreshAfterMutation(async () => {
                  await window.moss.money.refreshInvestmentQuotes()
                })
              }}
            >
              Refresh quotes
            </MossButton>
          )}
        </div>
      </section>

      {loadError && <p className="money-error">{loadError}</p>}

      {overview && hasHoldings && (
        <section className="money-instrument-panel money-invest-holdings-lead" aria-label="Holdings">
          <header className="money-instrument-head">
            <div>
              <p className="money-instrument-kicker">Positions</p>
              <h2 className="money-instrument-title">What you own</h2>
              <p className="money-portfolio-caption">
                Values from your latest quotes — stale rows are marked plainly.
              </p>
            </div>
          </header>

          <PortfolioHoldingsList holdings={flatHoldings} />
        </section>
      )}

      {overview &&
        (hasHoldings ||
          hasPerformanceData ||
          (overview.allocation?.length ?? 0) > 0 ||
          accountTypeAllocation.length > 0) && (
          <details className="money-instrument-panel money-invest-secondary">
            <summary className="money-invest-secondary-summary">
              <span className="money-instrument-kicker">More</span>
              <span className="money-instrument-title">Performance &amp; mix</span>
            </summary>

            <div className="money-invest-secondary-body">
              {!hasPerformanceData && hasHoldings && (
                <div className="money-invest-performance money-invest-performance--secondary" aria-label="Performance windows">
                  <p className="money-instrument-kicker">Performance</p>
                  <p className="money-invest-performance-empty">
                    Log an account balance snapshot to track Today, MTD, YTD and all-time
                    performance over time.
                  </p>
                </div>
              )}
              {hasPerformanceData && (
                <div className="money-invest-performance money-invest-performance--secondary" aria-label="Performance windows">
                  <p className="money-instrument-kicker">Performance</p>
                  <ul className="money-invest-performance-grid money-mono">
                    {overview.performance.map((row) => (
                      <li key={row.window} className="money-invest-performance-cell">
                        <span className="money-invest-performance-label">{row.label}</span>
                        <span
                          className={
                            row.changePercent === null
                              ? 'money-invest-performance-value'
                              : row.changePercent >= 0
                                ? 'money-invest-performance-value money-register-amount--in'
                                : 'money-invest-performance-value money-register-amount--out'
                          }
                          title={row.why}
                        >
                          {formatPerformancePercent(row.changePercent)}
                        </span>
                        {row.estimated && <span className="money-chip money-chip--quiet">Est.</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="money-portfolio-caption money-invest-refresh-note">
                    Windows compare to balance snapshots — log snapshots regularly for honest trends.
                  </p>
                </div>
              )}

              {(overview.allocation?.length ?? 0) > 0 && portfolioTotal > 0 && (
                <div className="money-portfolio-allocation">
                  <p className="money-instrument-kicker">Asset mix</p>
                  <MoneyAllocationBar
                    ariaLabel="Allocation by asset class — hover or focus a band for its share"
                    segments={overview.allocation.map((slice, index) => ({
                      id: slice.tag,
                      name: slice.tag,
                      percent: slice.percent,
                      valueLabel: formatMoneyCents(slice.cents),
                      color: allocationColorForTag(slice.tag, index),
                      className: allocationSegmentClass(slice.tag, index)
                    }))}
                  />
                </div>
              )}

              {accountTypeAllocation.length > 0 && portfolioTotal > 0 && (
                <div className="money-portfolio-allocation money-portfolio-allocation--accounts">
                  <p className="money-instrument-kicker">By account type</p>
                  <MoneyAllocationBar
                    ariaLabel="Allocation by account type — hover or focus a band for its share"
                    segments={accountTypeAllocation.map(([type, cents]) => ({
                      id: type,
                      name: formatAccountType(type),
                      percent: Math.round((cents / portfolioTotal) * 100),
                      valueLabel: formatMoneyCents(cents),
                      color: ACCOUNT_TYPE_COLORS[type]
                    }))}
                  />
                </div>
              )}
            </div>
          </details>
        )}

      {overview && overview.accounts.length > 0 && (
        <section className="money-instrument-panel" aria-label="Investment activity">
          <header className="money-instrument-head">
            <div>
              <p className="money-instrument-kicker">Activity</p>
              <h2 className="money-instrument-title">What happened</h2>
              <p className="money-portfolio-caption">
                Buys and sells update holdings when you include a symbol and quantity. Dividends, fees,
                and interest are income or cost only.
              </p>
            </div>
          </header>

          <form
            className="money-form money-form--stacked money-invest-activity-form"
            onSubmit={(event) => {
              event.preventDefault()
              const amountCents = parseMoneyInput(activityAmount)
              if (!amountCents || amountCents <= 0 || !activityAccountId) return
              const quantity = activityQuantity.trim()
                ? Number.parseFloat(activityQuantity)
                : null

              void refreshAfterMutation(async () => {
                await window.moss.money.createInvestmentActivity({
                  accountId: activityAccountId,
                  type: activityType,
                  symbol: activitySymbol.trim() || null,
                  quantity:
                    quantity !== null && Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                  amountCents,
                  occurredAt: new Date(`${activityDate}T12:00:00`).toISOString(),
                  memo: activityMemo.trim()
                })
                setActivityAmount('')
                setActivityQuantity('')
                setActivitySymbol('')
                setActivityMemo('')
              })
            }}
          >
            <div className="money-form money-form--inline">
              <MossSelect
                className="money-select--inline"
                value={activityAccountId}
                options={overview.accounts.map((row) => ({
                  value: row.account.id,
                  label: row.account.label
                }))}
                onChange={setActivityAccountId}
                ariaLabel="Account"
              />
              <MossSelect
                className="money-select--inline"
                value={activityType}
                options={ACTIVITY_TYPES.map((row) => ({ value: row.value, label: row.label }))}
                onChange={(next) => setActivityType(next as InvestmentActivityType)}
                ariaLabel="Activity type"
              />
              <input
                className="money-input money-input--amount money-input--inline money-mono"
                value={activityAmount}
                onChange={(event) => setActivityAmount(event.target.value)}
                placeholder="Amount"
                inputMode="decimal"
                aria-label="Amount"
                required
              />
              <MossDateField
                className="money-date-field--inline"
                value={activityDate}
                onChange={(event) => setActivityDate(event.target.value)}
                aria-label="Date"
              />
            </div>
            <div className="money-form money-form--inline">
              {activityNeedsSymbol && (
                <>
                  <input
                    className="money-input money-input--inline money-mono"
                    value={activitySymbol}
                    onChange={(event) => setActivitySymbol(event.target.value)}
                    placeholder="Symbol (optional)"
                    aria-label="Symbol"
                  />
                  <input
                    className="money-input money-input--inline money-mono"
                    value={activityQuantity}
                    onChange={(event) => setActivityQuantity(event.target.value)}
                    placeholder="Qty (optional)"
                    inputMode="decimal"
                    aria-label="Quantity"
                  />
                </>
              )}
              <input
                className="money-input money-input--inline"
                value={activityMemo}
                onChange={(event) => setActivityMemo(event.target.value)}
                placeholder="Memo (optional)"
                aria-label="Memo"
              />
              <MossButton type="submit" size="sm" disabled={busy}>
                Log activity
              </MossButton>
            </div>
          </form>

          <ul className="money-register-tape money-register-tape--compact money-invest-activity-tape">
            {(overview.activities ?? []).length === 0 && (
              <li className="money-instrument-empty">No activity yet — log a buy, sell, or dividend.</li>
            )}
            {(overview.activities ?? []).map((activity) => {
              const account = overview.accounts.find((row) => row.account.id === activity.accountId)
              return (
                <li key={activity.id} className="money-register-row money-mono money-invest-activity-row">
                  <span className="money-invest-activity-date">{formatAsOfDate(activity.occurredAt)}</span>
                  <span className="money-invest-activity-type">{formatActivityType(activity.type)}</span>
                  <span className="money-register-memo">
                    {activity.symbol ?? account?.account.label ?? '—'}
                    {activity.quantity ? ` · ${activity.quantity}` : ''}
                  </span>
                  <span
                    className={
                      activity.type === 'dividend' || activity.type === 'interest'
                        ? 'money-register-amount--in'
                        : activity.type === 'fee'
                          ? 'money-register-amount--out'
                          : ''
                    }
                  >
                    {formatMoneyCents(activity.amountCents)}
                  </span>
                  <button
                    type="button"
                    className="money-delete-button money-delete-button--icon"
                    disabled={busy}
                    aria-label="Remove activity"
                    onClick={() => {
                      void refreshAfterMutation(async () => {
                        await window.moss.money.deleteInvestmentActivity(activity.id)
                      })
                    }}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {overview && (overview.dividends ?? []).length > 0 && (
        <section className="money-instrument-panel" aria-label="Dividend history">
          <header className="money-instrument-head">
            <div>
              <p className="money-instrument-kicker">Income</p>
              <h2 className="money-instrument-title">Dividends</h2>
            </div>
          </header>
          <ul className="money-register-tape money-register-tape--compact">
            {overview.dividends.map((row) => (
              <li key={row.id} className="money-register-row money-mono">
                <span>{formatAsOfDate(row.occurredAt)}</span>
                <span className="money-register-memo">{row.symbol ?? 'Portfolio'}</span>
                <span className="money-register-amount--in">{formatMoneyCents(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="money-instrument-panel" aria-label="Accounts">
        <header className="money-instrument-head">
          <div>
            <p className="money-instrument-kicker">Manage</p>
            <h2 className="money-instrument-title">Accounts</h2>
            <p className="money-portfolio-caption">
              Add holdings per account. Snapshots are optional balance notes for performance history.
            </p>
          </div>
        </header>

        <ul className="money-portfolio-grid">
          {!overview?.accounts.length && (
            <li className="money-instrument-empty">Add an account below, then add holdings or log a snapshot.</li>
          )}
          {overview?.accounts.map((row) => {
            const expanded = expandedAccountId === row.account.id
            const accountHoldings = row.holdings ?? []
            const hasAccountHoldings = accountHoldings.length > 0
            const displayValue =
              row.valueCents > 0 ? row.valueCents : (row.latestSnapshot?.valueCents ?? 0)

            return (
              <li key={row.account.id} className="money-portfolio-card">
                <button
                  type="button"
                  className="money-portfolio-card-head"
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedAccountId((current) =>
                      current === row.account.id ? null : row.account.id
                    )
                  }
                >
                  <span className="money-portfolio-card-type">{formatAccountType(row.account.accountType)}</span>
                  <span className="money-portfolio-card-label">{row.account.label}</span>
                  <span className="money-portfolio-card-value money-mono">
                    {displayValue > 0 ? formatMoneyCents(displayValue) : '—'}
                  </span>
                  {hasAccountHoldings ? (
                    accountHoldings.some((h) => h.quoteStale && !h.manualPriceCents) ? (
                      <span className="money-chip money-chip--warn">Stale</span>
                    ) : (
                      <span className="money-portfolio-card-asof money-mono">Live</span>
                    )
                  ) : (
                    row.latestSnapshot && (
                      <span className="money-portfolio-card-asof money-mono">
                        as of {formatAsOfDate(row.latestSnapshot.asOf)}
                      </span>
                    )
                  )}
                </button>

                {expanded && (
                  <div className="money-portfolio-card-detail">
                    {hasAccountHoldings && row.latestSnapshot && (
                      <p className="money-portfolio-caption">
                        Live value {formatMoneyCents(displayValue)} from current prices · last manual
                        snapshot {formatMoneyCents(row.latestSnapshot.valueCents)} (
                        {formatAsOfDate(row.latestSnapshot.asOf)}), kept for performance history.
                      </p>
                    )}

                    <p className="money-instrument-kicker">Holdings</p>
                    <HoldingsTable
                      holdings={accountHoldings}
                      busy={busy}
                      onDelete={(id) => {
                        void refreshAfterMutation(async () => {
                          await window.moss.money.deleteInvestmentHolding(id)
                        })
                      }}
                      onUpdateTag={(id, allocationTag) => {
                        void refreshAfterMutation(async () => {
                          await window.moss.money.updateInvestmentHolding({ id, allocationTag })
                        })
                      }}
                    />

                    <form
                      className="money-form money-form--inline"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const quantity = Number.parseFloat(holdingQuantity)
                        const costBasisCents = parseMoneyInput(holdingCostBasis)
                        if (!holdingSymbol.trim() || !Number.isFinite(quantity) || quantity <= 0) return
                        if (!costBasisCents || costBasisCents <= 0) return

                        void refreshAfterMutation(async () => {
                          await window.moss.money.createInvestmentHolding({
                            accountId: row.account.id,
                            symbol: holdingSymbol.trim().toUpperCase(),
                            quantity,
                            costBasisCents,
                            allocationTag: holdingAllocationTag
                          })
                          setHoldingSymbol('')
                          setHoldingQuantity('')
                          setHoldingCostBasis('')
                        })
                      }}
                    >
                      <input
                        className="money-input money-input--inline money-mono"
                        value={holdingSymbol}
                        onChange={(event) => setHoldingSymbol(event.target.value)}
                        placeholder="Symbol"
                        aria-label="Holding symbol"
                      />
                      <input
                        className="money-input money-input--inline money-mono"
                        value={holdingQuantity}
                        onChange={(event) => setHoldingQuantity(event.target.value)}
                        placeholder="Qty"
                        inputMode="decimal"
                        aria-label="Holding quantity"
                      />
                      <input
                        className="money-input money-input--amount money-input--inline money-mono"
                        value={holdingCostBasis}
                        onChange={(event) => setHoldingCostBasis(event.target.value)}
                        placeholder="Cost basis"
                        inputMode="decimal"
                        aria-label="Cost basis"
                      />
                      <MossSelect
                        className="money-select--inline"
                        value={holdingAllocationTag}
                        options={ALLOCATION_PRESETS.map((tag) => ({ value: tag, label: tag }))}
                        onChange={setHoldingAllocationTag}
                        ariaLabel="Asset class"
                      />
                      <MossButton type="submit" size="sm" disabled={busy}>
                        Add holding
                      </MossButton>
                    </form>

                    <p className="money-instrument-kicker mt-3">Snapshots</p>
                    <ul className="money-register-tape money-register-tape--compact">
                      {snapshots.length === 0 && (
                        <li className="money-instrument-empty">No snapshots yet.</li>
                      )}
                      {snapshots.map((snapshot) => (
                        <li key={snapshot.id} className="money-register-row money-mono">
                          <span>{formatAsOfDate(snapshot.asOf)}</span>
                          <span>{formatMoneyCents(snapshot.valueCents)}</span>
                          <button
                            type="button"
                            className="money-delete-button money-delete-button--icon"
                            disabled={busy}
                            aria-label="Remove snapshot"
                            onClick={() => {
                              void refreshAfterMutation(async () => {
                                await window.moss.money.deleteInvestmentSnapshot(snapshot.id)
                              })
                            }}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="money-delete-button"
                      disabled={busy}
                      onClick={() => {
                        void refreshAfterMutation(async () => {
                          await window.moss.money.deleteInvestmentAccount(row.account.id)
                          if (expandedAccountId === row.account.id) setExpandedAccountId(null)
                        })
                      }}
                    >
                      Delete account
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <form
          className="money-form money-form--inline"
          onSubmit={(event) => {
            event.preventDefault()
            if (!accountLabel.trim()) return
            void refreshAfterMutation(async () => {
              await window.moss.money.createInvestmentAccount({
                label: accountLabel.trim(),
                accountType
              })
              setAccountLabel('')
            })
          }}
        >
          <input
            className="money-input money-input--inline"
            value={accountLabel}
            onChange={(event) => setAccountLabel(event.target.value)}
            placeholder="Account label"
            aria-label="Account label"
          />
          <MossSelect
            className="money-select--inline"
            value={accountType}
            options={ACCOUNT_TYPES.map((type) => ({ value: type, label: formatAccountType(type) }))}
            onChange={(next) => setAccountType(next as InvestmentAccountType)}
            ariaLabel="Account type"
          />
          <MossButton type="submit" size="sm" disabled={busy}>
            Add account
          </MossButton>
        </form>
      </section>

      {overview && overview.accounts.length > 0 && (
        <section className="money-instrument-panel money-portfolio-snapshot">
          <header className="money-instrument-head">
            <div>
              <p className="money-instrument-kicker">Snapshot</p>
              <h2 className="money-instrument-title">Log balance</h2>
              <p className="money-portfolio-caption">
                Snapshots power performance windows — log them regularly for honest trends.
              </p>
            </div>
          </header>

          <form
            className="money-form money-form--inline"
            onSubmit={(event) => {
              event.preventDefault()
              const valueCents = parseMoneyInput(snapshotAmount)
              if (!valueCents || valueCents <= 0 || !snapshotAccountId) return
              void refreshAfterMutation(async () => {
                await window.moss.money.createInvestmentSnapshot({
                  accountId: snapshotAccountId,
                  valueCents,
                  asOf: new Date(`${snapshotDate}T12:00:00`).toISOString()
                })
                setSnapshotAmount('')
              })
            }}
          >
            <MossSelect
              className="money-select--inline"
              value={snapshotAccountId}
              options={overview.accounts.map((row) => ({
                value: row.account.id,
                label: row.account.label
              }))}
              onChange={setSnapshotAccountId}
              ariaLabel="Account"
            />
            <input
              className="money-input money-input--amount money-input--inline money-mono"
              value={snapshotAmount}
              onChange={(event) => setSnapshotAmount(event.target.value)}
              placeholder="Balance"
              inputMode="decimal"
              aria-label="Balance"
            />
            <MossDateField
              className="money-date-field--inline"
              value={snapshotDate}
              onChange={(event) => setSnapshotDate(event.target.value)}
              aria-label="As of date"
            />
            <MossButton type="submit" size="sm" disabled={busy}>
              Save
            </MossButton>
          </form>
        </section>
      )}
    </div>
  )
}

interface PortfolioHoldingsListProps {
  holdings: FlatHolding[]
}

function PortfolioHoldingsList({ holdings }: PortfolioHoldingsListProps): React.JSX.Element {
  return (
    <>
      <div className="money-invest-holdings-head money-mono" aria-hidden>
        <span>Symbol</span>
        <span className="money-invest-holdings-col-num">Shares</span>
        <span className="money-invest-holdings-col-num">Price</span>
        <span className="money-invest-holdings-col-num">Value</span>
        <span className="money-invest-holdings-col-num">Gain</span>
        <span className="money-invest-holdings-col-num">Today</span>
        <span className="money-invest-holdings-col-status">Quote</span>
      </div>
      <ul className="money-invest-holdings-list money-mono">
        {holdings.map(({ holding, accountLabel, accountType }) => (
          <PortfolioHoldingRow
            key={holding.id}
            holding={holding}
            accountLabel={accountLabel}
            accountType={accountType}
          />
        ))}
      </ul>
    </>
  )
}

interface PortfolioHoldingRowProps {
  holding: InvestmentHoldingRecord
  accountLabel: string
  accountType: InvestmentAccountType
}

function PortfolioHoldingRow({
  holding,
  accountLabel,
  accountType
}: PortfolioHoldingRowProps): React.JSX.Element {
  const priceCents = holdingPriceCents(holding)
  const hasPrice = priceCents > 0
  const isManual = Boolean(holding.manualPriceCents && !holding.quotePriceCents)
  const isStale = holding.quoteStale && !holding.manualPriceCents
  const noQuote = !hasPrice
  const hasGain = holding.costBasisCents > 0 && holding.marketValueCents > 0
  const gainPct = hasGain ? (holding.gainLossCents / holding.costBasisCents) * 100 : null

  return (
    <li
      className={[
        'money-invest-holdings-row',
        isStale || noQuote ? 'money-invest-holdings-row--stale' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="money-invest-holdings-symbol">
        <span className="money-register-memo">{holding.symbol}</span>
        <span className="money-invest-holdings-account">
          {formatAccountType(accountType)} · {accountLabel}
        </span>
      </span>
      <span className="money-invest-holdings-col-num">{formatShares(holding.quantity)}</span>
      <span className="money-invest-holdings-col-num">
        {noQuote ? (
          '—'
        ) : (
          <>
            {formatMoneyCents(priceCents)}
            {isManual && <span className="money-chip money-chip--quiet">Est.</span>}
          </>
        )}
      </span>
      <span className="money-invest-holdings-col-num money-invest-holdings-value">
        {noQuote && holding.marketValueCents === 0
          ? '—'
          : formatMoneyCents(holding.marketValueCents)}
        {isStale && holding.marketValueCents > 0 && (
          <span className="money-chip money-chip--quiet">Est.</span>
        )}
      </span>
      <span
        className={[
          'money-invest-holdings-col-num money-invest-holdings-gain',
          hasGain
            ? holding.gainLossCents >= 0
              ? 'money-register-amount--in'
              : 'money-register-amount--out'
            : ''
        ]
          .filter(Boolean)
          .join(' ')}
        title={
          hasGain && gainPct !== null
            ? `${formatDayChangePercent(gainPct)} vs cost basis`
            : 'Add cost basis to see gain/loss'
        }
      >
        {hasGain ? formatSignedMoneyCents(holding.gainLossCents) : '—'}
      </span>
      <span
        className={[
          'money-invest-holdings-col-num money-invest-holdings-day',
          holding.quoteDayChangePercent !== null && !isManual
            ? holding.quoteDayChangePercent >= 0
              ? 'money-register-amount--in'
              : 'money-register-amount--out'
            : ''
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isManual || holding.quoteDayChangePercent === null ? (
          '—'
        ) : (
          <>
            {formatDayChangePercent(holding.quoteDayChangePercent)}
            {isStale && <span className="money-chip money-chip--quiet">Est.</span>}
          </>
        )}
      </span>
      <span className="money-invest-holdings-col-status">
        {noQuote ? (
          <span className="money-chip">No quote</span>
        ) : isStale ? (
          <span className="money-chip money-chip--warn" title={`Last quote ${formatQuoteTime(holding.quoteFetchedAt)}`}>
            Stale
          </span>
        ) : isManual ? (
          <span className="money-chip money-chip--quiet">Manual</span>
        ) : (
          <span className="money-invest-quote-live" title={`Quoted ${formatQuoteTime(holding.quoteFetchedAt)}`}>
            Live
          </span>
        )}
      </span>
    </li>
  )
}

interface HoldingsTableProps {
  holdings: InvestmentHoldingRecord[]
  busy: boolean
  onDelete: (id: string) => void
  onUpdateTag: (id: string, allocationTag: string) => void
}

function HoldingsTable({
  holdings,
  busy,
  onDelete,
  onUpdateTag
}: HoldingsTableProps): React.JSX.Element {
  if (holdings.length === 0) {
    return <p className="money-instrument-empty">No holdings — add one below.</p>
  }

  return (
    <>
      <div className="money-holdings-register-head money-mono" aria-hidden>
        <span>Symbol</span>
        <span>Qty</span>
        <span>Price</span>
        <span>Value</span>
        <span>Class</span>
        <span className="money-register-col-action" />
      </div>
      <ul className="money-register-tape money-register-tape--compact money-holdings-register">
        {holdings.map((holding) => {
          const priceCents = holdingPriceCents(holding)
          const noQuote = priceCents <= 0
          return (
            <li key={holding.id} className="money-holdings-register-row money-register-row money-mono">
              <span className="money-register-memo">{holding.symbol}</span>
              <span>{formatShares(holding.quantity)}</span>
              <span>
                {noQuote ? (
                  '—'
                ) : (
                  <>
                    {formatMoneyCents(priceCents)}
                    {holding.manualPriceCents && !holding.quotePriceCents && (
                      <span className="money-chip money-chip--quiet">Est.</span>
                    )}
                  </>
                )}
              </span>
              <span>
                {holding.quoteStale && !holding.manualPriceCents && holding.marketValueCents === 0
                  ? 'No quote'
                  : formatMoneyCents(holding.marketValueCents)}
                {holding.quoteStale && holding.marketValueCents > 0 && (
                  <span className="money-chip money-chip--quiet">Est.</span>
                )}
              </span>
              <MossSelect
                className="money-select--inline"
                value={holding.allocationTag || 'Other'}
                options={ALLOCATION_PRESETS.map((tag) => ({ value: tag, label: tag }))}
                onChange={(tag) => onUpdateTag(holding.id, tag)}
                ariaLabel={`Asset class for ${holding.symbol}`}
                disabled={busy}
              />
              <button
                type="button"
                className="money-delete-button money-delete-button--icon"
                disabled={busy}
                aria-label={`Remove ${holding.symbol}`}
                onClick={() => onDelete(holding.id)}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
