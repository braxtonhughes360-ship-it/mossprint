import { useMemo, useState } from 'react'
import { formatMoneyCents } from '@shared/money'
import type { MoneyFlowViewData } from '@shared/moneyReports'

interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
  /** Stroke uses accent when true (default). */
  accent?: boolean
}

/** Compact SVG sparkline — no chart library. */
export function MoneySparkline({
  values,
  width = 120,
  height = 32,
  className = '',
  accent = true
}: SparklineProps): React.JSX.Element | null {
  if (values.length === 0) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const innerW = width - pad * 2
  const innerH = height - pad * 2

  if (values.length === 1) {
    const y = pad + innerH / 2
    return (
      <svg
        className={['money-report-sparkline', className].filter(Boolean).join(' ')}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden
      >
        <line
          x1={pad}
          y1={y}
          x2={pad + innerW}
          y2={y}
          stroke={accent ? 'var(--moss-accent)' : 'var(--moss-text-secondary)'}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle
          cx={pad + innerW / 2}
          cy={y}
          r="2.5"
          fill={accent ? 'var(--moss-accent)' : 'var(--moss-text-secondary)'}
        />
      </svg>
    )
  }

  const points = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * innerW
      const y = pad + innerH - ((value - min) / span) * innerH
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      className={['money-report-sparkline', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={accent ? 'var(--moss-accent)' : 'var(--moss-text-secondary)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

interface BarRow {
  id: string
  label: string
  value: number
  sublabel?: string
}

interface HorizontalBarsProps {
  rows: BarRow[]
  maxRows?: number
  formatValue: (cents: number) => string
}

export function MoneyReportHorizontalBars({
  rows,
  maxRows = 8,
  formatValue
}: HorizontalBarsProps): React.JSX.Element {
  const visible = rows.slice(0, maxRows)
  const max = Math.max(...visible.map((row) => row.value), 1)

  return (
    <ul className="money-report-bars" aria-label="Spending by category">
      {visible.map((row) => (
        <li key={row.id} className="money-report-bar-row">
          <div className="money-report-bar-head">
            <span className="money-report-bar-label">{row.label}</span>
            <span className="money-report-bar-value money-mono">{formatValue(row.value)}</span>
          </div>
          <span className="money-report-bar-track" aria-hidden>
            <span
              className="money-report-bar-fill"
              style={{ width: `${Math.round((row.value / max) * 100)}%` }}
            />
          </span>
          {row.sublabel && <span className="money-report-bar-sublabel">{row.sublabel}</span>}
        </li>
      ))}
    </ul>
  )
}

interface SeriesPoint {
  periodKey: string
  label: string
  incomeCents: number
  spentCents: number
  netFlowCents: number
}

interface CashFlowChartProps {
  series: SeriesPoint[]
}

const NETFLOW_HALF_PX = 56

/**
 * Cash flow = money in vs money out, and the net you kept.
 * One month → in/out bars + a plain-language net line.
 * Multiple months → signed net columns from a zero baseline (kept = up/green,
 * over = down/red). The single clearest answer to "am I ending months ahead?".
 */
export function MoneyCashFlowChart({ series }: CashFlowChartProps): React.JSX.Element | null {
  if (series.length === 0) return null

  if (series.length === 1) {
    const point = series[0]
    const net = point.netFlowCents
    const kept = net >= 0
    const max = Math.max(point.incomeCents, point.spentCents, 1)
    // Static class names only — Tailwind purges hand-authored component-layer
    // rules whose class is built via string interpolation (it never sees the literal).
    const bar = (label: string, value: number, fillClass: string): React.JSX.Element => (
      <div className="money-report-flowbar-row">
        <span className="money-report-flowbar-label">{label}</span>
        <span className="money-report-flowbar-track" aria-hidden>
          <span
            className={`money-report-flowbar-fill ${fillClass}`}
            style={{ width: `${value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0}%` }}
          />
        </span>
        <span className="money-report-flowbar-value money-mono">{formatMoneyCents(value)}</span>
      </div>
    )
    return (
      <div className="money-report-cashflow-single">
        <div className="money-report-flowbars">
          {bar('Money in', point.incomeCents, 'money-report-flowbar-fill--in')}
          {bar('Money out', point.spentCents, 'money-report-flowbar-fill--out')}
        </div>
        <p
          className={[
            'money-report-cashflow-net money-mono',
            kept ? 'money-report-cashflow-net--up' : 'money-report-cashflow-net--down'
          ].join(' ')}
        >
          {kept
            ? `You kept ${formatMoneyCents(net)} this month — more came in than went out.`
            : `You spent ${formatMoneyCents(Math.abs(net))} more than came in this month.`}
        </p>
      </div>
    )
  }

  const maxAbs = Math.max(...series.map((p) => Math.abs(p.netFlowCents)), 1)
  return (
    <div className="money-report-netflow" role="img" aria-label="Net cash flow by month">
      <div className="money-report-netflow-cols">
        {series.map((point) => {
          const positive = point.netFlowCents >= 0
          const barH =
            point.netFlowCents === 0
              ? 0
              : Math.max(3, Math.round((Math.abs(point.netFlowCents) / maxAbs) * NETFLOW_HALF_PX))
          return (
            <div key={point.periodKey} className="money-report-netflow-col">
              <div className="money-report-netflow-plot">
                <span className="money-report-netflow-baseline" aria-hidden />
                <span
                  className={[
                    'money-report-netflow-bar',
                    positive ? 'money-report-netflow-bar--up' : 'money-report-netflow-bar--down'
                  ].join(' ')}
                  style={{ height: `${barH}px` }}
                  title={`${point.label}: ${positive ? 'kept' : 'over'} ${formatMoneyCents(Math.abs(point.netFlowCents))}`}
                />
              </div>
              <span className="money-report-netflow-label money-mono">{point.label}</span>
            </div>
          )
        })}
      </div>
      <p className="money-report-netflow-legend">
        Above the line = months you kept money · below = months you spent more than came in.
      </p>
    </div>
  )
}

interface NetWorthPoint {
  label: string
  totalCents: number
}

interface NetWorthLineProps {
  series: NetWorthPoint[]
}

interface FlowBand {
  id: string
  label: string
  cents: number
  hue: number
  isOther?: boolean
  y0: number
  y1: number
  cy: number
}

const FLOW_VIEW_W = 1000
const FLOW_VIEW_H = 320
const FLOW_PAD = 8
const FLOW_IN_X = 18
const FLOW_IN_W = 64
const FLOW_GROUP_X = 330
const FLOW_GROUP_W = 64
const FLOW_CAT_X = 724
const FLOW_CAT_W = 56
const FLOW_BAND_GAP = 3
const FLOW_MIN_BAND = 7
/** Min vertical gap between label centres (px == viewBox-Y since svg height = view-H). */
const FLOW_LABEL_GAP = 32
const FLOW_LABEL_INSET = 16
const FLOW_LEADER_LEN = 46
const FLOW_KEPT_HUE = 150
/** Income reads as one calm "money in" source; the warm group hues carry the spend out. */
const FLOW_INCOME_FILL = 'oklch(0.66 0.06 150 / 0.5)'

/** Stack proportional bands top→bottom with a min height + gaps, normalised to fit. */
function stackFlowBands(
  segs: Array<{ id: string; label: string; cents: number; hue: number; isOther?: boolean }>,
  totalCents: number,
  top: number,
  bottom: number
): FlowBand[] {
  const n = segs.length
  if (n === 0) return []
  const avail = bottom - top - FLOW_BAND_GAP * (n - 1)
  let heights = segs.map((s) =>
    Math.max(FLOW_MIN_BAND, totalCents > 0 ? (s.cents / totalCents) * avail : avail / n)
  )
  const sum = heights.reduce((a, b) => a + b, 0)
  if (sum > avail) {
    const k = avail / sum
    heights = heights.map((h) => h * k)
  }
  let y = top
  return segs.map((s, i) => {
    const h = heights[i]
    const band: FlowBand = { ...s, y0: y, y1: y + h, cy: y + h / 2 }
    y += h + FLOW_BAND_GAP
    return band
  })
}

/** Push label centres apart so two-line labels never overlap (input sorted by cy). */
function spreadLabelCenters(centers: number[], minGap: number, top: number, bottom: number): number[] {
  const out = centers.slice()
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap
  }
  if (out.length > 0 && out[out.length - 1] > bottom) {
    out[out.length - 1] = bottom
    for (let i = out.length - 2; i >= 0; i -= 1) {
      if (out[i] > out[i + 1] - minGap) out[i] = out[i + 1] - minGap
    }
  }
  if (out.length > 0 && out[0] < top) {
    out[0] = top
    for (let i = 1; i < out.length; i += 1) {
      if (out[i] < out[i - 1] + minGap) out[i] = out[i - 1] + minGap
    }
  }
  return out
}

function flowRibbonPath(
  x1: number,
  y1a: number,
  y1b: number,
  x2: number,
  y2a: number,
  y2b: number
): string {
  const mx = (x1 + x2) / 2
  return [
    `M ${x1} ${y1a}`,
    `C ${mx} ${y1a}, ${mx} ${y2a}, ${x2} ${y2a}`,
    `L ${x2} ${y2b}`,
    `C ${mx} ${y2b}, ${mx} ${y1b}, ${x1} ${y1b}`,
    'Z'
  ].join(' ')
}

function flowLeaderPath(x: number, fromY: number, toY: number, len: number): string {
  const x2 = x + len
  return `M ${x} ${fromY} C ${x + len * 0.4} ${fromY}, ${x2 - len * 0.4} ${toY}, ${x2} ${toY}`
}

function flowBandFill(hue: number, alpha = 0.72): string {
  return `oklch(0.64 0.115 ${hue} / ${alpha})`
}

interface WhereItWentFlowProps {
  data: MoneyFlowViewData
}

/**
 * CSS/SVG cash-flow ribbon — Income → groups → top envelopes. No chart library.
 * Fixed plot height (fluid width only) so the HTML label overlay lands pixel-exact
 * on the SVG bands; labels are de-collided + leader-lined so dense small envelopes
 * stay legible instead of stacking on top of each other.
 */
export function MoneyWhereItWentFlow({ data }: WhereItWentFlowProps): React.JSX.Element {
  const layout = useMemo(() => {
    const top = FLOW_PAD
    const bottom = FLOW_VIEW_H - FLOW_PAD
    const incomeBase = Math.max(data.incomeCents, data.spentCents)

    const incomeSegments =
      data.incomeCents > 0
        ? [
            ...data.groups.map((g) => ({
              id: `in-${g.id}`,
              label: g.name,
              cents: g.spentCents,
              hue: g.hue
            })),
            ...(data.keptCents > 0
              ? [{ id: 'kept', label: 'Kept', cents: data.keptCents, hue: FLOW_KEPT_HUE }]
              : [])
          ]
        : [{ id: 'spending', label: 'Spending', cents: data.spentCents, hue: FLOW_KEPT_HUE }]

    const incomeBands = stackFlowBands(incomeSegments, incomeBase, top, bottom)
    const groupBands = stackFlowBands(
      data.groups.map((g) => ({ id: g.id, label: g.name, cents: g.spentCents, hue: g.hue })),
      data.spentCents,
      top,
      bottom
    )
    const categoryBands = stackFlowBands(
      data.categories.map((c) => ({
        id: c.id,
        label: c.name,
        cents: c.spentCents,
        hue: c.hue,
        isOther: c.isOther
      })),
      data.spentCents,
      top,
      bottom
    )

    const incomeById = new Map(incomeBands.map((b) => [b.id, b]))
    const groupById = new Map(groupBands.map((b) => [b.id, b]))
    const catById = new Map(categoryBands.map((b) => [b.id, b]))

    const ribbons: Array<{ id: string; d: string; hue: number }> = []

    // Income → group.
    if (data.incomeCents > 0) {
      for (const group of data.groups) {
        const inc = incomeById.get(`in-${group.id}`)
        const gb = groupById.get(group.id)
        if (!inc || !gb) continue
        ribbons.push({
          id: `ig-${group.id}`,
          hue: group.hue,
          d: flowRibbonPath(FLOW_IN_X + FLOW_IN_W, inc.y0, inc.y1, FLOW_GROUP_X, gb.y0, gb.y1)
        })
      }
    } else {
      const src = incomeBands[0]
      if (src) {
        let cursor = src.y0
        const span = src.y1 - src.y0
        for (const group of data.groups) {
          const gb = groupById.get(group.id)
          if (!gb) continue
          const sliceH = data.spentCents > 0 ? (group.spentCents / data.spentCents) * span : 0
          ribbons.push({
            id: `ig-${group.id}`,
            hue: group.hue,
            d: flowRibbonPath(FLOW_IN_X + FLOW_IN_W, cursor, cursor + sliceH, FLOW_GROUP_X, gb.y0, gb.y1)
          })
          cursor += sliceH
        }
      }
    }

    // Group → category/Other, from precomputed links + per-band cursors.
    const groupCursor = new Map(groupBands.map((b) => [b.id, b.y0]))
    const targetCursor = new Map(categoryBands.map((b) => [b.id, b.y0]))
    data.links.forEach((link, index) => {
      const gb = groupById.get(link.groupId)
      const tb = catById.get(link.targetId)
      if (!gb || !tb) return
      const gFrac = gb.cents > 0 ? link.cents / gb.cents : 0
      const gy0 = groupCursor.get(link.groupId) ?? gb.y0
      const gy1 = gy0 + gFrac * (gb.y1 - gb.y0)
      groupCursor.set(link.groupId, gy1)
      const tFrac = tb.cents > 0 ? link.cents / tb.cents : 0
      const ty0 = targetCursor.get(link.targetId) ?? tb.y0
      const ty1 = ty0 + tFrac * (tb.y1 - tb.y0)
      targetCursor.set(link.targetId, ty1)
      ribbons.push({
        id: `gc-${link.groupId}-${link.targetId}-${index}`,
        hue: link.hue,
        d: flowRibbonPath(FLOW_GROUP_X + FLOW_GROUP_W, gy0, gy1, FLOW_CAT_X, ty0, ty1)
      })
    })

    const groupCenters = spreadLabelCenters(
      groupBands.map((b) => b.cy),
      FLOW_LABEL_GAP,
      FLOW_LABEL_INSET,
      FLOW_VIEW_H - FLOW_LABEL_INSET
    )
    const catCenters = spreadLabelCenters(
      categoryBands.map((b) => b.cy),
      FLOW_LABEL_GAP,
      FLOW_LABEL_INSET,
      FLOW_VIEW_H - FLOW_LABEL_INSET
    )
    const leaders = categoryBands.map((b, i) =>
      flowLeaderPath(FLOW_CAT_X + FLOW_CAT_W, b.cy, catCenters[i], FLOW_LEADER_LEN)
    )

    // The income column is one source, not a mirror of the groups: merge its
    // group-segments into a single calm band (the colored ribbons do the routing).
    const incomeFlowBands = incomeBands.filter((b) => b.id !== 'kept')
    const incomeMain =
      incomeFlowBands.length > 0
        ? { y0: incomeFlowBands[0].y0, y1: incomeFlowBands[incomeFlowBands.length - 1].y1 }
        : null
    const keptBand = incomeBands.find((b) => b.id === 'kept') ?? null

    return {
      incomeBands,
      incomeMain,
      keptBand,
      groupBands,
      categoryBands,
      ribbons,
      groupCenters,
      catCenters,
      leaders
    }
  }, [data])

  const incomeTitle = data.incomeCents > 0 ? 'Income' : 'Spending'
  const incomeValue =
    data.incomeCents > 0 ? formatMoneyCents(data.incomeCents) : formatMoneyCents(data.spentCents)
  const pctTop = (y: number): string => `${((y / FLOW_VIEW_H) * 100).toFixed(3)}%`

  return (
    <div className="money-report-where">
      <p className="money-report-where-summary">{data.summary}</p>
      {data.sparse && (
        <p className="money-report-where-sparse-note">
          {data.groups.length <= 1 && data.categories.length <= 1
            ? 'One envelope this period — the picture fills in as you add more.'
            : 'A quiet month — more groups and envelopes will branch out here over time.'}
        </p>
      )}

      {/* Full motion: layered ribbon flow */}
      <div className="money-report-where-flow" role="img" aria-label={data.summary}>
        <div className="money-report-where-labels">
          <span className="money-report-where-col-label">{incomeTitle}</span>
          <span className="money-report-where-col-label">Groups</span>
          <span className="money-report-where-col-label">Top envelopes</span>
        </div>
        <div className="money-report-where-plot">
          <svg
            className="money-report-where-svg"
            viewBox={`0 0 ${FLOW_VIEW_W} ${FLOW_VIEW_H}`}
            height={FLOW_VIEW_H}
            preserveAspectRatio="none"
            aria-hidden
          >
            {layout.ribbons.map((ribbon) => (
              <path
                key={ribbon.id}
                className="money-report-where-ribbon"
                d={ribbon.d}
                fill={flowBandFill(ribbon.hue, 0.4)}
              />
            ))}
            {layout.leaders.map((d, i) => (
              <path key={`leader-${i}`} className="money-report-where-leader" d={d} />
            ))}
            {layout.incomeMain && (
              <rect
                className="money-report-where-band"
                x={FLOW_IN_X}
                y={layout.incomeMain.y0}
                width={FLOW_IN_W}
                height={layout.incomeMain.y1 - layout.incomeMain.y0}
                rx={5}
                fill={FLOW_INCOME_FILL}
              />
            )}
            {layout.keptBand && (
              <rect
                className="money-report-where-band money-report-where-band--kept"
                x={FLOW_IN_X}
                y={layout.keptBand.y0}
                width={FLOW_IN_W}
                height={layout.keptBand.y1 - layout.keptBand.y0}
                rx={5}
              />
            )}
            {layout.groupBands.map((seg) => (
              <rect
                key={seg.id}
                className="money-report-where-band"
                x={FLOW_GROUP_X}
                y={seg.y0}
                width={FLOW_GROUP_W}
                height={seg.y1 - seg.y0}
                rx={5}
                fill={flowBandFill(seg.hue)}
              />
            ))}
            {layout.categoryBands.map((seg) => (
              <rect
                key={seg.id}
                className="money-report-where-band"
                x={FLOW_CAT_X}
                y={seg.y0}
                width={FLOW_CAT_W}
                height={seg.y1 - seg.y0}
                rx={5}
                fill={seg.isOther ? 'oklch(0.62 0.012 80 / 0.5)' : flowBandFill(seg.hue, 0.85)}
              />
            ))}
          </svg>

          <div className="money-report-where-labels-overlay">
            <div
              className="money-report-where-node money-report-where-node--in"
              style={{ top: pctTop((FLOW_PAD + FLOW_VIEW_H - FLOW_PAD) / 2) }}
            >
              <span className="money-report-where-node-name">{incomeTitle}</span>
              <span className="money-report-where-node-total money-mono">{incomeValue}</span>
            </div>
            {layout.groupBands.map((seg, i) => (
              <div
                key={seg.id}
                className="money-report-where-node money-report-where-node--group"
                style={{ top: pctTop(layout.groupCenters[i]) }}
              >
                <span className="money-report-where-node-name">
                  <span
                    className="money-report-where-node-dot"
                    style={{ background: flowBandFill(seg.hue) }}
                    aria-hidden
                  />
                  {seg.label}
                </span>
                <span className="money-report-where-node-value money-mono">
                  {formatMoneyCents(seg.cents)}
                </span>
              </div>
            ))}
            {layout.categoryBands.map((seg, i) => (
              <div
                key={seg.id}
                className="money-report-where-node money-report-where-node--cat"
                style={{ top: pctTop(layout.catCenters[i]) }}
              >
                <span className="money-report-where-node-name">
                  <span
                    className="money-report-where-node-dot"
                    style={{
                      background: seg.isOther
                        ? 'oklch(0.62 0.012 80 / 0.5)'
                        : flowBandFill(seg.hue, 0.85)
                    }}
                    aria-hidden
                  />
                  {seg.label}
                </span>
                <span className="money-report-where-node-value money-mono">
                  {formatMoneyCents(seg.cents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reduced/off: static stacked bar by group */}
      <div className="money-report-where-stack" role="img" aria-label={data.summary}>
        <div className="money-report-where-stack-track" aria-hidden>
          {data.groups.map((group) => (
            <span
              key={group.id}
              className="money-report-where-stack-seg"
              style={{
                width: `${Math.max(2, Math.round(group.shareOfSpent * 100))}%`,
                background: flowBandFill(group.hue)
              }}
              title={`${group.name}: ${formatMoneyCents(group.spentCents)}`}
            />
          ))}
        </div>
        <ul className="money-report-where-stack-legend">
          {data.groups.map((group) => (
            <li key={group.id} className="money-report-where-stack-row">
              <span
                className="money-report-where-stack-swatch"
                style={{ background: flowBandFill(group.hue) }}
                aria-hidden
              />
              <span className="money-report-where-stack-name">{group.name}</span>
              <span className="money-report-where-stack-value money-mono">
                {formatMoneyCents(group.spentCents)}
              </span>
              <span className="money-report-where-stack-pct money-mono">
                {Math.round(group.shareOfSpent * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function MoneyNetWorthLine({ series }: NetWorthLineProps): React.JSX.Element | null {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  if (series.length === 0) return null

  // One point is a position, not a trend — show the number, set the expectation.
  if (series.length === 1) {
    return (
      <div className="money-report-networth-single">
        <span className="money-report-networth-single-value money-mono">
          {formatMoneyCents(series[0].totalCents)}
        </span>
        <span className="money-report-networth-single-note">
          One month so far — the trend line fills in as more months are recorded.
        </span>
      </div>
    )
  }

  const values = series.map((p) => p.totalCents)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.max(max * 0.05, 1)
  // Coordinates live in a 0–100 box; preserveAspectRatio="none" stretches it to
  // fill the card, so HTML dots positioned with the same percentages land on the
  // line and stay perfectly round (the stroke stays crisp via non-scaling-stroke).
  const inset = 12
  const coords = values.map((value, index) => ({
    x: index === 0 ? 0 : (index / (values.length - 1)) * 100,
    y: inset + (1 - (value - min) / span) * (100 - inset * 2)
  }))
  const line = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const areaPoints = `0,100 ${line} 100,100`

  const latest = values[values.length - 1]
  const first = values[0]
  const delta = latest - first
  // Static class names only (Tailwind purges interpolated component-layer classes).
  const changeClass =
    delta > 0
      ? 'money-report-networth-change--up'
      : delta < 0
        ? 'money-report-networth-change--down'
        : 'money-report-networth-change--flat'
  const changeLabel =
    delta === 0
      ? 'No change'
      : `${delta > 0 ? '+' : '−'}${formatMoneyCents(Math.abs(delta))}`
  const firstLabel = series[0].label
  const lastLabel = series[series.length - 1].label
  const active = activeIdx !== null ? series[activeIdx] : null

  return (
    <div className="money-report-networth">
      <div className="money-report-networth-readout">
        <span className="money-report-networth-current money-mono">
          {active ? formatMoneyCents(active.totalCents) : formatMoneyCents(latest)}
        </span>
        <span className={`money-report-networth-change money-mono ${changeClass}`}>
          {active ? active.label : `${changeLabel} since ${firstLabel}`}
        </span>
      </div>
      <div className="money-report-networth-plot">
        <svg
          className="money-report-networth-line"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Net worth trend, ${formatMoneyCents(first)} in ${firstLabel} to ${formatMoneyCents(latest)} in ${lastLabel}`}
        >
          <polygon points={areaPoints} className="money-report-networth-area" />
          <polyline
            points={line}
            fill="none"
            stroke="var(--moss-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {coords.map((c, index) => (
          <button
            key={series[index].label}
            type="button"
            className={[
              'money-report-networth-point',
              activeIdx === index ? 'money-report-networth-point--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
            aria-label={`${series[index].label}: ${formatMoneyCents(values[index])}`}
            onMouseEnter={() => setActiveIdx(index)}
            onMouseLeave={() => setActiveIdx((cur) => (cur === index ? null : cur))}
            onFocus={() => setActiveIdx(index)}
            onBlur={() => setActiveIdx((cur) => (cur === index ? null : cur))}
          >
            <span className="money-report-networth-dot" aria-hidden />
          </button>
        ))}
        {active && activeIdx !== null && (
          <div
            className="money-report-networth-tip money-mono"
            style={{ left: `${coords[activeIdx].x}%`, top: `${coords[activeIdx].y}%` }}
            aria-hidden
          >
            {formatMoneyCents(active.totalCents)}
          </div>
        )}
      </div>
      <div className="money-report-networth-axis money-mono">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  )
}
