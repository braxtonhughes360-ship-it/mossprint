import { memo } from 'react'
import { m } from 'motion/react'
import { Link } from 'react-router-dom'
import type { CalendarDoorSnapshot } from '@shared/calendar'
import { formatEventKindLabel, formatEventScheduleLabel } from '@shared/calendar'
import { MODULE_VISUAL } from '@shared/modules'
import type { NavItem } from '@shared/types'
import { usePreferences } from '../context/PreferencesProvider'
import { DashboardDoorSkeleton } from './DashboardDoorSkeleton'

interface DashboardCalendarDoorProps {
  item: NavItem
  snapshot: CalendarDoorSnapshot | null
  loading?: boolean
  motionIndex?: number
  entranceEnabled?: boolean
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

// Door timeline window — waking day, not the raw 24h clock.
const TIMELINE_START_HOUR = 7
const TIMELINE_END_HOUR = 23

interface TimelineSegment {
  id: string
  title: string
  leftPct: number
  widthPct: number
}

/** Percent position within the door's day window; null when outside it. */
function timelinePct(ms: number, windowStartMs: number, windowMs: number): number {
  return ((ms - windowStartMs) / windowMs) * 100
}

function buildTimelineSegments(
  events: Array<{ id: string; title: string; startAt: string; endAt: string }>,
  dateKey: string
): { segments: TimelineSegment[]; nowPct: number | null } {
  const windowStart = new Date(`${dateKey}T00:00:00`)
  windowStart.setHours(TIMELINE_START_HOUR, 0, 0, 0)
  const windowStartMs = windowStart.getTime()
  const windowMs = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60 * 60 * 1000

  const segments: TimelineSegment[] = []
  for (const event of events) {
    const startMs = new Date(event.startAt).getTime()
    const endMs = new Date(event.endAt).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue
    // All-day imports would paint the whole track — the count already covers them.
    if (endMs - startMs >= 20 * 60 * 60 * 1000) continue
    if (endMs <= windowStartMs || startMs >= windowStartMs + windowMs) continue

    const leftPct = Math.max(0, timelinePct(startMs, windowStartMs, windowMs))
    const rightPct = Math.min(100, timelinePct(endMs, windowStartMs, windowMs))
    segments.push({
      id: event.id,
      title: event.title,
      leftPct,
      widthPct: Math.max(rightPct - leftPct, 1.5)
    })
  }

  const nowMs = Date.now()
  const nowRaw = timelinePct(nowMs, windowStartMs, windowMs)
  const nowPct = nowRaw >= 0 && nowRaw <= 100 ? nowRaw : null

  return { segments, nowPct }
}

export const DashboardCalendarDoor = memo(function DashboardCalendarDoor({
  item,
  snapshot,
  loading = false,
  motionIndex = 0,
  entranceEnabled = false
}: DashboardCalendarDoorProps): React.JSX.Element {
  const { preferences } = usePreferences()
  const academicsEnabled = preferences.modules.calendar.academicsEnabled
  const visual = MODULE_VISUAL.calendar
  const todayStamp = String(new Date().getDate()).padStart(2, '0')
  // Academic events only surface on the door when the student layer is opted in.
  const academic = academicsEnabled ? (snapshot?.nextAcademicEvent ?? null) : null
  const headline = snapshot?.nextEvent ?? academic ?? null
  const showGlance = snapshot && (headline || snapshot.todayEventCount > 0)
  const { segments, nowPct } = snapshot
    ? buildTimelineSegments(snapshot.todayTimeline ?? [], snapshot.dateKey)
    : { segments: [], nowPct: null }

  const door = (
    <Link
      to={item.path}
      className={[
        'dashboard-calendar-door module-door module-door--featured module-door-calendar'
      ].join(' ')}
      data-module={item.id}
      data-texture={visual.texture}
    >
      <span className="dashboard-calendar-door-ambient module-door-ambient" aria-hidden />
      <span className="module-door-stamp module-door-stamp--featured" aria-hidden title="Today">
        {todayStamp}
      </span>

      <div className="module-door-body dashboard-calendar-door-body">
        <div className="module-door-head">
          <span className="module-door-kicker">{visual.tag}</span>
          <span className="module-door-name">{item.label}</span>
        </div>

        {loading && !snapshot ? (
          <DashboardDoorSkeleton density="featured" label="calendar" />
        ) : !showGlance ? (
          <p className="dashboard-calendar-door-empty-copy">
            Plan your week — add your first event →
          </p>
        ) : (
          <div className="dashboard-calendar-door-glance" aria-label="Calendar glance">
            {headline ? (
              <div className="dashboard-calendar-door-glance-primary">
                <span className="dashboard-calendar-door-glance-time nutrition-mono">
                  {formatEventScheduleLabel(headline.startAt, snapshot.dateKey)}
                </span>
                <span className="dashboard-calendar-door-glance-title">{headline.title}</span>
                {academicsEnabled && headline.kind !== 'general' && (
                  <span className="dashboard-calendar-door-glance-kind nutrition-mono">
                    {formatEventKindLabel(headline.kind)}
                  </span>
                )}
              </div>
            ) : (
              <p className="dashboard-calendar-door-empty-copy">
                {snapshot.todayEventCount > 0
                  ? 'Done for today — nothing upcoming.'
                  : 'Open day — add or import events →'}
              </p>
            )}

            {segments.length > 0 && (
              <div
                className="dashboard-calendar-door-timeline"
                role="img"
                aria-label={`Today's schedule, ${snapshot.todayEventCount} event${snapshot.todayEventCount === 1 ? '' : 's'}`}
              >
                {[25, 50, 75].map((tick) => (
                  <span
                    key={tick}
                    className="dashboard-calendar-door-timeline-tick"
                    style={{ left: `${tick}%` }}
                    aria-hidden
                  />
                ))}
                {segments.map((segment) => (
                  <span
                    key={segment.id}
                    className="dashboard-calendar-door-timeline-event"
                    style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%` }}
                    title={segment.title}
                  />
                ))}
                {nowPct !== null && (
                  <span
                    className="dashboard-calendar-door-timeline-now"
                    style={{ left: `${nowPct}%` }}
                    aria-hidden
                  />
                )}
              </div>
            )}

            <p className="dashboard-calendar-door-hint nutrition-mono">
              {snapshot.hasStaleSources && (
                <span className="dashboard-calendar-door-stale">Needs a refresh · </span>
              )}
              {snapshot.todayEventCount > 0
                ? `${snapshot.todayEventCount} today`
                : 'Nothing else today'}
              {academic &&
                headline?.id !== academic.id &&
                ` · Next ${formatEventKindLabel(academic.kind).toLowerCase()} ${formatEventScheduleLabel(academic.startAt, snapshot.dateKey).replace(/^Today |^Tomorrow /, '')}`}
            </p>
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
