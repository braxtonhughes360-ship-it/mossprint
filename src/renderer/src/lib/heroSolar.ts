import { getMoonIllumination, getPosition, getTimes } from 'suncalc'

const FALLBACK_LAT = 37.77
const FALLBACK_LNG = -122.42

export interface Coordinates {
  lat: number
  lng: number
}

export interface SolarSchedule {
  sunrise: Date
  sunset: Date
  tomorrowSunrise: Date
}

export type SolarEventLabel = 'Sunrise' | 'Sunset'

export interface NextSolarEvent {
  label: SolarEventLabel
  time: Date
  tomorrow?: boolean
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

function endOfLocalDay(date: Date): Date {
  const end = startOfLocalDay(date)
  end.setDate(end.getDate() + 1)
  return end
}

/** Clamp suncalc rise/set to the civil day — see mourner/suncalc#24 */
function sunlightForDay(date: Date, coords: Coordinates): { sunrise: Date; sunset: Date } {
  const dayStart = startOfLocalDay(date)
  const dayEnd = endOfLocalDay(date)
  const noon = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000)
  const times = getTimes(noon, coords.lat, coords.lng)

  const fallbackSunrise = new Date(dayStart)
  fallbackSunrise.setHours(6, 0, 0, 0)
  const fallbackSunset = new Date(dayStart)
  fallbackSunset.setHours(18, 0, 0, 0)

  let sunrise = times.sunrise ?? fallbackSunrise
  let sunset = times.sunset ?? fallbackSunset

  if (sunrise.getTime() < dayStart.getTime() || sunrise.getTime() >= dayEnd.getTime()) {
    sunrise = fallbackSunrise
  }
  if (sunset.getTime() < dayStart.getTime() || sunset.getTime() >= dayEnd.getTime()) {
    sunset = fallbackSunset
  }

  return { sunrise, sunset }
}

export function getSolarSchedule(date: Date, coords: Coordinates): SolarSchedule {
  const { sunrise, sunset } = sunlightForDay(date, coords)
  const tomorrow = new Date(date)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDay = sunlightForDay(tomorrow, coords)

  return {
    sunrise,
    sunset,
    tomorrowSunrise: tomorrowDay.sunrise
  }
}

export function getDaylightProgress(now: Date, schedule: SolarSchedule): number {
  if (now < schedule.sunrise) return 0
  if (now >= schedule.sunset) return 1
  const span = schedule.sunset.getTime() - schedule.sunrise.getTime()
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (now.getTime() - schedule.sunrise.getTime()) / span))
}

export function getNextSolarEvent(now: Date, schedule: SolarSchedule): NextSolarEvent {
  const nowMs = now.getTime()
  if (nowMs < schedule.sunrise.getTime()) {
    return { label: 'Sunrise', time: schedule.sunrise }
  }
  if (nowMs < schedule.sunset.getTime()) {
    return { label: 'Sunset', time: schedule.sunset }
  }
  return { label: 'Sunrise', time: schedule.tomorrowSunrise, tomorrow: true }
}

export function getSunAltitude(now: Date, coords: Coordinates): number {
  return getPosition(now, coords.lat, coords.lng).altitude
}

export interface MoonSnapshot {
  /** Illuminated fraction 0–1. */
  fraction: number
  /** Synodic phase 0–1 (0/1 = new, 0.5 = full). */
  phase: number
  phaseLabel: string
  /** Waxing (filling) vs waning (emptying) — drives crescent direction. */
  waxing: boolean
}

function moonPhaseLabel(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'New moon'
  if (phase < 0.22) return 'Waxing crescent'
  if (phase < 0.28) return 'First quarter'
  if (phase < 0.47) return 'Waxing gibbous'
  if (phase < 0.53) return 'Full moon'
  if (phase < 0.72) return 'Waning gibbous'
  if (phase < 0.78) return 'Last quarter'
  return 'Waning crescent'
}

export function getMoonSnapshot(now: Date): MoonSnapshot {
  const illum = getMoonIllumination(now)
  return {
    fraction: illum.fraction,
    phase: illum.phase,
    phaseLabel: moonPhaseLabel(illum.phase),
    waxing: illum.phase <= 0.5
  }
}

export interface NightWindow {
  /** The sunset that opened the current night. */
  start: Date
  /** The sunrise that will close it. */
  end: Date
}

/**
 * The night span the instrument is tracking: evening → today's sunset to
 * tomorrow's sunrise; small hours → yesterday's sunset to today's sunrise.
 */
export function getNightWindow(now: Date, coords: Coordinates): NightWindow {
  const today = sunlightForDay(now, coords)

  if (now.getTime() < today.sunrise.getTime()) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return { start: sunlightForDay(yesterday, coords).sunset, end: today.sunrise }
  }

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { start: today.sunset, end: sunlightForDay(tomorrow, coords).sunrise }
}

/**
 * Progress through the current night (0 at the bounding sunset, 1 at the bounding
 * sunrise).
 */
export function getNightProgress(now: Date, coords: Coordinates): number {
  const window = getNightWindow(now, coords)
  return clampProgress(now, window.start, window.end)
}

function clampProgress(now: Date, start: Date, end: Date): number {
  const span = end.getTime() - start.getTime()
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span))
}

export function getISOWeek(date: Date): number {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return Math.ceil((utc.getTime() - yearStart.getTime()) / 86400000 / 7 + 1)
}

export const FALLBACK_COORDS: Coordinates = { lat: FALLBACK_LAT, lng: FALLBACK_LNG }

export const sunTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})
