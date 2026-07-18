import { memo } from 'react'
import { m } from 'motion/react'
import { Link } from 'react-router-dom'
import type { NutritionDoorSnapshot } from '@shared/nutrition'
import { formatMacroG, formatRemainingKcalLine } from '@shared/nutrition'
import { MODULE_VISUAL } from '@shared/modules'
import type { NavItem } from '@shared/types'
import { DashboardDoorSkeleton } from './DashboardDoorSkeleton'

interface DashboardNutritionDoorProps {
  item: NavItem
  snapshot: NutritionDoorSnapshot | null
  loading?: boolean
  motionIndex?: number
  entranceEnabled?: boolean
  variant?: 'secondary' | 'accent'
}

const doorVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: index * 0.06,
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1] as const
    }
  })
}

function macroBarWidth(consumed: number, target: number): number {
  if (target <= 0) return 0
  return Math.round(Math.min(1, consumed / target) * 100)
}

// Kcal ring geometry — 36 viewBox, 3px stroke.
const KCAL_RING_RADIUS = 15.5
const KCAL_RING_CIRCUMFERENCE = 2 * Math.PI * KCAL_RING_RADIUS

/** Glance-density door — remaining kcal hero + macro strip. */
export const DashboardNutritionDoor = memo(function DashboardNutritionDoor({
  item,
  snapshot,
  loading = false,
  motionIndex = 2,
  entranceEnabled = false,
  variant = 'secondary'
}: DashboardNutritionDoorProps): React.JSX.Element {
  const visual = MODULE_VISUAL.nutrition
  const summary = snapshot?.summary
  const hasGoals = (summary?.goals.calorieTarget ?? 0) > 0
  const showGlance = Boolean(snapshot && summary && hasGoals)
  const calorieTarget = summary?.goals.calorieTarget ?? 0
  const consumedKcal = summary?.totals.consumedKcal ?? 0
  const kcalFraction =
    calorieTarget > 0 ? Math.min(1, Math.max(0, consumedKcal / calorieTarget)) : 0
  const overGoal = (summary?.remainingKcal ?? 0) < 0
  const variantClass = variant === 'accent' ? 'module-door--accent' : 'module-door--secondary'

  const door = (
    <Link
      to={item.path}
      className={[
        'dashboard-nutrition-door module-door',
        variantClass,
        'module-door-nutrition'
      ].join(' ')}
      data-module="nutrition"
      data-texture={visual.texture}
      aria-label="Nutrition module"
    >
      <span className="dashboard-nutrition-door-sigil moss-nutrition-organic-fill" aria-hidden />
      <span className="dashboard-nutrition-door-ambient" aria-hidden />

      <div className="module-door-body dashboard-nutrition-door-body">
        <div className="module-door-head">
          <span className="module-door-kicker">{visual.tag}</span>
          <span className="module-door-name">{item.label}</span>
        </div>

        {loading && !snapshot ? (
          <DashboardDoorSkeleton density={variant === 'accent' ? 'accent' : 'secondary'} label="nutrition" />
        ) : !showGlance || !summary ? (
          <p className="dashboard-nutrition-door-empty-copy">
            Start your food diary — log your first meal →
          </p>
        ) : (
          <div className="dashboard-nutrition-door-glance">
            <div className="dashboard-nutrition-door-glance-primary">
              <svg
                className="dashboard-nutrition-door-kcal-ring"
                viewBox="0 0 36 36"
                role="img"
                aria-label={`${Math.round(consumedKcal)} of ${calorieTarget} kcal eaten`}
              >
                <circle
                  className="dashboard-nutrition-door-kcal-ring-track"
                  cx="18"
                  cy="18"
                  r={KCAL_RING_RADIUS}
                />
                <circle
                  className={[
                    'dashboard-nutrition-door-kcal-ring-fill',
                    overGoal ? 'dashboard-nutrition-door-kcal-ring-fill--over' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  cx="18"
                  cy="18"
                  r={KCAL_RING_RADIUS}
                  strokeDasharray={KCAL_RING_CIRCUMFERENCE}
                  strokeDashoffset={KCAL_RING_CIRCUMFERENCE * (1 - kcalFraction)}
                />
              </svg>
              <span
                className={[
                  'dashboard-nutrition-door-glance-line nutrition-mono',
                  summary.remainingKcal < 0 ? 'dashboard-nutrition-door-glance-line--over' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {formatRemainingKcalLine(summary.remainingKcal)}
              </span>
            </div>

            {snapshot && (
              <div className="dashboard-nutrition-door-macro-strip" aria-label="Macro progress">
                {(['protein', 'carbs', 'fat'] as const).map((key) => {
                  const macro = snapshot.macroProgress[key]
                  const label = key === 'protein' ? 'P' : key === 'carbs' ? 'C' : 'F'
                  return (
                    <div key={key} className="dashboard-nutrition-door-macro">
                      <div className="dashboard-nutrition-door-macro-head">
                        <span className="dashboard-nutrition-door-macro-label">{label}</span>
                        <span className="dashboard-nutrition-door-macro-value nutrition-mono">
                          {formatMacroG(macro.consumed)}
                        </span>
                      </div>
                      <span className="dashboard-nutrition-door-macro-bar" aria-hidden>
                        <span
                          className="dashboard-nutrition-door-macro-fill"
                          style={{ width: `${macroBarWidth(macro.consumed, macro.target)}%` }}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {snapshot && snapshot.mealsLogged > 0 ? (
              <p className="dashboard-nutrition-door-hint nutrition-mono">
                {snapshot.mealsLogged} meal{snapshot.mealsLogged === 1 ? '' : 's'} logged
              </p>
            ) : (
              <p className="dashboard-nutrition-door-hint">Describe your first meal →</p>
            )}
          </div>
        )}
      </div>
    </Link>
  )

  if (!entranceEnabled) {
    return <div className="module-door-wrap">{door}</div>
  }

  return (
    <m.div
      className="module-door-wrap"
      custom={motionIndex}
      initial="hidden"
      animate="visible"
      variants={doorVariants}
    >
      {door}
    </m.div>
  )
})
