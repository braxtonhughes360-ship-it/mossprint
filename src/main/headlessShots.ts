import { app, BrowserWindow, nativeTheme } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setSetting } from './database'
import { PREFERENCES_STORAGE_KEY, DEFAULT_PREFERENCES } from '@shared/preferences'
import { activateProfile, createProfile, initializeProfiles, listProfiles } from './profiles'
import { seedShotNewsItems } from './headlessCommon'

const README_SHOTS = [
  { route: '/', filename: 'dashboard', readySelector: '.dashboard-news-sync' },
  { route: '/money', filename: 'money', readySelector: '.money-arrival-kicker' },
  { route: '/nutrition', filename: 'nutrition', readySelector: '.nutrition-arrival-kicker' },
  { route: '/calendar', filename: 'calendar', readySelector: '.calendar-view-toggle' },
  // R1: the rebuilt Notes document workspace is the beta.5 headline shot —
  // captured with the pinned note OPEN so the document (not an empty pane)
  // is what the README shows.
  {
    route: '/notes',
    filename: 'notes',
    // Wait for query-backed rows, not only the synchronous layout shell, so
    // prepare never races the first note into existence.
    readySelector: '.notes-row',
    prepare: `(() => {
      const row = document.querySelector('.notes-row')
      if (row) row.click()
    })()`,
    preparedSelector: '.notes-doc'
  }
] as const

// Extra routes for the full visual audit (MOSS_SHOTS_FULL=1) — every shell surface, both modes.
const AUDIT_ONLY_SHOTS = [
  { route: '/inbox', filename: 'inbox', readySelector: '.moss-arrival-inbox' },
  { route: '/settings', filename: 'settings', readySelector: '.settings-card' },
  {
    route: '/calendar',
    filename: 'calendar-event-edit',
    readySelector: '.calendar-week-event-open:not(:disabled)',
    prepare: `new Promise((resolve) => {
      document.querySelector('.calendar-week-event-open:not(:disabled)')?.click()
      requestAnimationFrame(() => {
        document.querySelector('.moss-checkbox .moss-choice__native')?.click()
        resolve(true)
      })
    })`,
    preparedSelector: '.calendar-event-modal'
  }
] as const

// Brand-new profile proof for W3d: every dashboard door plus every routed
// module surface, with no domain rows seeded into the profile database.
const FRESH_PROFILE_SHOTS = [
  { route: '/', filename: 'dashboard', readySelector: '.dashboard-news-empty' },
  {
    route: '/',
    filename: 'dashboard-doors',
    readySelector: '.dashboard-news-empty',
    prepare: `(() => document.querySelector('.moss-door-grid-info')?.scrollIntoView({ block: 'end' }))()`
  },
  { route: '/money', filename: 'money', readySelector: '.money-empty-onboard' },
  { route: '/nutrition', filename: 'nutrition', readySelector: '.nutrition-diary' },
  { route: '/calendar', filename: 'calendar', readySelector: '.calendar-week-panel' },
  { route: '/inbox', filename: 'inbox', readySelector: '.moss-arrival-inbox' },
  { route: '/notes', filename: 'notes', readySelector: '.notes-layout' },
  { route: '/settings', filename: 'settings', readySelector: '.settings-card' }
] as const

const W1C_TOKEN_SHOTS = [
  { route: '/', filename: 'nav-lockup', readySelector: '.moss-lockup-plate' },
  {
    route: '/inbox',
    filename: 'open-email',
    readySelector: '.inbox-message-row',
    prepare: `(() => document.querySelector('.inbox-message-row')?.click())()`,
    preparedSelector: '.mail-body-frame'
  }
] as const

const W3B_LOADING_SHOTS = [
  {
    route: '/',
    filename: 'dashboard',
    loadingSelector: '.dashboard-news-loading',
    readySelector: '.dashboard-news-sync',
    layoutSelector: '.dashboard-news-card'
  },
  {
    route: '/inbox',
    filename: 'inbox',
    loadingSelector: '.inbox-list-skeleton',
    readySelector: '.inbox-message-row',
    layoutSelector: '.inbox-shell'
  }
] as const

const W2I_SETTINGS_SHOTS = [
  { route: '/settings', filename: 'settings', readySelector: '.settings-card' },
  {
    route: '/setup?rerun=1&shot=preferences',
    filename: 'setup-preferences',
    beforeNavigate: `new Promise((resolve) => {
      window.location.hash = '#/settings'
      setTimeout(() => {
        sessionStorage.setItem('moss.setup.step', '5')
        resolve(true)
      }, 250)
    })`,
    readySelector: '.moss-setup-check--solo'
  },
  {
    route: '/setup?rerun=1&shot=modules',
    filename: 'setup-modules',
    beforeNavigate: `new Promise((resolve) => {
      window.location.hash = '#/settings'
      setTimeout(() => {
        sessionStorage.setItem('moss.setup.step', '6')
        resolve(true)
      }, 250)
    })`,
    readySelector: '.moss-setup-checklist'
  }
] as const

/**
 * README screenshots: seed the QA Tester profile into ISOLATED userData,
 * swap live feeds for the deterministic briefing, capture light-mode PNGs
 * of the dashboard + module pages into docs/screenshots/.
 */
export async function runHeadlessReadmeShots(): Promise<void> {
  try {
    const { runQaProfileSeed, QA_PROFILE_NAME } = await import('./qaProfileSeed')
    const freshProfileAudit = process.env.MOSS_SHOTS_FRESH === '1'
    const profileName = freshProfileAudit ? 'Fresh Profile' : QA_PROFILE_NAME

    if (freshProfileAudit) {
      initializeProfiles()
      const created = createProfile({ displayName: profileName, avatarColor: 'moss' })
      const result = await activateProfile(created.profile.id, undefined, { bypassPassword: true })
      if (!result.ok) throw new Error(result.message ?? 'Failed to activate fresh profile')
    } else {
      // skipNewsSync: every source is deleted below anyway, and the live fetch
      // (no request timeout) hangs the whole run when offline.
      await runQaProfileSeed({ quitApp: false, force: true, skipNewsSync: true })
    }

    const qa = listProfiles().find((p) => p.displayName === profileName)
    if (!qa) throw new Error('QA Tester profile missing after seed')
    const activated = await activateProfile(qa.id, undefined, { bypassPassword: true })
    if (!activated.ok) {
      throw new Error(activated.message ?? 'Failed to reactivate QA profile')
    }

    if (!freshProfileAudit) {
      // Live feeds are non-deterministic (and may be offline) — replace with the fixed briefing.
      const { listNewsSources, deleteNewsSource } = await import('./news')
      for (const source of listNewsSources()) deleteNewsSource(source.id)
      await seedShotNewsItems()
    }

    const w2iAudit = process.env.MOSS_SHOTS_W2I === '1'
    const fullAudit = process.env.MOSS_SHOTS_FULL === '1' || freshProfileAudit || w2iAudit
    const w1cAudit = process.env.MOSS_SHOTS_W1C === '1'
    const w3bAudit = process.env.MOSS_SHOTS_W3B === '1'

    if (w1cAudit || w3bAudit) {
      const { createGmailAccount, upsertMessage } = await import('./mail')
      const accountId = createGmailAccount('alex@example.com', 'Personal')
      upsertMessage({
        accountId,
        externalId: 'w1c-reader-palette',
        threadId: 'w1c-reader-palette',
        folder: 'inbox',
        fromName: 'State Zero Studio',
        fromEmail: 'studio@example.com',
        toEmails: 'Alex <alex@example.com>',
        ccEmails: '',
        subject: 'A warmer reading instrument',
        snippet: 'The reader now carries the same paper, ink, and climate accent as the shell.',
        bodyHtml:
          '<p>The reader now carries the same paper, ink, and climate accent as the shell.</p><blockquote>OS light and dark still choose the body palette by design.</blockquote><p><a href="https://example.com">View the design note</a></p>',
        bodyText:
          'The reader now carries the same paper, ink, and climate accent as the shell. OS light and dark still choose the body palette by design.',
        messageIdHeader: '<w1c-reader-palette@example.com>',
        referencesHeader: '',
        receivedAt: new Date().toISOString(),
        read: true,
        flags: ''
      })
    }

    // Friendly persona name — still fake data. W3b deliberately walks every
    // motion tier; the general screenshot harness stays motion-off for stable frames.
    const writeShotPreferences = (
      colorMode: 'light' | 'dark',
      motionIntensity: 'full' | 'reduced' | 'off' = 'off',
      accentPalette = process.env.MOSS_SHOTS_ACCENT ?? DEFAULT_PREFERENCES.accentPalette
    ): void => {
      setSetting(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({
          ...DEFAULT_PREFERENCES,
          colorMode,
          accentPalette,
          motionIntensity,
          ambientIntensity: 'off',
          profile: { displayName: freshProfileAudit ? '' : 'Alex' },
          setup: { completedAt: new Date().toISOString(), version: 1 },
          modules: {
            calendar: { enabled: true, academicsEnabled: fullAudit && !freshProfileAudit },
            money: { enabled: true, investmentsEnabled: true, advancedToolsEnabled: true },
            nutrition: { enabled: true },
            inbox: { enabled: fullAudit || w1cAudit || w3bAudit },
            notes: { enabled: true },
            news: {
              enabled: true,
              maxItems: 9,
              widgetLayout: 'split',
              briefingMode: 'balanced',
              maxPerSource: 2
            }
          }
        })
      )
    }

    const outDir = freshProfileAudit
      ? join(app.getAppPath(), 'agent_docs', 'screenshots', 'beta6-w3d-fresh')
      : w2iAudit
      ? join(app.getAppPath(), 'agent_docs', 'screenshots', 'beta6-w2i-after')
      : w3bAudit
      ? join(app.getAppPath(), 'agent_docs', 'screenshots', 'beta6-w3b')
      : w1cAudit
      ? join(app.getAppPath(), 'agent_docs', 'screenshots', 'w1c-brand-tokens')
      : fullAudit
        ? join(app.getAppPath(), 'agent_docs', 'screenshots', 'audit')
        : join(app.getAppPath(), 'docs', 'screenshots')
    mkdirSync(outDir, { recursive: true })

    const captureWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: '#dddcd8',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webgl: false
      }
    })

    const waitForSelector = async (selector: string, label: string): Promise<void> => {
      try {
        await captureWindow.webContents.executeJavaScript(
          `new Promise((resolve, reject) => {
            const deadline = Date.now() + 20000
            const tick = () => {
              if (document.querySelector('${selector}')) {
                resolve(true)
                return
              }
              if (Date.now() > deadline) {
                reject(new Error('${label} did not render ${selector} in time'))
                return
              }
              requestAnimationFrame(tick)
            }
            tick()
          })`,
          true
        )
      } catch (waitErr) {
        const debugText = await captureWindow.webContents
          .executeJavaScript(`document.body.innerText.slice(0, 600)`, true)
          .catch(() => '(no body text)')
        const debugShot = await captureWindow.webContents.capturePage()
        writeFileSync(join(outDir, 'readme-debug.png'), debugShot.toPNG())
        process.stderr.write(`Debug body text for ${label}: ${JSON.stringify(debugText)}\n`)
        throw waitErr
      }
    }

    const enterQaProfile = async (): Promise<void> => {
      if (captureWindow.webContents.getURL()) {
        // loadFile with only a hash change is a same-document navigation — the old renderer
        // context (and its already-loaded preferences) would survive. Force a real reload.
        const reloaded = new Promise<void>((resolve) =>
          captureWindow.webContents.once('did-finish-load', () => resolve())
        )
        captureWindow.webContents.reloadIgnoringCache()
        await reloaded
      } else {
        await captureWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })
      }

      // A fresh boot lands on the profile picker — enter the QA profile like a user would.
      await waitForSelector('.moss-profile-tile, .moss-render-root', 'profile picker or shell')
      await captureWindow.webContents.executeJavaScript(
        `(() => {
          const tiles = Array.from(document.querySelectorAll('.moss-profile-tile'))
          if (tiles.length === 0) return false
          const target = tiles.find((tile) => tile.textContent?.includes(${JSON.stringify(profileName)}))
          if (!target) throw new Error('QA Tester profile tile not found')
          target.click()
          return true
        })()`,
        true
      )
    }

    const modes = fullAudit || w1cAudit || w3bAudit ? (['light', 'dark'] as const) : (['light'] as const)
    const motionTiers = w3bAudit
      ? (['full', 'reduced', 'off'] as const)
      : (['off'] as const)
    const allShots = freshProfileAudit
      ? [...FRESH_PROFILE_SHOTS]
      : w2iAudit
      ? [...W2I_SETTINGS_SHOTS]
      : w3bAudit
      ? [...W3B_LOADING_SHOTS]
      : w1cAudit
      ? [...W1C_TOKEN_SHOTS]
      : fullAudit
        ? [...README_SHOTS, ...AUDIT_ONLY_SHOTS]
        : [...README_SHOTS]
    const requestedShots = new Set(
      (process.env.MOSS_SHOTS_FILTER ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    )
    // Targeted visual gates can skip unrelated surfaces while keeping the
    // default README/full-audit matrix unchanged.
    const shots = requestedShots.size
      ? allShots.filter((shot) => requestedShots.has(shot.filename))
      : allShots
    if (shots.length === 0) throw new Error('MOSS_SHOTS_FILTER matched no screenshot surfaces')

    const written: string[] = []
    const layoutMetrics: Array<{
      surface: string
      mode: string
      motion: string
      loading: { width: number; height: number }
      content: { width: number; height: number }
      delta: { width: number; height: number }
    }> = []
    for (const mode of modes) {
      for (const motion of motionTiers) {
        if (w1cAudit) nativeTheme.themeSource = mode
        if (w3bAudit) await seedShotNewsItems()
        if (w2iAudit && captureWindow.webContents.getURL()) {
          await captureWindow.webContents.executeJavaScript(`window.location.hash = '#/settings'`, true)
        }
        writeShotPreferences(mode, motion)
        await enterQaProfile()
        await captureWindow.webContents.executeJavaScript(`document.fonts.ready`, true)

        for (const shot of shots) {
          const staged = shot as {
            beforeNavigate?: string
            prepare?: string
            preparedSelector?: string
          }
          if (staged.beforeNavigate) {
            await captureWindow.webContents.executeJavaScript(staged.beforeNavigate, true)
          }
          await captureWindow.webContents.executeJavaScript(
            `window.location.hash = '#${shot.route}'`,
            true
          )
          if (w3bAudit) {
            const progressive = shot as (typeof W3B_LOADING_SHOTS)[number]
            await waitForSelector(progressive.loadingSelector, `loading ${shot.route}`)
            const loadingRect = (await captureWindow.webContents.executeJavaScript(
              `(() => {
                const rect = document.querySelector(${JSON.stringify(progressive.layoutSelector)})?.getBoundingClientRect()
                if (!rect) throw new Error('Missing layout surface')
                return { width: rect.width, height: rect.height }
              })()`,
              true
            )) as { width: number; height: number }
            await new Promise((resolve) => setTimeout(resolve, 180))
            const loadingImage = await captureWindow.webContents.capturePage()
            const loadingName =
              shot.filename === 'dashboard'
                ? `dashboard-option-a-loading-only-skeleton-${mode}-${motion}.png`
                : `inbox-loading-${mode}-${motion}.png`
            const loadingPath = join(outDir, loadingName)
            writeFileSync(loadingPath, loadingImage.toPNG())
            written.push(loadingPath)

            await waitForSelector(progressive.readySelector, `content ${shot.route}`)
            await new Promise((resolve) => setTimeout(resolve, 500))
            const contentRect = (await captureWindow.webContents.executeJavaScript(
              `(() => {
                const rect = document.querySelector(${JSON.stringify(progressive.layoutSelector)})?.getBoundingClientRect()
                if (!rect) throw new Error('Missing layout surface')
                return { width: rect.width, height: rect.height }
              })()`,
              true
            )) as { width: number; height: number }
            // Prime Chromium's backing store after async content replaces the
            // placeholders; otherwise WebGL-backed hero layers can capture black.
            await captureWindow.webContents.capturePage()
            await new Promise((resolve) => setTimeout(resolve, 250))
            const contentImage = await captureWindow.webContents.capturePage()
            const contentName =
              shot.filename === 'dashboard'
                ? `dashboard-option-b-at-rest-texture-deleted-${mode}-${motion}.png`
                : `inbox-content-${mode}-${motion}.png`
            const contentPath = join(outDir, contentName)
            writeFileSync(contentPath, contentImage.toPNG())
            written.push(contentPath)
            layoutMetrics.push({
              surface: shot.filename,
              mode,
              motion,
              loading: loadingRect,
              content: contentRect,
              delta: {
                width: Math.abs(contentRect.width - loadingRect.width),
                height: Math.abs(contentRect.height - loadingRect.height)
              }
            })
            continue
          }

          await waitForSelector(shot.readySelector, `route ${shot.route}`)

          // Some shots stage the page first (e.g. Notes opens a document).
          if (staged.prepare) {
            await captureWindow.webContents.executeJavaScript(staged.prepare, true)
            if (staged.preparedSelector) {
              await waitForSelector(staged.preparedSelector, `prepared ${shot.route}`)
            }
          }

          // Let data queries, fonts, and images settle before the frame is captured.
          await new Promise((resolve) => setTimeout(resolve, 1500))

          const renderedMode = await captureWindow.webContents.executeJavaScript(
            `document.documentElement.dataset.colorMode`,
            true
          )
          if (renderedMode !== mode) {
            throw new Error(
              `mode mismatch on ${shot.route}: wanted ${mode}, renderer has ${renderedMode}`
            )
          }

          const image = await captureWindow.webContents.capturePage()
          const accentSuffix =
            w2iAudit && process.env.MOSS_SHOTS_ACCENT
              ? `-${process.env.MOSS_SHOTS_ACCENT}`
              : ''
          const filePath = join(outDir, `${shot.filename}-${mode}${accentSuffix}.png`)
          writeFileSync(filePath, image.toPNG())
          written.push(filePath)
        }
      }
    }

    if (w3bAudit) {
      const metricsPath = join(outDir, 'layout-metrics.json')
      writeFileSync(metricsPath, `${JSON.stringify(layoutMetrics, null, 2)}\n`)
      written.push(metricsPath)
    }

    if (w1cAudit) {
      writeShotPreferences('dark', 'off', 'ember')
      await enterQaProfile()
      await captureWindow.webContents.executeJavaScript(`window.location.hash = '#/'`, true)
      await waitForSelector('.moss-lockup-plate', 'ember nav and lockup')
      await new Promise((resolve) => setTimeout(resolve, 2500))
      // Prime Chromium's backing store after the third full renderer reload;
      // otherwise some headless GPUs return a partially repainted first frame.
      await captureWindow.webContents.capturePage()
      await new Promise((resolve) => setTimeout(resolve, 250))
      const image = await captureWindow.webContents.capturePage()
      const filePath = join(outDir, 'nav-lockup-ember-dark.png')
      writeFileSync(filePath, image.toPNG())
      written.push(filePath)
    }

    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy()
    }

    process.stdout.write(`${JSON.stringify({ ok: true, written })}\n`)
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}
