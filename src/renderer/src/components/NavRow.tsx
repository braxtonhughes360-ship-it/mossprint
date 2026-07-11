import { m } from 'motion/react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { AppRouteId } from '@shared/types'
import type { NAV_ITEMS } from '@shared/types'
import { useMotionGates } from '../hooks/useMotionGates'
import {
  mossNavIndicatorTransition,
  mossNavLabelTransition
} from '../lib/mossMotion'
import { CalendarNavGlyph } from './CalendarNavGlyph'
import { DashboardNavGlyph } from './DashboardNavGlyph'
import { InboxNavGlyph } from './InboxNavGlyph'
import { MoneyNavGlyph } from './MoneyNavGlyph'
import { NutritionNavGlyph } from './NutritionNavGlyph'
import { SettingsNavGlyph } from './SettingsNavGlyph'
import { NavIcon } from './NavIcon'

interface NavRowProps {
  item: (typeof NAV_ITEMS)[number]
  isActive: boolean
  motionEnabled: boolean
}

function NavGlyph({
  id,
  active,
  burstTick
}: {
  id: AppRouteId
  active: boolean
  burstTick: number
}): React.JSX.Element {
  switch (id) {
    case 'dashboard':
      return <DashboardNavGlyph active={active} burstTick={burstTick} />
    case 'calendar':
      return <CalendarNavGlyph active={active} burstTick={burstTick} />
    case 'money':
      return <MoneyNavGlyph active={active} burstTick={burstTick} />
    case 'nutrition':
      return <NutritionNavGlyph active={active} burstTick={burstTick} />
    case 'inbox':
      return <InboxNavGlyph active={active} burstTick={burstTick} />
    case 'notes':
      return <NavIcon id="notes" />
    case 'settings':
      return <SettingsNavGlyph active={active} burstTick={burstTick} />
    default:
      return <NavIcon id={id} />
  }
}

/**
 * Sidebar nav — every item is an animated character glyph (Money bills burst,
 * Nutrition produce flies, Calendar day-tiles flutter, Inbox letters, Dashboard
 * tiles pop, Settings cogs spin). Bursts on click; motion-tier gated.
 */
export function NavRow({ item, isActive, motionEnabled }: NavRowProps): React.JSX.Element {
  const { routeTransitionFull } = useMotionGates()
  const indicatorTransition = mossNavIndicatorTransition(motionEnabled)
  const labelTransition = mossNavLabelTransition(motionEnabled)
  const [burstTick, setBurstTick] = useState(0)

  return (
    <NavLink
      to={item.path}
      title={item.label}
      viewTransition={routeTransitionFull}
      onClick={motionEnabled ? () => setBurstTick((tick) => tick + 1) : undefined}
      className={[
        'moss-nav-link',
        'moss-nav-link--glyph',
        isActive ? 'moss-nav-active' : 'moss-nav-idle'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isActive && (
        <m.span
          layoutId="nav-active"
          className="moss-nav-indicator"
          transition={indicatorTransition}
        />
      )}

      <span className="moss-nav-glyph" aria-hidden>
        <NavGlyph id={item.id} active={isActive} burstTick={burstTick} />
      </span>

      <m.span
        className="moss-nav-label truncate"
        animate={motionEnabled ? { opacity: isActive ? 1 : 0.58 } : undefined}
        transition={labelTransition}
      >
        {item.label}
      </m.span>
    </NavLink>
  )
}
