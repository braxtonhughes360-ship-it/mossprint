import type { Coordinates } from './heroSolar'

export interface UvSnapshot {
  current: number | null
  peak: number | null
  peakLabel: string | null
  strength: string
}

export function uvStrengthLabel(index: number): string {
  if (index <= 0) return 'None'
  if (index <= 2) return 'Low'
  if (index <= 5) return 'Moderate'
  if (index <= 7) return 'High'
  if (index <= 10) return 'Very high'
  return 'Extreme'
}

function roundUv(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null
  return Math.round(value * 10) / 10
}

const peakTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit'
})

/** Open-Meteo UV — no API key; local timezone from API. */
export async function fetchUvSnapshot(coords: Coordinates): Promise<UvSnapshot | null> {
  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lng),
    current: 'uv_index',
    hourly: 'uv_index',
    timezone: 'auto',
    forecast_days: '1'
  })

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
  if (!response.ok) return null

  const data = (await response.json()) as {
    current?: { uv_index?: number; time?: string }
    hourly?: { time?: string[]; uv_index?: number[] }
  }

  const current = roundUv(data.current?.uv_index)
  const times = data.hourly?.time ?? []
  const values = data.hourly?.uv_index ?? []

  let peak: number | null = null
  let peakTime: string | null = null

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value == null) continue
    if (peak == null || value > peak) {
      peak = value
      peakTime = times[i] ?? null
    }
  }

  const peakRounded = roundUv(peak)
  const strengthIndex = current ?? peakRounded ?? 0

  let peakLabel: string | null = null
  if (peakRounded != null && peakTime) {
    const peakDate = new Date(peakTime)
    if (!Number.isNaN(peakDate.getTime())) {
      peakLabel = `${uvStrengthLabel(peakRounded)} · peak ${peakRounded} at ${peakTimeFormatter.format(peakDate)}`
    }
  }

  return {
    current,
    peak: peakRounded,
    peakLabel,
    strength: uvStrengthLabel(strengthIndex)
  }
}
