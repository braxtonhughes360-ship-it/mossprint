import { memo } from 'react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { MODULE_VISUAL } from '@shared/modules'
import type { NavItem } from '@shared/types'
import { useMotionGates } from '../hooks/useMotionGates'
import { mossDoorVariants } from '../lib/mossMotion'

export type ModuleDoorVariant = 'featured' | 'accent' | 'secondary'

interface ModuleDoorLinkProps {
  item: NavItem
  variant?: ModuleDoorVariant
  motionIndex?: number
  entranceEnabled?: boolean
  /** Live module readout — replaces static descriptor when set. */
  detailLine?: string
}

export const ModuleDoorLink = memo(function ModuleDoorLink({
  item,
  variant = 'secondary',
  motionIndex = 0,
  entranceEnabled = false,
  detailLine
}: ModuleDoorLinkProps): React.JSX.Element {
  const { routeTransitionFull } = useMotionGates()
  const visual = MODULE_VISUAL[item.id as keyof typeof MODULE_VISUAL]
  const variantClass =
    variant === 'featured'
      ? 'module-door--featured'
      : variant === 'accent'
        ? 'module-door--accent'
        : 'module-door--secondary'

  const bodyClass = `module-door-body module-door-body--${variant}`
  const headClass = `module-door-head module-door-head--${variant}`
  const detail = detailLine ?? visual?.descriptor ?? null

  const door = (
    <Link
      to={item.path}
      viewTransition={routeTransitionFull}
      className={['module-door', variantClass, `module-door-${item.id}`].join(' ')}
      data-module={item.id}
      data-texture={visual?.texture}
    >
      {variant === 'featured' && item.id === 'calendar' ? (
        <span className="module-door-ambient module-door-ambient--featured" aria-hidden />
      ) : null}

      <div className={bodyClass}>
        <div className={headClass}>
          {variant === 'secondary' ? (
            <>
              <span className="module-door-kicker module-door-kicker--inline">{visual?.tag}</span>
              <span className="module-door-name">{item.label}</span>
            </>
          ) : (
            <>
              <span className="module-door-kicker">{visual?.tag}</span>
              <span className="module-door-name">{item.label}</span>
            </>
          )}
        </div>

        {detail ? (
          variant === 'featured' ? (
            <div className="module-door-inset">
              <span className="module-door-detail">{detail}</span>
            </div>
          ) : variant === 'accent' ? (
            <div className="module-door-inset module-door-inset--compact">
              <span className="module-door-detail">{detail}</span>
            </div>
          ) : (
            <span className="module-door-detail">{detail}</span>
          )
        ) : null}
      </div>
    </Link>
  )

  if (!entranceEnabled) {
    return <div className="module-door-wrap">{door}</div>
  }

  return (
    <motion.div
      className="module-door-wrap"
      custom={motionIndex}
      initial="hidden"
      animate="visible"
      variants={mossDoorVariants}
    >
      {door}
    </motion.div>
  )
})
