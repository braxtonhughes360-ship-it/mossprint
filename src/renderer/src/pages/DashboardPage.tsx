import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  getGreetingBase,
  getGreetingPhase,
  isModuleNavEnabled
} from '@shared/preferences'
import { NAV_ITEMS } from '@shared/types'
import { ModuleDoorLink } from '../components/ModuleDoorLink'
import { DashboardCalendarDoor } from '../components/DashboardCalendarDoor'
import { DashboardInboxDoor } from '../components/DashboardInboxDoor'
import { DashboardMoneyDoor } from '../components/DashboardMoneyDoor'
import { DashboardNutritionDoor } from '../components/DashboardNutritionDoor'
import { DashboardNotesDoor } from '../components/DashboardNotesDoor'
import { DashboardNewsCard } from '../components/DashboardNewsCard'
import { UpdateBanner } from '../components/UpdateBanner'
import { HeroAmbientLightField } from '../components/hero/HeroAmbientLightField'
import { HeroInstrumentSurface } from '../components/hero/HeroInstrumentSurface'
import { DashboardCaptureBar } from '../components/DashboardCaptureBar'
import { HeroSolarInstrument } from '../components/HeroSolarInstrument'
import { HeroWeeklyScore } from '../components/HeroWeeklyScore'
import type { CaptureKind } from '@shared/capture'
import { useCalendarDoorSnapshot } from '../hooks/useCalendarDoorSnapshot'
import { useDoorEntranceOnce } from '../hooks/useDoorEntranceOnce'
import { useInboxDoorSnapshot } from '../hooks/useInboxDoorSnapshot'
import { useMoneyDoorSnapshot } from '../hooks/useMoneyDoorSnapshot'
import { useNutritionDoorSnapshot } from '../hooks/useNutritionDoorSnapshot'
import { useNotesDoorSnapshot } from '../hooks/useNotesDoorSnapshot'
import { useWeeklyScore } from '../hooks/useWeeklyScore'
import { useHeroEntranceOnce } from '../hooks/useHeroEntranceOnce'
import { useMotionGates } from '../hooks/useMotionGates'
import { preloadModuleChunks } from '../lib/preloadModuleChunks'
import { usePreferences } from '../context/PreferencesProvider'
import { useTimePhase } from '../hooks/useTimePhase'

const MODULE_ROUTES = NAV_ITEMS.filter((item) => item.id !== 'dashboard' && item.id !== 'settings')

const FEATURED_MODULE_ID = 'calendar'
const ACCENT_MODULE_ID = 'money'

export function DashboardPage(): React.JSX.Element {
  const location = useLocation()
  const { preferences } = usePreferences()
  const [storageError, setStorageError] = useState<string | null>(null)
  const [greetingPhase, setGreetingPhase] = useState(() => getGreetingPhase())
  const heroPhase = useTimePhase()
  const { motionEnabled } = useMotionGates()
  const heroEntranceEnabled = useHeroEntranceOnce()
  const doorEntranceEnabled = useDoorEntranceOnce()
  const {
    snapshot: moneySnapshot,
    loading: moneySnapshotLoading,
    refresh: refreshMoneySnapshot
  } = useMoneyDoorSnapshot()
  const {
    snapshot: nutritionSnapshot,
    loading: nutritionSnapshotLoading,
    refresh: refreshNutritionSnapshot
  } =
    useNutritionDoorSnapshot()
  const {
    snapshot: calendarSnapshot,
    loading: calendarSnapshotLoading,
    refresh: refreshCalendarSnapshot
  } =
    useCalendarDoorSnapshot()
  const {
    snapshot: inboxSnapshot,
    loading: inboxSnapshotLoading,
    refresh: refreshInboxSnapshot
  } = useInboxDoorSnapshot()
  const {
    snapshot: notesSnapshot,
    loading: notesSnapshotLoading,
    refresh: refreshNotesSnapshot
  } = useNotesDoorSnapshot()
  const {
    snapshot: weeklyScore,
    loading: weeklyScoreLoading,
    refresh: refreshWeeklyScore
  } = useWeeklyScore()
  const modules = preferences.modules

  useEffect(() => {
    if (location.pathname === '/') {
      void refreshMoneySnapshot()
      void refreshNutritionSnapshot()
      void refreshCalendarSnapshot()
      void refreshInboxSnapshot()
      void refreshNotesSnapshot()
      void refreshWeeklyScore()
    }
  }, [
    location.pathname,
    refreshMoneySnapshot,
    refreshNutritionSnapshot,
    refreshCalendarSnapshot,
    refreshInboxSnapshot,
    refreshNotesSnapshot,
    refreshWeeklyScore
  ])

  useEffect(() => {
    const tick = (): void => setGreetingPhase(getGreetingPhase())
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Warm lazy route chunks after first paint so module clicks stay instant.
  useEffect(() => {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(() => preloadModuleChunks(), { timeout: 5000 })
      return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => preloadModuleChunks(), 1500)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        if (!window.moss?.db) return
        const ping = await window.moss.db.ping()
        if (!ping.value) {
          await window.moss.db.runHealthCheck()
        }
      } catch (err) {
        if (!cancelled) {
          setStorageError(err instanceof Error ? err.message : 'Local storage unavailable')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const enabledModules = MODULE_ROUTES.filter((item) =>
    isModuleNavEnabled(modules, item.id)
  )
  const featured =
    enabledModules.find((item) => item.id === FEATURED_MODULE_ID) ?? enabledModules[0]
  const accent =
    modules.money.enabled && enabledModules.some((item) => item.id === ACCENT_MODULE_ID)
      ? enabledModules.find((item) => item.id === ACCENT_MODULE_ID)!
      : null
  const secondary = enabledModules.filter(
    (item) =>
      item.id !== featured?.id &&
      item.id !== 'nutrition' &&
      item.id !== 'inbox' &&
      item.id !== 'notes' &&
      (accent ? item.id !== accent.id : true)
  )

  const showMoneyDoor = Boolean(accent && modules.money.enabled)
  const showNutritionDoor =
    modules.nutrition.enabled && enabledModules.some((item) => item.id === 'nutrition')
  const showInboxDoor = modules.inbox.enabled && enabledModules.some((item) => item.id === 'inbox')
  const showNotesDoor = modules.notes.enabled && enabledModules.some((item) => item.id === 'notes')
  const showInfoColumn = showMoneyDoor || showNutritionDoor || showInboxDoor || showNotesDoor

  const newsConfig = {
    enabled: modules.news.enabled,
    maxItems: modules.news.maxItems,
    widgetLayout: modules.news.widgetLayout ?? 'split',
    briefingMode: modules.news.briefingMode,
    maxPerSource: modules.news.maxPerSource
  }

  const { weekday, dateLine, year } = formatDateParts()
  const displayName = preferences.profile.displayName.trim()
  const greetingBase = getGreetingBase(greetingPhase)

  const handleCaptureLogged = (kind: CaptureKind): void => {
    if (kind === 'money') void refreshMoneySnapshot()
    if (kind === 'nutrition') void refreshNutritionSnapshot()
    if (kind === 'calendar') void refreshCalendarSnapshot()
    if (kind === 'note') void refreshNotesSnapshot()
    if (kind === 'money' || kind === 'nutrition') void refreshWeeklyScore()
  }

  return (
    <div className="moss-dashboard" data-phase={greetingPhase}>
      {storageError && (
        <div className="error-banner">
          <p className="text-sm text-signal-error-text">{storageError}</p>
          <Link to="/settings" className="text-sm font-medium text-signal-error-text underline">
            Settings
          </Link>
        </div>
      )}

      <UpdateBanner />

      <section className="moss-hero moss-hero-cinematic" data-phase={heroPhase}>
        <HeroInstrumentSurface />
        <HeroAmbientLightField phase={heroPhase} />

        <div className={['moss-hero-grid', heroEntranceEnabled ? 'moss-hero-enter' : ''].filter(Boolean).join(' ')}>
          <div className="moss-hero-instrument-plate">
            <div className="moss-hero-content">
              <div className="hero-primary min-w-0">
                <h1 className={['display-hero', heroEntranceEnabled ? 'hero-enter-item' : ''].filter(Boolean).join(' ')}>
                  {greetingBase}
                  {displayName ? (
                    <span className="display-hero-name">, {displayName}</span>
                  ) : null}
                </h1>
                <p className={['display-hero-date', heroEntranceEnabled ? 'hero-enter-item' : ''].filter(Boolean).join(' ')}>
                  {dateLine}
                </p>
                <p className={['display-hero-meta', heroEntranceEnabled ? 'hero-enter-item' : ''].filter(Boolean).join(' ')}>
                  {weekday} · {year}
                </p>
                <HeroWeeklyScore
                  snapshot={weeklyScore}
                  loading={weeklyScoreLoading}
                  enterClassName={heroEntranceEnabled ? 'hero-enter-item' : ''}
                />
              </div>
              <HeroSolarInstrument
                motionEnabled={motionEnabled}
                enterClassName={heroEntranceEnabled ? 'hero-enter-item' : ''}
              />
            </div>
            <DashboardCaptureBar
              enterClassName={heroEntranceEnabled ? 'hero-enter-item' : ''}
              onModuleLogged={handleCaptureLogged}
            />
          </div>
        </div>
      </section>

      <section className="moss-atrium" aria-labelledby="moss-atrium-heading">
        <header className="moss-section-anchor">
          <h2 id="moss-atrium-heading" className="moss-section-anchor-title">
            Today
          </h2>
          <p className="moss-section-anchor-meta">
            {enabledModules.length} module{enabledModules.length === 1 ? '' : 's'}
          </p>
        </header>

        <div
          className={[
            'moss-door-grid',
            !showInfoColumn ? 'moss-door-grid--full-main' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="Modules"
        >
          <div className="moss-door-grid-main">
            {featured &&
              (featured.id === 'calendar' && modules.calendar.enabled ? (
                <DashboardCalendarDoor
                  item={featured}
                  snapshot={calendarSnapshot}
                  loading={calendarSnapshotLoading}
                  motionIndex={0}
                  entranceEnabled={doorEntranceEnabled}
                />
              ) : (
                <ModuleDoorLink
                  item={featured}
                  variant="featured"
                  motionIndex={0}
                  entranceEnabled={doorEntranceEnabled}
                />
              ))}
            {newsConfig.enabled && <DashboardNewsCard config={newsConfig} />}
            {secondary.length > 0 && (
              <div className="moss-door-row-secondary">
                {secondary.map((item, index) => (
                  <ModuleDoorLink
                    key={item.id}
                    item={item}
                    variant="secondary"
                    motionIndex={index + 2}
                    entranceEnabled={doorEntranceEnabled}
                  />
                ))}
              </div>
            )}
          </div>

          {showInfoColumn && (
            <div className="moss-door-grid-info">
              {showMoneyDoor && accent && (
                <DashboardMoneyDoor
                  item={accent}
                  snapshot={moneySnapshot}
                  loading={moneySnapshotLoading}
                  motionIndex={2}
                  entranceEnabled={doorEntranceEnabled}
                />
              )}
              {showNutritionDoor && (
                <DashboardNutritionDoor
                  item={enabledModules.find((item) => item.id === 'nutrition')!}
                  snapshot={nutritionSnapshot}
                  loading={nutritionSnapshotLoading}
                  motionIndex={3}
                  entranceEnabled={doorEntranceEnabled}
                />
              )}
              {showInboxDoor && (
                <DashboardInboxDoor
                  item={enabledModules.find((item) => item.id === 'inbox')!}
                  snapshot={inboxSnapshot}
                  loading={inboxSnapshotLoading}
                  motionIndex={4}
                  entranceEnabled={doorEntranceEnabled}
                />
              )}
              {showNotesDoor && (
                <DashboardNotesDoor
                  item={enabledModules.find((item) => item.id === 'notes')!}
                  snapshot={notesSnapshot}
                  loading={notesSnapshotLoading}
                  motionIndex={5}
                  entranceEnabled={doorEntranceEnabled}
                />
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function formatDateParts(): { weekday: string; dateLine: string; year: string } {
  const now = new Date()
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now),
    dateLine: new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(now),
    year: new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(now)
  }
}
