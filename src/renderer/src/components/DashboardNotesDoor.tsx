import { memo } from 'react'
import { m } from 'motion/react'
import { Link } from 'react-router-dom'
import type { NotesDoorSnapshot } from '@shared/notes'
import { formatOpenTasksLine, noteDisplayTitle } from '@shared/notes'
import { MODULE_VISUAL } from '@shared/modules'
import type { NavItem } from '@shared/types'
import { DashboardDoorSkeleton } from './DashboardDoorSkeleton'

interface DashboardNotesDoorProps {
  item: NavItem
  snapshot: NotesDoorSnapshot | null
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

export const DashboardNotesDoor = memo(function DashboardNotesDoor({
  item,
  snapshot,
  loading = false,
  motionIndex = 5,
  entranceEnabled = false,
  variant = 'secondary'
}: DashboardNotesDoorProps): React.JSX.Element {
  const visual = MODULE_VISUAL.notes
  const variantClass = variant === 'accent' ? 'module-door--accent' : 'module-door--secondary'
  const hasGlance = Boolean(snapshot?.pinnedNote || snapshot?.lastEdited || snapshot?.openTaskCount)

  const door = (
    <Link
      to={item.path}
      className={[
        'dashboard-notes-door module-door',
        variantClass,
        'module-door-notes'
      ].join(' ')}
      data-module="notes"
      data-texture={visual.texture}
      aria-label="Notes module"
    >
      <span className="dashboard-notes-door-sigil" aria-hidden />
      <span className="dashboard-notes-door-ambient" aria-hidden />

      <div className="module-door-body dashboard-notes-door-body">
        <div className="module-door-head">
          <span className="module-door-kicker">{visual.tag}</span>
          <span className="module-door-name">{item.label}</span>
        </div>

        {loading && !snapshot ? (
          <DashboardDoorSkeleton label="notes" />
        ) : !hasGlance || !snapshot ? (
          <p className="dashboard-notes-door-empty-copy">
            Keep thoughts and checklists — create your first note →
          </p>
        ) : (
          <div className="dashboard-notes-door-glance">
            {snapshot.pinnedNote ? (
              <p className="dashboard-notes-door-glance-line">{snapshot.pinnedNote.title}</p>
            ) : snapshot.lastEdited ? (
              <p className="dashboard-notes-door-glance-line">
                {noteDisplayTitle(snapshot.lastEdited.title)}
              </p>
            ) : null}

            {snapshot.checklistProgress ? (
              <p className="dashboard-notes-door-hint nutrition-mono">
                {snapshot.checklistProgress.done}/{snapshot.checklistProgress.total} done ·{' '}
                {noteDisplayTitle(snapshot.checklistProgress.noteTitle)}
              </p>
            ) : snapshot.openTaskCount > 0 ? (
              <p className="dashboard-notes-door-hint nutrition-mono">
                {formatOpenTasksLine(snapshot.openTaskCount)}
              </p>
            ) : (
              <p className="dashboard-notes-door-hint">New note →</p>
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
