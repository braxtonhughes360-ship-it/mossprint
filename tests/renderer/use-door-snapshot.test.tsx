import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { NotesDoorSnapshot } from '@shared/notes'
import { useDoorSnapshot } from '@renderer/hooks/useDoorSnapshot'
import { useNotesDoorSnapshot } from '@renderer/hooks/useNotesDoorSnapshot'
import { installMossMock } from '../helpers/mossMock'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const channel = { name: 'door' }

describe('useDoorSnapshot', () => {
  it('fetches on mount: loading until the first read resolves, then snapshot', async () => {
    const gate = deferred<string>()
    const loadSnapshot = vi.fn(() => gate.promise)
    const { result } = renderHook(() => useDoorSnapshot(channel, { loadSnapshot }))

    expect(result.current.loading).toBe(true)
    expect(result.current.snapshot).toBeNull()

    await act(async () => gate.resolve('first'))
    expect(result.current.loading).toBe(false)
    expect(result.current.snapshot).toBe('first')
    expect(loadSnapshot).toHaveBeenCalledTimes(1)
    expect(loadSnapshot).toHaveBeenCalledWith(channel)
  })

  it('background refresh keeps last-good content visible — never regresses to loading', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const loadSnapshot = vi
      .fn<(c: typeof channel) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useDoorSnapshot(channel, { loadSnapshot }))
    await act(async () => first.resolve('first'))

    let refreshDone: Promise<void>
    act(() => {
      refreshDone = result.current.refresh()
    })
    // Mid-refresh: last-good snapshot still on screen, no loading surface.
    expect(result.current.loading).toBe(false)
    expect(result.current.snapshot).toBe('first')

    await act(async () => {
      second.resolve('second')
      await refreshDone
    })
    expect(result.current.snapshot).toBe('second')
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
  })

  it('first-read error settles into the empty/error fallback (snapshot null, not loading)', async () => {
    const gate = deferred<string>()
    const loadSnapshot = vi.fn(() => gate.promise)
    const { result } = renderHook(() => useDoorSnapshot(channel, { loadSnapshot }))

    await act(async () => gate.reject(new Error('ipc down')))
    expect(result.current.loading).toBe(false)
    expect(result.current.snapshot).toBeNull()
  })

  it('failed background refresh keeps the last-good snapshot', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const loadSnapshot = vi
      .fn<(c: typeof channel) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useDoorSnapshot(channel, { loadSnapshot }))
    await act(async () => first.resolve('first'))

    await act(async () => {
      const refreshDone = result.current.refresh()
      second.reject(new Error('refresh failed'))
      await refreshDone
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.snapshot).toBe('first')
  })

  it('missing channel (bridge absent) settles without ever calling the loader', async () => {
    const loadSnapshot = vi.fn(() => Promise.resolve('never'))
    const { result } = renderHook(() => useDoorSnapshot(null, { loadSnapshot }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.snapshot).toBeNull()
    expect(loadSnapshot).not.toHaveBeenCalled()
  })

  it('refreshOnMount: false leaves the read to the caller', async () => {
    const loadSnapshot = vi.fn(() => Promise.resolve('manual'))
    const { result } = renderHook(() =>
      useDoorSnapshot(channel, { loadSnapshot, refreshOnMount: false })
    )
    expect(loadSnapshot).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.snapshot).toBe('manual')
  })
})

describe('useNotesDoorSnapshot (through the window.moss seam)', () => {
  it('reads notes.getDoorSnapshot off the mocked bridge', async () => {
    const snapshot: NotesDoorSnapshot = {
      pinnedNote: { id: 'n1', title: 'Groceries' },
      openTaskCount: 3,
      lastEdited: { id: 'n2', title: 'Journal', updatedAt: '2026-07-14T08:00:00.000Z' },
      checklistProgress: { done: 1, total: 4, noteTitle: 'Groceries' }
    }
    const getDoorSnapshot = vi.fn(async () => snapshot)
    installMossMock({ notes: { getDoorSnapshot } })

    const { result } = renderHook(() => useNotesDoorSnapshot())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.snapshot).toEqual(snapshot)
    expect(getDoorSnapshot).toHaveBeenCalledTimes(1)
  })
})
