import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarGoogleStatus } from '@shared/calendar'
import { DEFAULT_GOALS } from '@shared/nutrition'
import {
  ACCENT_PALETTES,
  getGreetingBase,
  getGreetingPhase,
  SETUP_MANAGER_VERSION,
  mergePreferences,
  type AccentPalette,
  type ColorMode,
  type ModulePreferences
} from '@shared/preferences'
import { usePreferences } from '../context/PreferencesProvider'
import { useProfile } from '../context/ProfileProvider'
import {
  NewsSourcesEditor,
  type NewsSourcesEditorHandle
} from '../components/NewsSourcesEditor'
import { MossBrandLockup } from '../components/MossBrandLockup'

const WIZARD_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
type WizardStep = (typeof WIZARD_STEPS)[number]

// Step map: 1 Welcome · 2 Name · 3 Look · 4 Accent · 5 Modules ·
// 6 Calendar · 7 Nutrition · 8 News · 9 Finish. Password lives in Settings.
const STEP_MODULES = 5
const STEP_CALENDAR = 6
const STEP_NUTRITION = 7
const STEP_NEWS = 8
const STEP_FINISH = 9
const SETUP_STEP_STORAGE_KEY = 'moss.setup.step'

function readSavedSetupStep(): WizardStep | null {
  try {
    const raw = sessionStorage.getItem(SETUP_STEP_STORAGE_KEY)
    if (!raw) return null
    const n = Number(raw)
    return WIZARD_STEPS.includes(n as WizardStep) ? (n as WizardStep) : null
  } catch {
    return null
  }
}

const MODES: Array<{ value: ColorMode; label: string; copy: string }> = [
  { value: 'light', label: 'Light', copy: 'Warm paper, daylight' },
  { value: 'dark', label: 'Dark', copy: 'Green-glow evening' },
  { value: 'auto', label: 'Auto', copy: 'Follows your system' }
]

const ACCENTS: Array<{ value: AccentPalette; label: string; copy: string; hue: number }> = (
  Object.keys(ACCENT_PALETTES) as AccentPalette[]
).map((value) => ({
  value,
  label: ACCENT_PALETTES[value].label,
  copy: ACCENT_PALETTES[value].description,
  hue: ACCENT_PALETTES[value].hue
}))

const MODULE_ROWS: Array<{
  id: keyof Pick<ModulePreferences, 'calendar' | 'money' | 'nutrition' | 'news' | 'inbox' | 'notes'>
  label: string
  copy: string
}> = [
  {
    id: 'calendar',
    label: 'Calendar',
    copy: 'Classes, work shifts, and family plans on your dashboard.'
  },
  {
    id: 'money',
    label: 'Financials',
    copy: 'Give every dollar a job — paycheck in, bills out, no spreadsheet.'
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    copy: 'Log meals and watch your daily fuel without calorie guilt.'
  },
  {
    id: 'news',
    label: 'News',
    copy: 'Headlines on your dashboard; full list in the News reader.'
  },
  {
    id: 'inbox',
    label: 'Inbox',
    copy: 'Mail triage — still warming up. You can turn this off for now.'
  },
  {
    id: 'notes',
    label: 'Notes',
    copy: 'Your own lists and checklists — separate from Inbox mail.'
  }
]

function activeWizardSteps(modules: ModulePreferences): WizardStep[] {
  const steps: WizardStep[] = [1, 2, 3, 4, STEP_MODULES]
  if (modules.calendar.enabled) steps.push(STEP_CALENDAR)
  if (modules.nutrition.enabled) steps.push(STEP_NUTRITION)
  if (modules.news.enabled) steps.push(STEP_NEWS)
  steps.push(STEP_FINISH)
  return steps
}

function stepIndex(steps: WizardStep[], step: WizardStep): number {
  return steps.indexOf(step) + 1
}

/** B1/B3 — Setup Manager: identity (name/look/accent/password) + module pick + light per-module config. */
export function SetupWizard(): React.JSX.Element {
  const navigate = useNavigate()
  const { preferences, setPreferences, hydratePreferences, prepareProfileHydration } = usePreferences()
  const { createProfile, activate, activeProfile, databasePath, refreshProfiles } = useProfile()
  const [step, setStep] = useState<WizardStep>(() => readSavedSetupStep() ?? 1)

  const name = preferences.profile.displayName
  const greeting = getGreetingBase(getGreetingPhase())
  const modules = preferences.modules

  const steps = useMemo(() => activeWizardSteps(modules), [modules])
  const totalSteps = steps.length
  const currentIndex = stepIndex(steps, step)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [googleStatus, setGoogleStatus] = useState<CalendarGoogleStatus | null>(null)
  const [calendarNote, setCalendarNote] = useState<string | null>(null)
  const [showCalendarAdvanced, setShowCalendarAdvanced] = useState(false)
  const [calendarUrl, setCalendarUrl] = useState('')

  const [calorieTarget, setCalorieTarget] = useState(DEFAULT_GOALS.calorieTarget)
  const [calorieUnknown, setCalorieUnknown] = useState(false)
  const [nutritionNote, setNutritionNote] = useState<string | null>(null)
  const [newsNote, setNewsNote] = useState<string | null>(null)
  const newsEditorRef = useRef<NewsSourcesEditorHandle>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(SETUP_STEP_STORAGE_KEY, String(step))
    } catch {
      // sessionStorage unavailable — step still lives in React state
    }
  }, [step])

  useEffect(() => {
    if (step !== STEP_CALENDAR || !window.moss?.calendar) return
    void window.moss.calendar.getGoogleStatus().then(setGoogleStatus).catch(() => null)
  }, [step])

  useEffect(() => {
    if (!steps.includes(step)) {
      setStep(steps[steps.length - 1] ?? 1)
    }
  }, [step, steps])

  /** Module setup steps write to SQLite — ensure a profile DB exists first. */
  const ensureSetupProfile = useCallback(async (): Promise<string> => {
    if (activeProfile?.id && databasePath) {
      return activeProfile.id
    }

    const displayName = name.trim() || 'New profile'
    const created = await createProfile(displayName)
    prepareProfileHydration(created.profile.id)
    const activated = await activate(created.profile.id)
    if (!activated.ok) {
      throw new Error(activated.message)
    }

    hydratePreferences(preferences, created.profile.id)
    return created.profile.id
  }, [
    activate,
    activeProfile?.id,
    createProfile,
    databasePath,
    hydratePreferences,
    name,
    preferences,
    prepareProfileHydration
  ])

  const googleReady = googleStatus?.configured ?? false
  const isModuleConfigStep = step >= STEP_CALENDAR && step <= STEP_NEWS
  const showSkipSetup = step >= 2 && step <= STEP_MODULES && name.trim().length > 0

  const finishSetup = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const displayName = name.trim() || 'New profile'
      let profileId = activeProfile?.id

      if (!profileId) {
        profileId = await ensureSetupProfile()
      } else {
        await window.moss.profiles.update(profileId, { displayName })
        await refreshProfiles()
      }

      const nextPrefs = mergePreferences(preferences, {
        profile: { displayName },
        setup: { completedAt: new Date().toISOString(), version: SETUP_MANAGER_VERSION }
      })
      hydratePreferences(nextPrefs, profileId)
      try {
        sessionStorage.removeItem(SETUP_STEP_STORAGE_KEY)
      } catch {
        // ignore
      }
      void navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup')
    } finally {
      setBusy(false)
    }
  }, [
    activeProfile?.id,
    ensureSetupProfile,
    hydratePreferences,
    name,
    navigate,
    preferences,
    refreshProfiles
  ])

  const goNext = useCallback((): void => {
    const idx = steps.indexOf(step)
    if (idx < 0 || idx >= steps.length - 1) return
    setStep(steps[idx + 1]!)
  }, [step, steps])

  const goBack = useCallback((): void => {
    const idx = steps.indexOf(step)
    if (idx > 0) setStep(steps[idx - 1]!)
  }, [step, steps])

  const skipStep = useCallback((): void => {
    if (isModuleConfigStep) {
      goNext()
      return
    }
    if (step >= 2 && name.trim()) {
      void finishSetup()
    }
  }, [finishSetup, goNext, isModuleConfigStep, name, step])

  function patchModules(patch: Partial<ModulePreferences>): void {
    setPreferences({ modules: patch })
  }

  async function runTask(task: () => Promise<void>, needsProfile = true): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      if (needsProfile) {
        await ensureSetupProfile()
      }
      await task()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleCalendarGoogle(): Promise<void> {
    if (!window.moss?.calendar) return
    const ok = await runTask(async () => {
      if (googleStatus?.configured) {
        const result = await window.moss.calendar.connectGoogle('Google Calendar')
        setCalendarNote(`Google Calendar — ${result.imported} new, ${result.updated} updated`)
      } else {
        setCalendarNote('Google sign-in needs a one-time admin setup in Settings later.')
      }
    })
    if (ok) goNext()
  }

  async function handleCalendarFile(): Promise<void> {
    if (!window.moss?.calendar) return
    const ok = await runTask(async () => {
      const result = await window.moss.calendar.importIcsFile()
      setCalendarNote(`${result.label ?? 'Calendar file'} — ${result.imported ?? 0} events imported`)
    })
    if (ok) goNext()
  }

  async function handleCalendarUrl(): Promise<void> {
    if (!window.moss?.calendar || !calendarUrl.trim()) return
    const ok = await runTask(async () => {
      const result = await window.moss.calendar.importIcsUrl(calendarUrl.trim(), 'Calendar')
      setCalendarNote(`Calendar link — ${result.imported} imported`)
      setCalendarUrl('')
      setShowCalendarAdvanced(false)
    })
    if (ok) goNext()
  }

  async function handleNutritionSave(): Promise<void> {
    if (!window.moss?.nutrition) {
      goNext()
      return
    }
    const target = calorieUnknown ? DEFAULT_GOALS.calorieTarget : calorieTarget
    const ok = await runTask(async () => {
      const current = await window.moss.nutrition.getGoals()
      await window.moss.nutrition.setGoals({
        calorieTarget: target,
        proteinG: current.proteinG,
        carbsG: current.carbsG,
        fatG: current.fatG
      })
      setNutritionNote(`${target.toLocaleString()} kcal daily target`)
    })
    if (ok) goNext()
  }

  async function handleNewsSave(): Promise<void> {
    if (!window.moss?.news) {
      goNext()
      return
    }
    const validationError = newsEditorRef.current?.validate()
    if (validationError) {
      setNewsNote(validationError)
      return
    }
    const feeds = newsEditorRef.current?.collectFeeds() ?? []
    if (feeds.length === 0) {
      setNewsNote('Skipped — tune sources anytime in Settings.')
      goNext()
      return
    }
    const ok = await runTask(async () => {
      for (const feed of feeds) {
        await window.moss.news.addSource({
          url: feed.url,
          title: feed.title,
          category: feed.category
        })
      }
      setNewsNote(
        `${feeds.length} source${feeds.length > 1 ? 's' : ''} added — syncing in background`
      )
      void window.moss.news.syncAll().catch(() => undefined)
    })
    if (ok) goNext()
  }

  function summaryModules(): string {
    return (
      MODULE_ROWS.filter((row) => modules[row.id].enabled)
        .map((row) => row.label)
        .join(', ') || 'Dashboard only'
    )
  }

  return (
    <div className="moss-setup" data-color-mode-host>
      <span className="moss-setup-glow" aria-hidden />

      <div className="moss-setup-card">
        <header className="moss-setup-head">
          <div className="moss-setup-lockup">
            <MossBrandLockup />
          </div>
          <div
            className="moss-setup-progress"
            aria-label={`Step ${currentIndex} of ${totalSteps}`}
          >
            {steps.map((s) => (
              <span
                key={s}
                className={[
                  'moss-setup-dot',
                  steps.indexOf(s) <= steps.indexOf(step) ? 'moss-setup-dot--on' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
            <span className="moss-setup-step-label nutrition-mono">
              {String(currentIndex).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
            </span>
          </div>
        </header>

        <div className="moss-setup-body">
          {step === 1 && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Welcome</p>
              <h1 className="moss-setup-title">A calm corner for your day.</h1>
              <p className="moss-setup-copy">
                MOSS keeps your schedule, financials, nutrition, and the news sources you trust in
                one warm place — local to your computer, yours alone. A few quick choices and
                you&apos;re in.
              </p>
            </section>
          )}

          {step === 2 && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">About you</p>
              <h1 className="moss-setup-title">What should we call you?</h1>
              <input
                className="moss-setup-input"
                type="text"
                value={name}
                maxLength={64}
                autoFocus
                placeholder="Your name"
                onChange={(e) => setPreferences({ profile: { displayName: e.target.value } })}
              />
              <p className="moss-setup-preview display-hero">
                {greeting}
                {name.trim() ? <span className="display-hero-name">, {name.trim()}</span> : null}
              </p>
              <p className="moss-setup-note">
                No password required to start. You can lock this profile anytime in{' '}
                <strong>Settings → You</strong> — you&apos;ll get a recovery phrase to save offline.
              </p>
            </section>
          )}

          {step === 3 && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Look &amp; feel</p>
              <h1 className="moss-setup-title">Pick your light.</h1>
              <div className="moss-setup-modes">
                {MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    className={[
                      'moss-setup-mode',
                      `moss-setup-mode--${mode.value}`,
                      preferences.colorMode === mode.value ? 'moss-setup-mode--on' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setPreferences({ colorMode: mode.value })}
                  >
                    <span className="moss-setup-mode-swatch" aria-hidden />
                    <span className="moss-setup-mode-label">{mode.label}</span>
                    <span className="moss-setup-mode-copy">{mode.copy}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Accent</p>
              <h1 className="moss-setup-title">Choose your climate.</h1>
              <p className="moss-setup-copy">
                One accent threads through your whole dashboard — hero, doors, and settings.
                Change it anytime.
              </p>
              <div className="moss-setup-modes">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.value}
                    type="button"
                    className={[
                      'moss-setup-mode',
                      preferences.accentPalette === accent.value ? 'moss-setup-mode--on' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setPreferences({ accentPalette: accent.value })}
                  >
                    <span
                      className="moss-setup-mode-swatch"
                      style={{ background: `oklch(0.68 0.15 ${accent.hue})` }}
                      aria-hidden
                    />
                    <span className="moss-setup-mode-label">{accent.label}</span>
                    <span className="moss-setup-mode-copy">{accent.copy}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === STEP_MODULES && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Modules</p>
              <h1 className="moss-setup-title">What lives on your dashboard?</h1>
              <p className="moss-setup-copy">
                Turn pieces on or off — you can always change this in Settings.
              </p>
              <ul className="moss-setup-checklist">
                {MODULE_ROWS.map((row) => (
                  <li key={row.id}>
                    <label className="moss-setup-check">
                      <input
                        type="checkbox"
                        checked={modules[row.id].enabled}
                        onChange={(e) =>
                          patchModules({
                            [row.id]:
                              row.id === 'money'
                                ? { ...modules.money, enabled: e.target.checked }
                                : row.id === 'news'
                                  ? { ...modules.news, enabled: e.target.checked }
                                  : { enabled: e.target.checked }
                          })
                        }
                      />
                      <span className="moss-setup-check-body">
                        <span className="moss-setup-check-label">{row.label}</span>
                        <span className="moss-setup-check-copy">{row.copy}</span>
                      </span>
                    </label>
                    {row.id === 'money' && modules.money.enabled && (
                      <label className="moss-setup-check moss-setup-check--nested">
                        <input
                          type="checkbox"
                          checked={modules.money.investmentsEnabled}
                          onChange={(e) =>
                            patchModules({
                              money: { ...modules.money, investmentsEnabled: e.target.checked }
                            })
                          }
                        />
                        <span className="moss-setup-check-body">
                          <span className="moss-setup-check-label">Track investments too</span>
                          <span className="moss-setup-check-copy">
                            Optional 401k / brokerage balance snapshots, alongside your budget.
                          </span>
                        </span>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              <p className="moss-setup-note">
                Profile password is optional — add or change it anytime in{' '}
                <strong>Settings → You</strong>.
              </p>
            </section>
          )}

          {step === STEP_CALENDAR && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Calendar</p>
              <h1 className="moss-setup-title">Bring your schedule along.</h1>
              <p className="moss-setup-copy">
                Pick one path — school, work, or family calendar. You can add more later in Settings.
              </p>
              <label className="moss-setup-academics-toggle">
                <input
                  type="checkbox"
                  checked={modules.calendar.academicsEnabled}
                  onChange={(event) =>
                    patchModules({
                      calendar: { ...modules.calendar, academicsEnabled: event.target.checked }
                    })
                  }
                />
                <span>
                  I&apos;m a student — add classes, exams, and assignments
                  <span className="moss-setup-hint"> (you can change this later in Settings)</span>
                </span>
              </label>
              <div className="moss-setup-paths">
                <button
                  type="button"
                  className="moss-setup-path"
                  disabled={busy || !window.moss?.calendar}
                  onClick={() => void handleCalendarGoogle()}
                >
                  <span className="moss-setup-path-label">Sign in with Google</span>
                  <span className="moss-setup-path-copy">
                    {googleReady
                      ? 'Opens a sign-in window inside MOSS.'
                      : 'Needs one-time admin setup — or use a file below.'}
                  </span>
                </button>
                <button
                  type="button"
                  className="moss-setup-path"
                  disabled={busy || !window.moss?.calendar}
                  onClick={() => void handleCalendarFile()}
                >
                  <span className="moss-setup-path-label">Import a calendar file</span>
                  <span className="moss-setup-path-copy">
                    Pick a .ics export from Google, Apple, or school.
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="moss-setup-link"
                onClick={() => setShowCalendarAdvanced((open) => !open)}
              >
                {showCalendarAdvanced ? 'Hide advanced' : 'Advanced — paste a calendar link'}
              </button>
              {showCalendarAdvanced && (
                <form
                  className="moss-setup-advanced"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleCalendarUrl()
                  }}
                >
                  <input
                    type="url"
                    className="moss-setup-input"
                    placeholder="https://…/calendar.ics"
                    value={calendarUrl}
                    onChange={(e) => setCalendarUrl(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="submit"
                    className="moss-setup-btn moss-setup-btn--primary moss-setup-btn--compact"
                    disabled={busy || !calendarUrl.trim()}
                  >
                    Import link
                  </button>
                </form>
              )}
              {calendarNote && <p className="moss-setup-flash">{calendarNote}</p>}
            </section>
          )}

          {step === STEP_NUTRITION && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Nutrition</p>
              <h1 className="moss-setup-title">Daily fuel target.</h1>
              <p className="moss-setup-copy">
                A gentle calorie budget for your dashboard door — adjust anytime. Common foods
                import automatically in the background.
              </p>
              <label className="moss-setup-check moss-setup-check--solo">
                <input
                  type="checkbox"
                  checked={calorieUnknown}
                  onChange={(e) => {
                    setCalorieUnknown(e.target.checked)
                    if (e.target.checked) setCalorieTarget(DEFAULT_GOALS.calorieTarget)
                  }}
                />
                <span className="moss-setup-check-body">
                  <span className="moss-setup-check-label">I don&apos;t know — use 2,000</span>
                </span>
              </label>
              {!calorieUnknown && (
                <div className="moss-setup-slider-wrap">
                  <input
                    type="range"
                    className="moss-setup-slider"
                    min={1200}
                    max={3500}
                    step={50}
                    value={calorieTarget}
                    onChange={(e) => setCalorieTarget(Number(e.target.value))}
                    disabled={busy}
                  />
                  <p className="moss-setup-slider-value nutrition-mono">
                    {calorieTarget.toLocaleString()} kcal / day
                  </p>
                </div>
              )}
              {nutritionNote && <p className="moss-setup-flash">{nutritionNote}</p>}
            </section>
          )}

          {step === STEP_NEWS && (
            <section className="moss-setup-step moss-setup-step--news">
              <p className="moss-setup-kicker nutrition-mono">News</p>
              <h1 className="moss-setup-title">What news do you like?</h1>
              <p className="moss-setup-copy">
                Pick topics and trusted outlets — headlines land on your dashboard widget. Tune
                anytime in Settings.
              </p>

              <NewsSourcesEditor
                ref={newsEditorRef}
                variant="setup"
                idPrefix="setup"
                disabled={busy}
              />
              {newsNote && <p className="moss-setup-flash">{newsNote}</p>}
            </section>
          )}

          {step === STEP_FINISH && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Finish</p>
              <h1 className="moss-setup-title">
                {name.trim() ? `You're set, ${name.trim()}.` : "You're set."}
              </h1>
              <p className="moss-setup-copy">
                Here&apos;s what we wired up — your dashboard awaits. Want a profile password? You can
                add one anytime in Settings → You.
              </p>
              <ul className="moss-setup-summary">
                <li>
                  <span className="moss-setup-summary-label">Look</span>
                  <span className="moss-setup-summary-value">
                    {MODES.find((m) => m.value === preferences.colorMode)?.label ?? 'Light'} ·{' '}
                    {ACCENT_PALETTES[preferences.accentPalette].label}
                  </span>
                </li>
                <li>
                  <span className="moss-setup-summary-label">Modules</span>
                  <span className="moss-setup-summary-value">{summaryModules()}</span>
                </li>
                <li>
                  <span className="moss-setup-summary-label">Password</span>
                  <span className="moss-setup-summary-value">Optional — Settings → You</span>
                </li>
                {modules.calendar.enabled && (
                  <li>
                    <span className="moss-setup-summary-label">Calendar</span>
                    <span className="moss-setup-summary-value">
                      {calendarNote ?? 'Add anytime in Settings'}
                    </span>
                  </li>
                )}
                {modules.money.enabled && (
                  <li>
                    <span className="moss-setup-summary-label">Financials</span>
                    <span className="moss-setup-summary-value">Ready on your dashboard</span>
                  </li>
                )}
                {modules.nutrition.enabled && (
                  <li>
                    <span className="moss-setup-summary-label">Nutrition</span>
                    <span className="moss-setup-summary-value">
                      {nutritionNote ??
                        `${(calorieUnknown ? DEFAULT_GOALS.calorieTarget : calorieTarget).toLocaleString()} kcal target`}
                    </span>
                  </li>
                )}
                {modules.news.enabled && (
                  <li>
                    <span className="moss-setup-summary-label">News</span>
                    <span className="moss-setup-summary-value">
                      {newsNote ?? 'Pick sources anytime in Settings'}
                    </span>
                  </li>
                )}
              </ul>
            </section>
          )}

          {error && (
            <p className="moss-setup-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="moss-setup-foot">
          {currentIndex > 1 ? (
            <button
              type="button"
              className="moss-setup-btn moss-setup-btn--ghost"
              onClick={goBack}
              disabled={busy}
            >
              Back
            </button>
          ) : (
            <span className="moss-setup-foot-spacer" aria-hidden />
          )}

          <div className="moss-setup-foot-actions">
            {(showSkipSetup || isModuleConfigStep) && (
              <button
                type="button"
                className="moss-setup-btn moss-setup-btn--ghost"
                onClick={skipStep}
                disabled={busy || (step === 2 && !name.trim())}
              >
                {isModuleConfigStep ? 'Skip for now' : 'Skip setup'}
              </button>
            )}
            <button
              type="button"
              className="moss-setup-btn moss-setup-btn--primary"
              disabled={busy || (step === 2 && !name.trim())}
              onClick={() => {
                if (step === STEP_NUTRITION) void handleNutritionSave()
                else if (step === STEP_NEWS) void handleNewsSave()
                else if (step === STEP_FINISH) void finishSetup()
                else goNext()
              }}
            >
              {busy
                ? 'Working…'
                : step === STEP_FINISH
                  ? 'Open MOSS'
                  : isModuleConfigStep
                    ? 'Continue'
                    : 'Next'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
