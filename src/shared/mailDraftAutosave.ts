/** Debounce window for composer draft autosave — exported for tests. */
export const MAIL_DRAFT_AUTOSAVE_MS = 800

export interface MailDraftFields {
  to: string
  cc: string
  subject: string
  body: string
}

/** True when any compose field has non-whitespace content worth persisting. */
export function draftHasContent(fields: MailDraftFields): boolean {
  return [fields.to, fields.cc, fields.subject, fields.body].some((value) => value.trim().length > 0)
}

/**
 * Serialize an async save so calls never overlap. Two saves racing before
 * either resolves both see no draft id and each insert a fresh row — the
 * "two drafts on close" bug. Chaining makes save N+1 see the id save N wrote.
 */
export function createSerializedSaver(save: () => Promise<void>): () => Promise<void> {
  let chain: Promise<void> = Promise.resolve()
  return () => {
    const run = chain.then(save)
    chain = run.catch(() => undefined)
    return run
  }
}

export interface DraftAutosaveScheduler {
  schedule: () => void
  flush: () => void
  cancel: () => void
}

/** Debounced autosave scheduler — timer primitives injected for unit tests. */
export function createDraftAutosaveScheduler(
  debounceMs: number,
  onSave: () => void,
  scheduleTimer: (fn: () => void, ms: number) => number,
  cancelTimer: (id: number) => void
): DraftAutosaveScheduler {
  let timerId: number | null = null

  return {
    schedule() {
      if (timerId !== null) cancelTimer(timerId)
      timerId = scheduleTimer(() => {
        timerId = null
        onSave()
      }, debounceMs)
    },
    flush() {
      if (timerId !== null) {
        cancelTimer(timerId)
        timerId = null
        onSave()
      }
    },
    cancel() {
      if (timerId !== null) {
        cancelTimer(timerId)
        timerId = null
      }
    }
  }
}
