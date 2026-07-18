import { AnimatePresence, m } from 'motion/react'
import type { Key, ReactNode } from 'react'
import { useMotionGates } from '../hooks/useMotionGates'
import { mossPanelVariants, type MossMotionTier } from '../lib/mossMotion'

interface MossPanelTransitionProps {
  transitionKey: Key
  children: ReactNode
  className?: string
}

/** Keyed in-module panel transition. Data refreshes keep the same key and never replay it. */
export function MossPanelTransition({
  transitionKey,
  children,
  className
}: MossPanelTransitionProps): React.JSX.Element {
  const { motionEnabled, presenceEnabled } = useMotionGates()
  const tier: MossMotionTier = !motionEnabled
    ? 'off'
    : presenceEnabled
      ? 'full'
      : 'reduced'

  return (
    <AnimatePresence mode="wait">
      <m.div
        key={transitionKey}
        className={className}
        initial={tier === 'off' ? false : 'hidden'}
        animate="visible"
        exit="exit"
        variants={mossPanelVariants(tier)}
      >
        {children}
      </m.div>
    </AnimatePresence>
  )
}
