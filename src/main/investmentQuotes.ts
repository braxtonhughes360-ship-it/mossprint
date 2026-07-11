import { getSetting } from './database'

const DEFAULT_QUOTE_TTL_MS = 15 * 60 * 1000
const QUOTE_STALE_KEY = 'money.trust.quoteStaleMinutes'

export function getQuoteStaleThresholdMs(): number {
  const raw = getSetting(QUOTE_STALE_KEY)?.value
  const minutes = raw !== undefined && raw !== '' ? Number.parseInt(raw, 10) : 15
  return Number.isFinite(minutes) && minutes > 0
    ? Math.min(24 * 60, Math.max(5, minutes)) * 60 * 1000
    : DEFAULT_QUOTE_TTL_MS
}

export interface InvestmentQuoteSnapshot {
  priceCents: number
  dayChangePercent: number | null
}

interface YahooChartMeta {
  regularMarketPrice?: number
  regularMarketChangePercent?: number
  chartPreviousClose?: number
  symbol?: string
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta
    }>
  }
}

function dayChangePercentFromMeta(meta: YahooChartMeta | undefined): number | null {
  if (!meta) return null

  if (typeof meta.regularMarketChangePercent === 'number' && Number.isFinite(meta.regularMarketChangePercent)) {
    return Math.round(meta.regularMarketChangePercent * 10) / 10
  }

  const { regularMarketPrice: price, chartPreviousClose: prevClose } = meta
  if (
    typeof price === 'number' &&
    Number.isFinite(price) &&
    typeof prevClose === 'number' &&
    Number.isFinite(prevClose) &&
    prevClose > 0
  ) {
    return Math.round(((price - prevClose) / prevClose) * 1000) / 10
  }

  return null
}

export async function fetchInvestmentQuote(symbol: string): Promise<InvestmentQuoteSnapshot | null> {
  const trimmed = symbol.trim().toUpperCase()
  if (!trimmed) return null

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(trimmed)}?interval=1d&range=1d`

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Moss/1.0)' }
    })
    if (!response.ok) return null

    const meta = (await response.json() as YahooChartResponse).chart?.result?.[0]?.meta
    const price = meta?.regularMarketPrice
    if (typeof price !== 'number' || !Number.isFinite(price)) return null

    return {
      priceCents: Math.round(price * 100),
      dayChangePercent: dayChangePercentFromMeta(meta)
    }
  } catch {
    return null
  }
}

export async function fetchQuotePriceCents(symbol: string): Promise<number | null> {
  const quote = await fetchInvestmentQuote(symbol)
  return quote?.priceCents ?? null
}

export function isQuoteStale(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return true
  const age = Date.now() - new Date(fetchedAt).getTime()
  return age > getQuoteStaleThresholdMs()
}
