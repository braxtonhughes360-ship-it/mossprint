import { m } from 'motion/react'
import { Children, createContext, useContext, useState, type ReactNode } from 'react'
import { useMotionGates } from '../hooks/useMotionGates'
import {
  mossListFadeItemVariants,
  mossListStaggerContainerVariants,
  mossListStaggerItemVariants,
  type MossMotionTier
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
  maxAnimatedItems?: number
}

interface MossListStaggerItemProps {
  as?: ItemTag
  className?: string
  children: ReactNode
}

interface ListEntranceContextValue {
  entranceComplete: boolean
  tier: Exclude<MossMotionTier, 'off'>
}

const ListEntranceContext = createContext<ListEntranceContextValue | null>(null)

/**
 * One-shot list/grid entrance. The tier is captured on mount so a preference
 * change or data invalidation can never restart a list the person is reading.
 */
export function MossListStagger({
  as = 'div',
  className,
  children,
  disabled = false,
  maxAnimatedItems = 24
}: MossListStaggerProps): React.JSX.Element {
  const { motionEnabled, presenceEnabled } = useMotionGates()
  const [entrance] = useState<{
    enabled: boolean
    tier: Exclude<MossMotionTier, 'off'>
  }>(() => ({
    enabled: motionEnabled && !disabled && Children.count(children) <= maxAnimatedItems,
    tier: presenceEnabled ? 'full' : 'reduced'
  }))
  const [entranceComplete, setEntranceComplete] = useState(!entrance.enabled)
  const Tag = as

  if (!entrance.enabled) {
    return <Tag className={className}>{children}</Tag>
  }

  const MotionTag = STAGGER_MOTION[as]
  return (
    <ListEntranceContext.Provider value={{ entranceComplete, tier: entrance.tier }}>
      <MotionTag
        className={className}
        initial="hidden"
        animate="visible"
        variants={mossListStaggerContainerVariants}
        onAnimationComplete={() => setEntranceComplete(true)}
      >
        {children}
      </MotionTag>
    </ListEntranceContext.Provider>
  )
}

/** Child row for MossListStagger — must be a direct child of the container. */
export function MossListStaggerItem({
  as = 'div',
  className,
  children
}: MossListStaggerItemProps): React.JSX.Element {
  const entrance = useContext(ListEntranceContext)
  const Tag = as

  if (!entrance) {
    return <Tag className={className}>{children}</Tag>
  }

  const MotionTag = ITEM_MOTION[as]
  return (
    <MotionTag
      className={className}
      initial={entrance.entranceComplete ? false : undefined}
      variants={
        entrance.entranceComplete
          ? undefined
          : entrance.tier === 'full'
            ? mossListStaggerItemVariants
            : mossListFadeItemVariants
      }
    >
      {children}
    </MotionTag>
  )
}
