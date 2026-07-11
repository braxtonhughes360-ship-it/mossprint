import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, LOCALAI_DOWNLOAD_PROGRESS_EVENT } from '@shared/ipc'
import type { CaptureCommitInput } from '@shared/capture'
import type { LocalAiSurface } from '@shared/localai'
import { assertTrustedSender, assertNonEmptyString } from './trust'
import { requireActiveProfileDatabase } from '../profiles'
import { commitCaptureDraft, previewCaptureText, routeCaptureText } from '../captureRoute'
import { warmCaptureIntentLlm } from '../captureIntentLlm'
import { getLocalAiPanelState, resetLocalLlmProbe } from '../localLlm'
import {
  cancelModelDownload,
  onModelDownloadProgress,
  setModelConsent,
  startModelDownload
} from '../localRuntime'
import { hideCaptureWindow } from '../captureWindow'
import { resetIdleLockOnActivate } from '../idleLock'

const LOCALAI_SURFACES = new Set<LocalAiSurface>(['capture', 'money', 'nutrition', 'calendar'])

function parseLocalAiSurface(value: unknown): LocalAiSurface {
  if (typeof value === 'string' && LOCALAI_SURFACES.has(value as LocalAiSurface)) {
    return value as LocalAiSurface
  }
  return 'capture'
}

function assertCaptureCommitInput(value: unknown): CaptureCommitInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid capture confirm payload')
  }
  const row = value as Record<string, unknown>
  if (row.kind === 'money') {
    const money = row.money
    if (!money || typeof money !== 'object') {
      throw new Error('Invalid money capture draft')
    }
    const draft = money as Record<string, unknown>
    if (typeof draft.amountCents !== 'number' || !Number.isFinite(draft.amountCents)) {
      throw new Error('Invalid capture amount')
    }
    return {
      kind: 'money',
      money: {
        amountCents: draft.amountCents,
        // Same clamp as the sanitizer: anything that isn't exactly "income" is an expense.
        direction: draft.direction === 'income' ? 'income' : 'expense',
        dateKey:
          typeof draft.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draft.dateKey)
            ? draft.dateKey
            : null,
        merchant: typeof draft.merchant === 'string' ? draft.merchant : '',
        categoryId: typeof draft.categoryId === 'string' ? draft.categoryId : null
      }
    }
  }
  if (row.kind === 'calendar') {
    const calendar = row.calendar
    if (!calendar || typeof calendar !== 'object') {
      throw new Error('Invalid calendar capture draft')
    }
    const draft = calendar as Record<string, unknown>
    assertNonEmptyString(draft.title, 'title')
    assertNonEmptyString(draft.startAt, 'startAt')
    assertNonEmptyString(draft.endAt, 'endAt')
    const kind =
      draft.kind === 'general' ||
      draft.kind === 'class' ||
      draft.kind === 'exam' ||
      draft.kind === 'assignment' ||
      draft.kind === 'office_hours'
        ? draft.kind
        : 'general'
    return {
      kind: 'calendar',
      calendar: {
        title: draft.title as string,
        startAt: draft.startAt as string,
        endAt: draft.endAt as string,
        kind
      }
    }
  }
  if (row.kind === 'note') {
    const note = row.note
    if (!note || typeof note !== 'object') {
      throw new Error('Invalid note capture draft')
    }
    const draft = note as Record<string, unknown>
    assertNonEmptyString(draft.text, 'text')
    return {
      kind: 'note',
      note: {
        text: draft.text as string,
        isTask: draft.isTask === true
      }
    }
  }
  throw new Error('Unsupported capture confirm kind')
}

export function registerCaptureHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CAPTURE_SUBMIT, async (event, text: unknown) => {
    assertTrustedSender(event)
    // Capture writes into the open profile database — locked/no profile means no capture.
    requireActiveProfileDatabase()
    assertNonEmptyString(text, 'text')
    const result = await routeCaptureText(text)
    // A successful capture is user activity — keep the idle lock honest.
    resetIdleLockOnActivate()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURE_CONFIRM, (event, payload: unknown) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    const input = assertCaptureCommitInput(payload)
    const result = commitCaptureDraft(input)
    resetIdleLockOnActivate()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.CAPTURE_HIDE, (event) => {
    assertTrustedSender(event)
    hideCaptureWindow()
    return { ok: true as const }
  })

  // Parse-only preview for module describe fields — same brain, zero writes.
  ipcMain.handle(IPC_CHANNELS.LOCALAI_DESCRIBE_PREVIEW, async (event, text: unknown, surface: unknown) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    assertNonEmptyString(text, 'text')
    return previewCaptureText(text, parseLocalAiSurface(surface))
  })

  ipcMain.handle(IPC_CHANNELS.LOCALAI_WARM, (event) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    warmCaptureIntentLlm()
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.LOCALAI_GET_STATE, async (event) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    return getLocalAiPanelState()
  })

  ipcMain.handle(IPC_CHANNELS.LOCALAI_RESET_PROBE, (event) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    resetLocalLlmProbe()
    return { ok: true as const }
  })

  // LA7 — bundled-model consent + download control (app-level, per-machine).
  ipcMain.handle(IPC_CHANNELS.LOCALAI_MODEL_CONSENT, (event, consent: unknown) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    if (consent !== 'accepted' && consent !== 'later') {
      throw new Error('Invalid model consent value')
    }
    setModelConsent(consent)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.LOCALAI_MODEL_DOWNLOAD_START, (event) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    void startModelDownload()
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.LOCALAI_MODEL_DOWNLOAD_CANCEL, (event) => {
    assertTrustedSender(event)
    requireActiveProfileDatabase()
    cancelModelDownload()
    return { ok: true as const }
  })

  onModelDownloadProgress((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(LOCALAI_DOWNLOAD_PROGRESS_EVENT, state)
      }
    }
  })
}
