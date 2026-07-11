import { lazy, Suspense, useEffect, useState } from 'react'
import type { TimePhase } from '@shared/preferences'
import { useDocumentVisible } from '../../hooks/useDocumentVisible'
import { useMotionGates } from '../../hooks/useMotionGates'

/** Defer GPU init a beat so it never competes with first paint / route crossfade. */
const MOUNT_DELAY_MS = 260

// three.js + @react-three/fiber live in this async chunk — only fetched when
// the motion tier actually turns the GPU field on.
const StageAmbientCanvas = lazy(() => import('./StageAmbientCanvas'))

interface StageAmbientFieldProps {
  phase: TimePhase
}

/**
 * App-wide slow warm light drift behind DOM content — the live, on-brand
 * background WebGL (replaces the earlier film-grain). Full motion only; reduced/
 * off + prefers-reduced-motion render nothing and fall back to the baked static
 * newsprint + CSS washes. Single fullscreen quad, paused when backgrounded.
 */
export function StageAmbientField({ phase }: StageAmbientFieldProps): React.JSX.Element | null {
  const { ambientGpu } = useMotionGates()
  const visible = useDocumentVisible()
  const animated = ambientGpu === 'animated'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!animated) {
      setReady(false)
      return
    }
    const id = window.setTimeout(() => setReady(true), MOUNT_DELAY_MS)
    return () => {
      window.clearTimeout(id)
      setReady(false)
    }
  }, [animated])

  if (!animated || !ready) return null

  return (
    <div className="moss-stage-ambient-canvas" aria-hidden>
      <Suspense fallback={null}>
        <StageAmbientCanvas phase={phase} animated={animated} visible={visible} />
      </Suspense>
    </div>
  )
}
