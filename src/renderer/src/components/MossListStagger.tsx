import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useMotionGates } from '../hooks/useMotionGates'
import {
  mossListStaggerContainerVariants,
  mossListStaggerItemVariants
} from '../lib/mossMotion'

type StaggerTag = 'ul' | 'ol' | 'div'
type ItemTag = 'li' | 'div'

const STAGGER_MOTION = {
  ul: m.ul,
  ol: m.ol,
  div: m.div
} as const

const ITEM_MOTION = {
  li: m.li,
  div: m.div
} as const

interface MossListStaggerProps {
  as?: StaggerTag
  className?: string
  children: ReactNode
  disabled?: boolean
}

interface MossListStaggerItemProps {
  as?: ItemTag
  className?: string
  children: ReactNode
}

/** Staggered list/grid entrance — 50ms cadence, y:8→0, motion-tier gated. */
export function MossListStagger({
  as = 'div',
  className,
  children,
  disabled = false
}: MossListStaggerProps): React.JSX.Element {
  const { motionEnabled } = useMotionGates()
  const enabled = motionEnabled && !disabled
  const Tag = as

  if (!enabled) {
    return <Tag className={className}>{children}</Tag>
  }

  const MotionTag = STAGGER_MOTION[as]
  return (
    <MotionTag
      className={className}
      initial="hidden"
      animate="visible"
      variants={mossListStaggerContainerVariants}
    >
      {children}
    </MotionTag>
  )
}

/** Child row for MossListStagger — must be a direct child of the container. */
export function MossListStaggerItem({
  as = 'div',
  className,
  children
}: MossListStaggerItemProps): React.JSX.Element {
  const { motionEnabled } = useMotionGates()
  const Tag = as

  if (!motionEnabled) {
    return <Tag className={className}>{children}</Tag>
  }

  const MotionTag = ITEM_MOTION[as]
  return (
    <MotionTag className={className} variants={mossListStaggerItemVariants}>
      {children}
    </MotionTag>
  )
}
