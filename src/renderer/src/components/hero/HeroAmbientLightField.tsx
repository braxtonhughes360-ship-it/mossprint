import { lazy, Suspense, useEffect, useState } from 'react'
import type { TimePhase } from '@shared/preferences'
import { useDocumentVisible } from '../../hooks/useDocumentVisible'
import { useMotionGates } from '../../hooks/useMotionGates'

/** First dashboard visit: defer GPU init until route crossfade settles. */
const GPU_MOUNT_DELAY_FIRST_MS = 320

// three.js + @react-three/fiber live in this async chunk — only fetched when
// the motion tier actually shows the GPU canvas.
const HeroAmbientCanvas = lazy(() => import('./HeroAmbientCanvas'))

let heroGpuEverMounted = false

interface HeroAmbientLightFieldProps {
  phase: TimePhase
}

export function HeroAmbientLightField({ phase }: HeroAmbientLightFieldProps): React.JSX.Element {
  const { ambientGpu } = useMotionGates()
  const visible = useDocumentVisible()
  const showCanvas = ambientGpu !== 'css'
  const animated = ambientGpu === 'animated' && visible
  const [canvasReady, setCanvasReady] = useState(false)

  useEffect(() => {
    if (!showCanvas) {
      setCanvasReady(false)
      return
    }

    const delay = heroGpuEverMounted ? 0 : GPU_MOUNT_DELAY_FIRST_MS
    const id = window.setTimeout(() => {
      setCanvasReady(true)
      heroGpuEverMounted = true
    }, delay)

    return () => {
      window.clearTimeout(id)
      setCanvasReady(false)
    }
  }, [showCanvas])

  return (
    <>
      <span
        className={[
          'moss-hero-ambient-field',
          showCanvas ? 'moss-hero-ambient-field--gpu' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden
      />

      {showCanvas && canvasReady ? (
        <div className="moss-hero-ambient-canvas" aria-hidden>
          <Suspense fallback={null}>
            <HeroAmbientCanvas phase={phase} animated={animated} visible={visible} />
          </Suspense>
        </div>
      ) : null}
    </>
  )
}
