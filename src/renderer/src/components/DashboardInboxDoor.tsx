import { memo } from 'react'
import { m } from 'motion/react'
import { Link } from 'react-router-dom'
import { MODULE_VISUAL } from '@shared/modules'
import type { MailDoorSnapshot } from '@shared/mail'
import { formatMailAge, mailDisplayName } from '@shared/mail'
import type { NavItem } from '@shared/types'

interface DashboardInboxDoorProps {
  item: NavItem
  snapshot: MailDoorSnapshot | null
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

export const DashboardInboxDoor = memo(function DashboardInboxDoor({
  item,
  snapshot,
  motionIndex = 3,
  entranceEnabled = false
}: DashboardInboxDoorProps): React.JSX.Element {
  const visual = MODULE_VISUAL.inbox
  const noAccounts = snapshot !== null && snapshot.totalAccounts === 0
  const unread = snapshot?.unreadCount ?? 0
  const latest = snapshot?.latest ?? null

  const hint = noAccounts
    ? 'Connect Gmail to triage here'
    : latest
      ? `${mailDisplayName(latest.fromName, '')} · ${latest.subject || '(no subject)'}`
      : 'Inbox is clear'

  const door = (
    <Link
      to={item.path}
      className="dashboard-inbox-door module-door module-door--secondary module-door-inbox"
      data-module="inbox"
      data-texture={visual.texture}
      aria-label="Inbox module"
    >
      <span className="dashboard-inbox-door-ambient" aria-hidden />

      <div className="module-door-body dashboard-inbox-door-body">
        <div className="module-door-head">
          <span className="module-door-kicker">{visual.tag}</span>
          <span className="module-door-name">{item.label}</span>
        </div>

        <div className="dashboard-inbox-door-glance" aria-label="Inbox glance">
          <div className="dashboard-inbox-door-glance-primary">
            <span className="dashboard-inbox-door-glance-value nutrition-mono">
              {snapshot === null ? '—' : unread}
            </span>
            <span className="dashboard-inbox-door-glance-label">Unread</span>
          </div>
          <p className="dashboard-inbox-door-glance-hint">
            {snapshot?.hasStaleAccounts && !noAccounts && (
              <span className="dashboard-inbox-door-stale">Sync needed · </span>
            )}
            {hint}
            {latest && !noAccounts && (
              <span className="dashboard-inbox-door-glance-age nutrition-mono">
                {' '}
                {formatMailAge(latest.receivedAt)}
              </span>
            )}
          </p>
        </div>
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
