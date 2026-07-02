import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { NAV_ITEMS } from '@shared/types'
import { isModuleNavEnabled } from '@shared/preferences'
import { useFormEnterSubmit } from '../hooks/useFormEnterSubmit'
import { useMotionGates } from '../hooks/useMotionGates'
import { useNavShortcuts } from '../hooks/useNavShortcuts'
import { usePreferences } from '../context/PreferencesProvider'
import { useTimePhase } from '../hooks/useTimePhase'
import { MossBrandLockup } from './MossBrandLockup'
import { NavRow } from './NavRow'
import { StageAmbientField } from './ambient/StageAmbientField'

const DASHBOARD = NAV_ITEMS.find((item) => item.id === 'dashboard')!
const SETTINGS = NAV_ITEMS.find((item) => item.id === 'settings')!
const MODULE_NAV = NAV_ITEMS.filter(
  (item) => item.id !== 'dashboard' && item.id !== 'settings'
)

export function AppShell(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const { preferences, ready } = usePreferences()
  const { motionEnabled } = useMotionGates()
  const timePhase = useTimePhase()
  const stageFillRef = useRef<HTMLDivElement>(null)
  const isSettings = location.pathname.startsWith('/settings')
  const isDashboard = location.pathname === '/'
  const isRoutedView = !isDashboard
  const moduleNav = MODULE_NAV.filter((item) =>
    isModuleNavEnabled(preferences.modules, item.id)
  )

  useNavShortcuts()
  useFormEnterSubmit()

  useEffect(() => {
    if (!window.moss?.profiles?.touchActivity) return
    const bump = (): void => window.moss.profiles.touchActivity()
    const events = ['mousedown', 'keydown', 'wheel', 'touchstart'] as const
    let last = 0
    const onActivity = (): void => {
      const now = Date.now()
      if (now - last < 30_000) return
      last = now
      bump()
    }
    for (const event of events) {
      window.addEventListener(event, onActivity, { passive: true })
    }
    bump()
    return () => {
      for (const event of events) {
        window.removeEventListener(event, onActivity)
      }
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (location.pathname !== '/') return
    if (preferences.setup.completedAt === null) navigate('/setup', { replace: true })
  }, [ready, preferences.setup.completedAt, location.pathname, navigate])

  useEffect(() => {
    const shell = stageFillRef.current
    if (!shell) return
    shell.scrollTop = 0
    shell.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [location.pathname])

  const routeClassName = [
    'moss-route-view',
    isSettings ? 'moss-settings-route' : '',
    isRoutedView && !isSettings ? 'moss-module-route' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="moss-render-root flex h-full overflow-hidden">
      <div className="moss-window-drag" aria-hidden />
      <aside className="moss-chassis">
        <div className="moss-chassis-brand-zone">
          <span className="moss-brand-glow" aria-hidden />
          <header className="moss-chassis-brand">
            <MossBrandLockup />
          </header>
        </div>

        <nav className="moss-chassis-nav" aria-label="Primary">
          <NavRow item={DASHBOARD} isActive={location.pathname === '/'} motionEnabled={motionEnabled} />

          <p className="moss-nav-section">Modules</p>

          {moduleNav.map((item) => (
            <NavRow
              key={item.id}
              item={item}
              isActive={location.pathname.startsWith(item.path)}
              motionEnabled={motionEnabled}
            />
          ))}

          <div className="moss-nav-spacer" aria-hidden />

          <NavRow
            item={SETTINGS}
            isActive={isSettings}
            motionEnabled={motionEnabled}
          />
        </nav>
      </aside>

      <main className="moss-stage" data-time-phase={timePhase}>
        <div className="moss-stage-atmosphere" aria-hidden>
          <div className="moss-env-light-fields">
            <span className="moss-env-light-field moss-env-light-field-a" />
            <span className="moss-env-light-field moss-env-light-field-b" />
          </div>
          <span className="moss-env-air-veil" />
        </div>
        <StageAmbientField phase={timePhase} />
        <div className="moss-stage-fill" ref={stageFillRef}>
          <div className="moss-route-shell">
            <div className={routeClassName}>
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
