import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { setSetting } from './database'
import { PREFERENCES_STORAGE_KEY, DEFAULT_PREFERENCES } from '@shared/preferences'
import { activateProfile, listProfiles } from './profiles'
import { seedShotNewsItems } from './headlessCommon'

/**
 * QA-09 perf sweep (beta.5 V2): cold start → interactive dashboard, per-route
 * switch times (cold + warm), idle CPU sample, and process memory — against the
 * seeded QA profile so runs compare before/after builds on identical data.
 * Motion/ambient forced off so numbers measure the app, not the (full-tier-only,
 * by-design) ambient canvas.
 */
export async function runHeadlessPerfSweep(): Promise<void> {
  const mark = (step: string): void => {
    process.stderr.write(`[perf-sweep] ${step}\n`)
  }
  try {
    mark('seed:start')
    const { runQaProfileSeed, QA_PROFILE_NAME } = await import('./qaProfileSeed')
    // skipNewsSync: perf numbers must not depend on the network being up.
    await runQaProfileSeed({ quitApp: false, force: true, skipNewsSync: true })
    mark('seed:done')

    const qa = listProfiles().find((p) => p.displayName === QA_PROFILE_NAME)
    if (!qa) throw new Error('QA Tester profile missing after seed')
    const activated = await activateProfile(qa.id, undefined, { bypassPassword: true })
    if (!activated.ok) throw new Error(activated.message ?? 'Failed to activate QA profile')
    await seedShotNewsItems()
    mark('profile:active')

    setSetting(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        colorMode: 'dark',
        motionIntensity: 'off',
        ambientIntensity: 'off',
        profile: { displayName: 'Alex' },
        setup: { completedAt: new Date().toISOString(), version: 1 },
        modules: {
          calendar: { enabled: true },
          money: { enabled: true, investmentsEnabled: true, advancedToolsEnabled: true },
          nutrition: { enabled: true },
          inbox: { enabled: true },
          notes: { enabled: true },
          news: { enabled: true }
        }
      })
    )

    const win = new BrowserWindow({
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
    const wc = win.webContents
    // Surface renderer errors on stderr — "Script failed to execute" alone is undebuggable.
    wc.on('console-message', (_event, level, message) => {
      if (level >= 3) process.stderr.write(`[renderer] ${message}\n`)
    })

    const waitFor = (selector: string, label: string): Promise<unknown> =>
      wc.executeJavaScript(
        `new Promise((resolve, reject) => {
          const deadline = Date.now() + 30000
          const tick = () => {
            if (document.querySelector(${JSON.stringify(selector)})) return resolve(true)
            if (Date.now() > deadline) return reject(new Error(${JSON.stringify(label)} + ' timed out'))
            requestAnimationFrame(tick)
          }
          tick()
        })`,
        true
      )

    const metrics = async (): Promise<Record<string, number>> => {
      const res = (await wc.debugger.sendCommand('Performance.getMetrics')) as {
        metrics: Array<{ name: string; value: number }>
      }
      return Object.fromEntries(res.metrics.map((m) => [m.name, m.value]))
    }

    // Cold start: renderer load → picker → dashboard interactive.
    const t0 = Date.now()
    await win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })
    mark('renderer:loaded')
    // Attach only once a renderer target exists — pre-load, Performance.enable
    // never resolves. getMetrics is cumulative since renderer start, so boot
    // numbers are unaffected by the late enable.
    wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('Performance.enable')
    await waitFor('.moss-profile-tile', 'profile picker')
    const pickerReadyMs = Date.now() - t0
    mark('picker:ready')
    await wc.executeJavaScript(
      `(() => {
        const tiles = Array.from(document.querySelectorAll('.moss-profile-tile'))
        const target = tiles.find((tile) => tile.textContent?.includes(${JSON.stringify(QA_PROFILE_NAME)}))
        if (!target) throw new Error('QA Tester profile tile not found')
        target.click()
      })()`,
      true
    )
    await waitFor('.dashboard-news-sync', 'dashboard')
    const dashboardReadyMs = Date.now() - t0
    mark('dashboard:ready')
    const bootMetrics = await metrics()

    // Seed the ink-gate fixture BEFORE the first /notes visit so the list
    // query's first fetch includes it (global staleTime is 15s — a later
    // bridge-side insert would not surface on remount).
    await wc.executeJavaScript(
      `(async () => {
        const body = Array.from({ length: 220 }, (_, i) => 'Line ' + i + ' — ink perf fixture.').join('\\n')
        await window.moss.notes.createNote({ title: 'Ink perf fixture', body })
        return true
      })()`,
      true
    )

    // Route switches: cold pass then warm pass over every module route.
    const routes = [
      { route: '/money', selector: '.money-arrival-kicker' },
      { route: '/nutrition', selector: '.nutrition-arrival-kicker' },
      { route: '/calendar', selector: '.calendar-view-toggle' },
      { route: '/inbox', selector: '.moss-arrival-inbox' },
      { route: '/notes', selector: '.moss-arrival-notes' },
      { route: '/settings', selector: '.settings-card' },
      { route: '/', selector: '.dashboard-news-sync' }
    ]
    const routeSwitches: Record<string, { coldMs: number; warmMs: number }> = {}
    for (const pass of ['coldMs', 'warmMs'] as const) {
      for (const { route, selector } of routes) {
        const start = Date.now()
        await wc.executeJavaScript(`window.location.hash = '#${route}'`, true)
        await waitFor(selector, `route ${route}`)
        mark(`route:${route} ${pass}`)
        ;(routeSwitches[route] ??= { coldMs: 0, warmMs: 0 })[pass] = Date.now() - start
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }

    // R2 note-ink gate: open Notes, enter Draw on the seeded long document,
    // lay down a heavy multi-stroke session ON the page, and measure (a)
    // per-frame cost while a stroke extends (one real flush — catmull-rom +
    // taper — per frame) and (b) scroll fps with the session live (each
    // scroll repaints the viewport-window canvas under a translate). These
    // numbers decide draw-anywhere vs the framed-sketch degrade path. The ink
    // must also round-trip through autosave — persistence is asserted at the end.
    await wc.executeJavaScript(`window.location.hash = '#/notes'`, true)
    await waitFor('.moss-arrival-notes', 'notes workspace')
    await waitFor('.notes-row', 'notes list rows')
    await wc.executeJavaScript(
      `new Promise((resolve, reject) => {
        // The list may render cached rows before the refetch lands the
        // bridge-created fixture — poll instead of racing it.
        const deadline = Date.now() + 10000
        const tick = () => {
          const rows = Array.from(document.querySelectorAll('.notes-row'))
          const target = rows.find((row) => row.textContent?.includes('Ink perf fixture'))
          if (target) {
            target.click()
            return resolve(true)
          }
          if (Date.now() > deadline) return reject(new Error('Ink perf fixture row timed out'))
          requestAnimationFrame(tick)
        }
        tick()
      })`,
      true
    )
    await waitFor('.notes-doc-scroll', 'note document')
    const noteInkStart = await metrics()
    const noteInk = (await wc.executeJavaScript(
      `(async () => {
        const drawBtn = Array.from(document.querySelectorAll('.notes-editor-toolbar .moss-button'))
          .find((b) => b.textContent.trim() === 'Draw')
        if (!drawBtn) throw new Error('Draw button not found')
        drawBtn.click()
        const layer = await new Promise((resolve, reject) => {
          const deadline = Date.now() + 5000
          const tick = () => {
            const el = document.querySelector('.notes-ink-layer[data-pen]')
            if (el) return resolve(el)
            if (Date.now() > deadline) return reject(new Error('ink layer never armed'))
            requestAnimationFrame(tick)
          }
          tick()
        })
        const rect = layer.getBoundingClientRect()
        const pev = (type, x, y, buttons) =>
          new PointerEvent(type, {
            pointerId: 1, pointerType: 'mouse', pressure: 0.5, isPrimary: true,
            button: 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true
          })
        const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
        const stat = (arr, skip) => {
          const sorted = arr.slice(skip).sort((a, b) => a - b)
          const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
          return {
            frames: sorted.length,
            medianFrameMs: Math.round(at(0.5) * 100) / 100,
            p95FrameMs: Math.round(at(0.95) * 100) / 100,
            framesOver33Ms: sorted.filter((ms) => ms > 33.4).length
          }
        }
        // Draw: 6 strokes, 120 moves each, one move per frame -> a real flush a frame.
        const drawFrames = []
        for (let s = 0; s < 6; s++) {
          const sx = rect.left + 60 + s * 18
          const sy = rect.top + 60
          layer.dispatchEvent(pev('pointerdown', sx, sy, 1))
          let last = performance.now()
          for (let f = 0; f < 120; f++) {
            const t = f / 120
            layer.dispatchEvent(
              pev('pointermove', sx + Math.sin(t * Math.PI * 4) * 180 + t * 30, sy + t * 320, 1)
            )
            await nextFrame()
            const now = performance.now()
            drawFrames.push(now - last)
            last = now
          }
          layer.dispatchEvent(pev('pointerup', rect.left + 60 + s * 18, rect.top + 380, 0))
        }
        // Scroll with the live session: the window canvas repaints per scroll frame.
        const scroller = document.querySelector('.notes-doc-scroll')
        const maxTop = Math.max(1, scroller.scrollHeight - scroller.clientHeight)
        const scrollFrames = []
        let plast = performance.now()
        for (let f = 0; f < 120; f++) {
          scroller.scrollTop = (f % 2 ? 0.66 : 0.33) * maxTop + (f * 7) % 120
          await nextFrame()
          const now = performance.now()
          scrollFrames.push(now - plast)
          plast = now
        }
        // Leave pen mode; autosave (450ms debounce) commits the session.
        const doneBtn = Array.from(document.querySelectorAll('.notes-ink-toolbar .money-button'))
          .find((b) => b.textContent.trim() === 'Done')
        if (doneBtn) doneBtn.click()
        await new Promise((r) => setTimeout(r, 900))
        const rows = await window.moss.notes.listNotes()
        const fixture = rows.find((n) => n.title === 'Ink perf fixture')
        const saved = fixture ? await window.moss.notes.getNote(fixture.id) : null
        return {
          sessionStrokes: 6,
          drawFrames: drawFrames.length,
          draw: stat(drawFrames, 8),
          scroll: stat(scrollFrames, 8),
          inkPersistedStrokes: saved && saved.ink ? saved.ink.strokes.length : 0
        }
      })()`,
      true
    )) as { sessionStrokes: number; drawFrames: number } & Record<string, unknown>
    const noteInkEnd = await metrics()
    const noteInkDelta = (key: string): number => (noteInkEnd[key] ?? 0) - (noteInkStart[key] ?? 0)
    mark('notes:ink-measured')

    // Idle sample on the dashboard (settle first so mount work doesn't pollute it).
    const idleSeconds = Number(process.env.MOSS_PERF_IDLE_SECONDS ?? 15)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const idleStart = await metrics()
    await new Promise((resolve) => setTimeout(resolve, idleSeconds * 1000))
    const idleEnd = await metrics()
    const delta = (key: string): number => (idleEnd[key] ?? 0) - (idleStart[key] ?? 0)

    const appMetrics = app
      .getAppMetrics()
      .map((p) => ({ type: p.type, workingSetMb: p.memory.workingSetSize / 1024 }))

    wc.debugger.detach()
    if (!win.isDestroyed()) win.destroy()

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        coldStart: { pickerReadyMs, dashboardReadyMs },
        boot: {
          scriptDurationSec: bootMetrics.ScriptDuration,
          jsHeapUsedMb: (bootMetrics.JSHeapUsedSize ?? 0) / 1048576,
          nodes: bootMetrics.Nodes
        },
        routeSwitches,
        noteInk: {
          ...noteInk,
          scriptDurationSec: noteInkDelta('ScriptDuration'),
          perDrawFrameScriptMs:
            noteInk.drawFrames > 0
              ? Math.round((noteInkDelta('ScriptDuration') * 1000 * 1000) / noteInk.drawFrames) / 1000
              : 0,
          layoutCount: noteInkDelta('LayoutCount'),
          recalcStyleCount: noteInkDelta('RecalcStyleCount')
        },
        idle: {
          seconds: idleSeconds,
          taskDurationSec: delta('TaskDuration'),
          scriptDurationSec: delta('ScriptDuration'),
          layoutCount: delta('LayoutCount'),
          recalcStyleCount: delta('RecalcStyleCount'),
          jsHeapUsedMb: (idleEnd.JSHeapUsedSize ?? 0) / 1048576,
          nodes: idleEnd.Nodes
        },
        processMemory: appMetrics
      })}\n`
    )
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}
