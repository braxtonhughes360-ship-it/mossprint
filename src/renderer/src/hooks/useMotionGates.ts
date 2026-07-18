import { useReducedMotion } from 'motion/react'
import { usePreferences } from '../context/PreferencesProvider'

export type AmbientGpuMode = 'animated' | 'static' | 'css'

export interface MotionGates {
  /** Route transitions and basic UI motion */
  motionEnabled: boolean
  /** Route enter/exit with transform — full tier only */
  routeTransitionFull: boolean
  /** Presence pass: cursor parallax, clip-path, hover scale, haptic press */
  presenceEnabled: boolean
  /** Cinematic clip-path text reveals */
  cinematicEntrance: boolean
  /** Hero WebGL ambient: animated drift, static frame, or CSS-only */
  ambientGpu: AmbientGpuMode
}

export function useMotionGates(): MotionGates {
  const { preferences } = usePreferences()
  const prefersReduced = useReducedMotion()

  const motionOff = preferences.motionIntensity === 'off'
  const isOff = motionOff || prefersReduced
  const isFull = preferences.motionIntensity === 'full' && !prefersReduced
  const isReduced =
    (preferences.motionIntensity === 'reduced' || prefersReduced) && !motionOff

  let ambientGpu: AmbientGpuMode = 'animated'
  if (motionOff) {
    ambientGpu = 'css'
  } else if (isReduced) {
    ambientGpu = 'static'
  }

  return {
    motionEnabled: !isOff,
    routeTransitionFull: isFull,
    presenceEnabled: isFull,
    cinematicEntrance: isFull,
    ambientGpu
  }
}
