import type { TimePhase } from '@shared/preferences'

export interface AmbientPaletteStops {
  /** Shadow / transparent base (unused in output — CSS carries base) */
  low: [number, number, number]
  /** Moss accent bloom */
  mid: [number, number, number]
  /** Warm highlight bloom */
  high: [number, number, number]
  intensity: number
}

/**
 * Accent-only GPU palette — light tints composited over CSS base.
 * Avoid muddy browns: keep hues in moss (145) + warm gold (78) family.
 */
const PALETTE: Record<'light' | 'dark', Record<TimePhase, AmbientPaletteStops>> = {
  light: {
    morning: {
      low: [0.72, 0.78, 0.68],
      mid: [0.52, 0.72, 0.56],
      high: [0.88, 0.82, 0.58],
      intensity: 0.38
    },
    day: {
      low: [0.7, 0.76, 0.7],
      mid: [0.48, 0.7, 0.55],
      high: [0.82, 0.8, 0.62],
      intensity: 0.34
    },
    evening: {
      low: [0.68, 0.72, 0.66],
      mid: [0.5, 0.68, 0.52],
      high: [0.9, 0.76, 0.5],
      intensity: 0.36
    },
    night: {
      low: [0.66, 0.72, 0.68],
      mid: [0.44, 0.64, 0.54],
      high: [0.72, 0.78, 0.66],
      intensity: 0.28
    }
  },
  dark: {
    morning: {
      low: [0.12, 0.18, 0.14],
      mid: [0.28, 0.52, 0.34],
      high: [0.52, 0.48, 0.22],
      intensity: 0.44
    },
    day: {
      low: [0.1, 0.16, 0.12],
      mid: [0.22, 0.46, 0.3],
      high: [0.38, 0.42, 0.24],
      intensity: 0.4
    },
    evening: {
      low: [0.1, 0.14, 0.12],
      mid: [0.26, 0.42, 0.28],
      high: [0.58, 0.44, 0.2],
      intensity: 0.42
    },
    night: {
      low: [0.08, 0.12, 0.11],
      mid: [0.18, 0.38, 0.28],
      high: [0.28, 0.36, 0.26],
      intensity: 0.32
    }
  }
}

export function getAmbientPalette(
  phase: TimePhase,
  colorMode: 'light' | 'dark'
): AmbientPaletteStops {
  return PALETTE[colorMode][phase]
}
