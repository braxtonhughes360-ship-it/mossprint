import '../SetupWizard.css'
import '../ShellPlaceholderPage.css'
import '../InboxPage.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarGoogleStatus } from '@shared/calendar'
import type { LocalAiDownloadState, LocalAiPanelState } from '@shared/localai'
import type { MossAppSettings } from '@shared/appSettings'
import { DEFAULT_APP_SETTINGS } from '@shared/appSettings'
import { STARTER_ENVELOPES } from '@shared/money'
import { DEFAULT_GOALS } from '@shared/nutrition'
import {
  ACCENT_PALETTES,
  DENSITY_PRESETS,
  getGreetingBase,
  getGreetingPhase,
  SETUP_MANAGER_VERSION,
  mergePreferences,
  type AccentPalette,
  type AmbientIntensity,
  type ColorMode,
  type InterfaceDensity,
  type ModulePreferences,
  type MotionIntensity
} from '@shared/preferences'
import { usePreferences } from '../context/PreferencesProvider'
import { useProfile } from '../context/ProfileProvider'
import {
  NewsSourcesEditor,
  type NewsSourcesEditorHandle
} from '../components/NewsSourcesEditor'
import { LocalAiConsentCard } from '../components/LocalAiConsentCard'
import { MailAccountsPanel } from '../components/MailAccountsPanel'
import { MossBrandLockup } from '../components/MossBrandLockup'

const WIZARD_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const
type WizardStep = (typeof WIZARD_STEPS)[number]

// Step map: 1 Welcome · 2 Name · 3 Look · 4 Accent · 5 How you like it ·
// 6 Modules · 7 Smart parsing · 8 Financials · 9 Calendar · 10 Inbox ·
// 11 Nutrition · 12 News · 13 Finish. Password lives in Settings.
const STEP_PREFS = 5
const STEP_MODULES = 6
const STEP_SMART = 7
const STEP_MONEY = 8
const STEP_CALENDAR = 9
const STEP_INBOX = 10
const STEP_NUTRITION = 11
const STEP_NEWS = 12
const STEP_FINISH = 13
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
    copy: 'Read, reply, and send from your dashboard — optional if you prefer your mail app.'
  },
  {
    id: 'notes',
    label: 'Notes',
    copy: 'Your own lists and checklists — separate from Inbox mail.'
  }
]

const MOTION_OPTIONS: Array<{ value: MotionIntensity; label: string; copy: string }> = [
  { value: 'full', label: 'Full', copy: 'Little touches of life — transitions glide, the shell breathes.' },
  { value: 'reduced', label: 'Reduced', copy: 'Calmer — keeps the layout, drops the ambient movement.' },
  { value: 'off', label: 'Off', copy: 'Completely still.' }
]

const PRESENCE_OPTIONS: Array<{ value: AmbientIntensity; label: string; copy: string }> = [
  { value: 'off', label: 'Off', copy: 'Flat and quiet — no background glow.' },
  { value: 'low', label: 'Low', copy: 'A faint warm cradle behind things.' },
  { value: 'standard', label: 'Standard', copy: 'The full ambient feel across the shell.' }
]

const SCALE_OPTIONS: Array<{ value: InterfaceDensity; label: string; copy: string }> = (
  Object.keys(DENSITY_PRESETS) as InterfaceDensity[]
).map((value) => ({
  value,
  label: DENSITY_PRESETS[value].label,
  copy: DENSITY_PRESETS[value].description
}))

/** One "how you like it" choice row — chips + the selected option's plain-words line. */
function PrefChipRow<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; copy: string }>
  onChange: (value: T) => void
}): React.JSX.Element {
  const selected = options.find((option) => option.value === value)
  return (
    <div className="moss-setup-news-block">
      <p className="moss-setup-news-label">{label}</p>
      <div className="moss-setup-topic-row" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={[
              'moss-setup-topic-chip',
              value === option.value ? 'moss-setup-topic-chip--on' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {selected && <p className="moss-setup-hint">{selected.copy}</p>}
    </div>
  )
}

function activeWizardSteps(modules: ModulePreferences): WizardStep[] {
  // Smart parsing is machine-wide (not module-gated); everything after it is
  // gated on its module so the wizard still completes with all modules off.
  const steps: WizardStep[] = [1, 2, 3, 4, STEP_PREFS, STEP_MODULES, STEP_SMART]
  if (modules.money.enabled) steps.push(STEP_MONEY)
  if (modules.calendar.enabled) steps.push(STEP_CALENDAR)
  if (modules.inbox.enabled) steps.push(STEP_INBOX)
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

  const [aiState, setAiState] = useState<LocalAiPanelState | null>(null)
  const [appSettings, setAppSettings] = useState<MossAppSettings>(DEFAULT_APP_SETTINGS)
  const [inboxReady, setInboxReady] = useState(false)
  const [envelopeName, setEnvelopeName] = useState('')
  const [addedEnvelopes, setAddedEnvelopes] = useState<string[]>([])
  const [moneyNote, setMoneyNote] = useState<string | null>(null)

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

  const refreshAi = useCallback(async (): Promise<void> => {
    if (!window.moss?.localai) return
    try {
      setAiState(await window.moss.localai.getState())
    } catch {
      setAiState(null)
    }
  }, [])

  useEffect(() => {
    if (step === STEP_SMART || step === STEP_FINISH) void refreshAi()
  }, [step, refreshAi])

  // Keep the download slice live while the wizard is open (accept → background download).
  useEffect(() => {
    if (!window.moss?.localai) return
    const unsubscribe = window.moss.localai.onDownloadProgress((raw) => {
      const download = raw as LocalAiDownloadState
      setAiState((prev) => (prev ? { ...prev, runtime: { ...prev.runtime, download } } : prev))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (step !== STEP_PREFS || !window.moss?.shell?.getAppSettings) return
    void window.moss.shell.getAppSettings().then(setAppSettings).catch(() => undefined)
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

  // Mail IPC needs a live profile DB — make sure one exists before the panel loads.
  useEffect(() => {
    if (step !== STEP_INBOX || inboxReady) return
    void ensureSetupProfile()
      .then(() => setInboxReady(true))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not prepare your profile')
      )
  }, [step, inboxReady, ensureSetupProfile])

  // Finish shows the real data-file path — create the profile a moment early.
  useEffect(() => {
    if (step !== STEP_FINISH || databasePath) return
    void ensureSetupProfile().catch(() => undefined)
  }, [step, databasePath, ensureSetupProfile])

  const googleReady = googleStatus?.configured ?? false
  const isModuleConfigStep = step >= STEP_SMART && step <= STEP_NEWS
  const showSkipSetup = step >= 2 && step <= STEP_MODULES && name.trim().length > 0

  const finishSetup = useCallback(async (destination = '/'): Promise<void> => {
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
      void navigate(destination, { replace: true })
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

  /** Accept the helper download and move on — it continues in the background (Settings shows progress). */
  async function handleAiAccept(): Promise<void> {
    if (!window.moss?.localai) {
      goNext()
      return
    }
    try {
      await window.moss.localai.setModelConsent('accepted')
    } catch {
      // Consent stays pending — Settings re-offers; setup is never hostage.
    }
    goNext()
  }

  async function handleAiLater(): Promise<void> {
    try {
      await window.moss?.localai?.setModelConsent('later')
    } catch {
      // Same story: pending consent re-offers in Settings.
    }
    goNext()
  }

  async function handleAiRetry(): Promise<void> {
    try {
      await window.moss?.localai?.startModelDownload()
      await refreshAi()
    } catch {
      // The download state carries its own error copy.
    }
  }

  async function handleEnvelopeAdd(name?: string, kind: 'bill' | 'everyday' = 'everyday'): Promise<void> {
    const trimmed = (name ?? envelopeName).trim()
    if (!trimmed || !window.moss?.money) return
    if (addedEnvelopes.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      setMoneyNote(`“${trimmed}” is already on your list.`)
      return
    }
    await runTask(async () => {
      await window.moss.money.createCategory({
        name: trimmed,
        countsTowardSafeToSpend: kind === 'everyday'
      })
      setAddedEnvelopes((prev) => [...prev, trimmed])
      setMoneyNote(null)
      setEnvelopeName('')
    })
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

  const aiRuntime = aiState?.runtime
  const aiDownload = aiRuntime?.download
  const aiBundled = aiRuntime?.bundledAvailable === true
  const aiReady = aiBundled && aiDownload?.status === 'ready'
  const aiDownloading =
    aiDownload?.status === 'downloading' || aiDownload?.status === 'verifying'
  const aiSummary = aiReady
    ? 'On — runs on this computer'
    : aiDownloading
      ? 'Downloading in the background — check Settings'
      : 'Anytime in Settings'

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
                MOSS keeps your schedule, money, meals, and news in one warm place — local to
                your computer, yours alone. A few quick choices and you&apos;re in.
              </p>
            </section>
          )}

          {step === 2 && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">You</p>
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
              <p className="moss-setup-kicker nutrition-mono">Theme</p>
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

          {step === STEP_PREFS && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Feel</p>
              <h1 className="moss-setup-title">Make it feel right.</h1>
              <p className="moss-setup-copy">
                Everything here applies as you tap it, so you can see what you&apos;re choosing —
                and re-tune it anytime in Settings → Look.
              </p>
              <PrefChipRow
                label="Motion"
                value={preferences.motionIntensity}
                options={MOTION_OPTIONS}
                onChange={(value) => setPreferences({ motionIntensity: value })}
              />
              <PrefChipRow
                label="Presence"
                value={preferences.ambientIntensity}
                options={PRESENCE_OPTIONS}
                onChange={(value) => setPreferences({ ambientIntensity: value })}
              />
              <PrefChipRow
                label="Scale"
                value={preferences.density}
                options={SCALE_OPTIONS}
                onChange={(value) => setPreferences({ density: value })}
              />
              <label className="moss-setup-check moss-setup-check--solo">
                <input
                  type="checkbox"
                  checked={appSettings.keepInMenuBar}
                  onChange={(event) => {
                    const keepInMenuBar = event.target.checked
                    setAppSettings((current) => ({ ...current, keepInMenuBar }))
                    void window.moss?.shell
                      ?.setAppSettings({ keepInMenuBar })
                      .then(setAppSettings)
                      .catch(() => undefined)
                  }}
                />
                <span className="moss-setup-check-body">
                  <span className="moss-setup-check-label">Keep MOSS in the menu bar</span>
                  <span className="moss-setup-check-copy">
                    When this is on, closing the window keeps MOSS running in your menu bar so
                    quick capture stays one click away. When it&apos;s off, closing the window
                    quits MOSS.
                  </span>
                </span>
              </label>
            </section>
          )}

          {step === STEP_MODULES && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Dashboard</p>
              <h1 className="moss-setup-title">What lives on your dashboard?</h1>
              <p className="moss-setup-copy">
                Turn pieces on or off — change anytime in Settings. Notes is ready the moment you
                open it: lists, plans, half-formed thoughts.
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

          {step === STEP_SMART && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Smart parsing</p>
              <h1 className="moss-setup-title">Plain English, on your computer</h1>
              <p className="moss-setup-copy">
                MOSS can turn plain English into transactions, meals, and events — all on this
                computer, nothing sent anywhere.
              </p>
              {aiState && aiBundled && aiReady && (
                <p className="moss-setup-flash" role="status">
                  Smart parsing is on — runs on this computer.
                </p>
              )}
              {aiState && aiBundled && !aiReady && (
                <div className="moss-setup-consent">
                  <LocalAiConsentCard
                    download={aiDownload}
                    onAccept={() => void handleAiAccept()}
                    onLater={() => void handleAiLater()}
                    onRetry={() => void handleAiRetry()}
                    offerHint="Keep setting up — the download runs in the background."
                  />
                </div>
              )}
              {aiState && !aiBundled && (
                <p className="moss-setup-note">
                  Basic parsing works everywhere. Turn on smart parsing anytime in Settings.
                </p>
              )}
              {!aiState && (
                <p className="moss-setup-note" role="status">
                  Checking…
                </p>
              )}
              <p className="moss-setup-trust">
                Everything Describe reads and writes stays on this computer.
              </p>
            </section>
          )}

          {step === STEP_MONEY && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Financials</p>
              <h1 className="moss-setup-title">Give every dollar a job.</h1>
              <p className="moss-setup-copy">
                When you get paid, picture splitting the cash into a few labeled envelopes — rent,
                groceries, fun money. That&apos;s the whole idea.
              </p>
              <ul className="moss-setup-summary moss-setup-summary--explainer">
                <li>
                  <span className="moss-setup-summary-label">Envelopes</span>
                  <span className="moss-setup-summary-value">
                    Named pockets for your money — Rent, Groceries, Fun.
                  </span>
                </li>
                <li>
                  <span className="moss-setup-summary-label">Each paycheck</span>
                  <span className="moss-setup-summary-value">
                    Deal dollars into those pockets until every one has a job.
                  </span>
                </li>
                <li>
                  <span className="moss-setup-summary-label">Day to day</span>
                  <span className="moss-setup-summary-value">
                    MOSS keeps the math so you always know what&apos;s left in each pocket.
                  </span>
                </li>
              </ul>
              <div className="moss-setup-topic-row" aria-label="Starter envelopes">
                {STARTER_ENVELOPES.filter(
                  (starter) =>
                    !addedEnvelopes.some(
                      (existing) => existing.toLowerCase() === starter.name.toLowerCase()
                    )
                ).map((starter) => (
                  <button
                    key={starter.name}
                    type="button"
                    className="moss-setup-topic-chip"
                    disabled={busy}
                    onClick={() => void handleEnvelopeAdd(starter.name, starter.kind)}
                  >
                    + {starter.name}
                  </button>
                ))}
              </div>
              {addedEnvelopes.length > 0 && (
                <ul className="moss-setup-envelope-list" aria-label="Envelopes you added">
                  {addedEnvelopes.map((label) => (
                    <li key={label} className="moss-setup-envelope-item">
                      <span className="moss-setup-envelope-check" aria-hidden>
                        ✓
                      </span>
                      {label}
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="moss-setup-advanced"
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleEnvelopeAdd()
                }}
              >
                <input
                  type="text"
                  className="moss-setup-input"
                  placeholder={
                    addedEnvelopes.length === 0
                      ? 'Name your first envelope — try Groceries'
                      : 'Add another envelope'
                  }
                  maxLength={64}
                  value={envelopeName}
                  onChange={(e) => setEnvelopeName(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="submit"
                  className={[
                    'moss-setup-btn',
                    'moss-setup-btn--compact',
                    addedEnvelopes.length === 0
                      ? 'moss-setup-btn--primary'
                      : 'moss-setup-btn--ghost'
                  ].join(' ')}
                  disabled={busy || !envelopeName.trim()}
                >
                  Add envelope
                </button>
              </form>
              {moneyNote && <p className="moss-setup-flash">{moneyNote}</p>}
              {addedEnvelopes.length > 0 ? (
                <p className="moss-setup-flash" role="status">
                  {addedEnvelopes.length === 1
                    ? `“${addedEnvelopes[0]}” is in. Add more, or hit Continue below when you're done.`
                    : `${addedEnvelopes.length} envelopes ready. Add more, or hit Continue below.`}
                </p>
              ) : (
                <p className="moss-setup-note moss-setup-note--quiet">
                  No rush — the Financials page walks you through the same thing when you&apos;re
                  ready.
                </p>
              )}
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
                      : 'Needs a one-time setup first — or import a file below.'}
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

          {step === STEP_INBOX && (
            <section className="moss-setup-step moss-setup-step--inbox">
              <p className="moss-setup-kicker nutrition-mono">Inbox</p>
              <h1 className="moss-setup-title">Bring your mail along.</h1>
              <p className="moss-setup-copy">
                Connect Gmail or any email account to read, reply, and send inside MOSS. Nothing
                here is required — skip and connect later in Settings.
              </p>
              <p className="moss-setup-note">
                Connecting Gmail? Google will warn that the app isn&apos;t verified — that&apos;s us
                being new, not shady. Tap <strong>Advanced</strong>, then <strong>Continue</strong>.
              </p>
              {inboxReady ? (
                <MailAccountsPanel />
              ) : (
                <p className="moss-setup-note">Preparing your profile…</p>
              )}
            </section>
          )}

          {step === STEP_NUTRITION && (
            <section className="moss-setup-step">
              <p className="moss-setup-kicker nutrition-mono">Nutrition</p>
              <h1 className="moss-setup-title">Daily fuel target.</h1>
              <p className="moss-setup-copy">
                A gentle daily calorie target for your dashboard — adjust anytime. Describe meals
                in plain English when you&apos;re ready to log.
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
                Pick topics and outlets you trust — headlines land on your dashboard. Tune anytime
                in Settings.
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
                <li>
                  <span className="moss-setup-summary-label">Smart parsing</span>
                  <span className="moss-setup-summary-value">{aiSummary}</span>
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
                    <span className="moss-setup-summary-value">
                      {addedEnvelopes.length > 0
                        ? `${addedEnvelopes.length} envelope${addedEnvelopes.length > 1 ? 's' : ''} ready — ${addedEnvelopes.join(', ')}`
                        : 'Ready on your dashboard'}
                    </span>
                  </li>
                )}
                {modules.inbox.enabled && (
                  <li>
                    <span className="moss-setup-summary-label">Inbox</span>
                    <span className="moss-setup-summary-value">
                      Connect anytime in Settings
                    </span>
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
              <p className="moss-setup-note">
                Your data lives in one file on this computer
                {databasePath ? (
                  <>
                    : <span className="nutrition-mono moss-selectable">{databasePath}</span>
                  </>
                ) : null}{' '}
                —{' '}
                <button
                  type="button"
                  className="moss-setup-link"
                  onClick={() => void finishSetup('/settings?section=privacy')}
                  disabled={busy}
                >
                  see, move, or manage it in Settings
                </button>
                .
              </p>
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
                className="moss-setup-btn moss-setup-btn--ghost moss-setup-btn--skip"
                onClick={skipStep}
                disabled={busy || (step === 2 && !name.trim())}
              >
                Skip for now
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
