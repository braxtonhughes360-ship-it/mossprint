import { describe, expect, it, vi } from 'vitest'
import {
  createDraftAutosaveScheduler,
  createSerializedSaver,
  draftHasContent,
  MAIL_DRAFT_AUTOSAVE_MS
} from '../src/shared/mailDraftAutosave'

describe('draftHasContent', () => {
  it('returns false for an empty compose', () => {
    expect(draftHasContent({ to: '', cc: '', subject: '', body: '' })).toBe(false)
    expect(draftHasContent({ to: '  ', cc: '', subject: '', body: '\n' })).toBe(false)
  })

  it('returns true when any field has text', () => {
    expect(draftHasContent({ to: 'a@b.com', cc: '', subject: '', body: '' })).toBe(true)
    expect(draftHasContent({ to: '', cc: '', subject: 'Hi', body: '' })).toBe(true)
    expect(draftHasContent({ to: '', cc: '', subject: '', body: 'Draft' })).toBe(true)
  })
})

describe('createDraftAutosaveScheduler', () => {
  it('debounces saves until the window elapses', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const scheduler = createDraftAutosaveScheduler(
      MAIL_DRAFT_AUTOSAVE_MS,
      onSave,
      (fn, ms) => setTimeout(fn, ms) as unknown as number,
      (id) => clearTimeout(id)
    )

    scheduler.schedule()
    scheduler.schedule()
    expect(onSave).not.toHaveBeenCalled()

    vi.advanceTimersByTime(MAIL_DRAFT_AUTOSAVE_MS - 1)
    expect(onSave).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onSave).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('flush runs a pending save immediately', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const scheduler = createDraftAutosaveScheduler(
      500,
      onSave,
      (fn, ms) => setTimeout(fn, ms) as unknown as number,
      (id) => clearTimeout(id)
    )

    scheduler.schedule()
    scheduler.flush()
    expect(onSave).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(500)
    expect(onSave).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('cancel drops a pending save', () => {
    vi.useFakeTimers()
    const onSave = vi.fn()
    const scheduler = createDraftAutosaveScheduler(
      500,
      onSave,
      (fn, ms) => setTimeout(fn, ms) as unknown as number,
      (id) => clearTimeout(id)
    )

    scheduler.schedule()
    scheduler.cancel()
    vi.advanceTimersByTime(500)
    expect(onSave).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})

describe('createSerializedSaver', () => {
  it('never overlaps saves — the second waits for the first', async () => {
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const saver = createSerializedSaver(async () => {
      const n = ++calls
      events.push(`start${n}`)
      if (n === 1) await gate
      events.push(`end${n}`)
    })

    const first = saver()
    const second = saver()
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['start1'])

    release()
    await first
    await second
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('close during the debounce window upserts one draft, not two (QA2-02)', async () => {
    // Mimics main-process saveMailDraft: no id → insert new row; id → upsert.
    const rows = new Map<string, string>()
    let nextId = 0
    let draftId: string | null = null
    const saveDraft = async (id: string | undefined, body: string): Promise<string> => {
      await Promise.resolve() // async IPC hop
      const rowId = id ?? `draft-${++nextId}`
      rows.set(rowId, body)
      return rowId
    }
    const saver = createSerializedSaver(async () => {
      const saved = await saveDraft(draftId ?? undefined, 'hello')
      if (!draftId) draftId = saved
    })

    // Debounced autosave fires, and the user closes the composer immediately:
    // both saves are in flight before either resolved.
    await Promise.all([saver(), saver()])
    expect(rows.size).toBe(1)
  })

  it('a rejected save does not wedge the chain', async () => {
    let calls = 0
    const saver = createSerializedSaver(async () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
    })

    await expect(saver()).rejects.toThrow('boom')
    await expect(saver()).resolves.toBeUndefined()
    expect(calls).toBe(2)
  })
})
