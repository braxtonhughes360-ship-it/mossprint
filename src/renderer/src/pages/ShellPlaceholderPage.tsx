import { MODULE_VISUAL } from '@shared/modules'
import { NAV_ITEMS, type AppRouteId } from '@shared/types'
import { SettingsChamber } from '../components/SettingsChamber'

interface ShellPlaceholderPageProps {
  routeId: Exclude<AppRouteId, 'dashboard'>
}

export function ShellPlaceholderPage({ routeId }: ShellPlaceholderPageProps): React.JSX.Element {
  const item = NAV_ITEMS.find((nav) => nav.id === routeId)

  if (!item) {
    return <div className="p-8 text-ink-muted">Unknown route.</div>
  }

  const isSettings = routeId === 'settings'
  const isCalendar = routeId === 'calendar'
  const isInbox = routeId === 'inbox'
  const visual =
    routeId === 'settings'
      ? { tag: 'Core', lane: 'System', descriptor: 'Preferences · memory', texture: 'quiet' as const, watermark: '◎' }
      : MODULE_VISUAL[routeId]

  return (
    <div
      className={['moss-arrival', `moss-arrival-${routeId}`].join(' ')}
      data-module={routeId}
      data-texture={visual.texture}
    >
      <header
        className={[
          'moss-arrival-band',
          isSettings ? 'moss-arrival-band-chamber settings-arrival-band' : `${routeId}-arrival-band`
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isSettings && (
          <>
            <div className="moss-env-light-fields" aria-hidden>
              <span className="moss-env-light-field moss-env-light-field-a" />
              <span className="moss-env-light-field moss-env-light-field-b" />
            </div>
            <span className="moss-env-air-veil moss-arrival-air-veil" aria-hidden />
          </>
        )}
        <div className="moss-arrival-band-inner module-arrival-head">
          <div className="module-arrival-title-block">
            <h1 className="display-arrival">{item.label}</h1>
          </div>

          {isCalendar && (
            <div className="module-arrival-meta-block">
              <p className="module-arrival-meta nutrition-mono">Planning · local memory</p>
            </div>
          )}

          {isInbox && (
            <div className="module-arrival-meta-block">
              <p className="module-arrival-meta nutrition-mono">0 unread</p>
            </div>
          )}
        </div>
      </header>

      <div className={['moss-arrival-body', `${routeId}-arrival-body`].join(' ')}>
        {isSettings ? (
          <SettingsChamber />
        ) : (
          <section className="module-workspace-slab">
            {isCalendar ? (
              <>
                <p className="module-workspace-kicker">Planning</p>
                <h2 className="module-workspace-title">Week & deadlines</h2>
                <p className="module-workspace-copy">
                  Classes, exams, and synced calendars anchor here.
                </p>
              </>
            ) : (
              <>
                <p className="module-workspace-kicker">Comms</p>
                <h2 className="module-workspace-title">Triage surface</h2>
                <p className="module-workspace-copy">
                  Your mail lands here once an account is connected.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
