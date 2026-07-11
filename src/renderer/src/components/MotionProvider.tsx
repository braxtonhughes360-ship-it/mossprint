import { LazyMotion, type FeatureBundle } from 'motion/react'
import type { ReactNode } from 'react'

/** domMax — NavRow layoutId pill needs layout projection (domAnimation is too slim). */
const loadDomMax = (): Promise<FeatureBundle> =>
  import('motion/react').then((mod) => mod.domMax)

export function MotionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <LazyMotion features={loadDomMax} strict>
      {children}
    </LazyMotion>
  )
}
