import { describe, expect, it, vi } from 'vitest'
import {
  POWER_LOCK_SIGNALS,
  createPowerLockBinding,
  type PowerLockSignal,
  type PowerMonitorLike
} from '../src/main/powerLock'

/** Minimal fake powerMonitor that records subscriptions and can emit. */
function fakeMonitor(): PowerMonitorLike & {
  emit(signal: string): void
  listenerCount(signal: string): number
} {
  const listeners = new Map<string, Array<() => void>>()
  return {
    on(event: PowerLockSignal, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return this
    },
    removeListener(event: PowerLockSignal, listener: () => void) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((entry) => entry !== listener)
      )
      return this
    },
    emit(signal: string) {
      for (const listener of listeners.get(signal) ?? []) listener()
    },
    listenerCount(signal: string) {
      return (listeners.get(signal) ?? []).length
    }
  }
}

function deps(passwordActive: boolean) {
  return {
    isPasswordProfileActive: vi.fn(() => passwordActive),
    lock: vi.fn(),
    notify: vi.fn()
  }
}

describe('power lock signals', () => {
  it('covers exactly suspend and lock-screen — never display-sleep', () => {
    expect([...POWER_LOCK_SIGNALS]).toEqual(['suspend', 'lock-screen'])
  })

  it('attach subscribes to both exit signals and nothing else', () => {
    const monitor = fakeMonitor()
    createPowerLockBinding(deps(true)).attach(monitor)
    expect(monitor.listenerCount('suspend')).toBe(1)
    expect(monitor.listenerCount('lock-screen')).toBe(1)
    expect(monitor.listenerCount('shutdown')).toBe(0)
    expect(monitor.listenerCount('resume')).toBe(0)
  })
})

describe('power lock behavior', () => {
  it('locks and notifies immediately for a password-enabled profile', () => {
    const monitor = fakeMonitor()
    const d = deps(true)
    createPowerLockBinding(d).attach(monitor)

    monitor.emit('lock-screen')
    expect(d.lock).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledTimes(1)
    // Lock must land before the renderer is told it happened.
    expect(d.lock.mock.invocationCallOrder[0]!).toBeLessThan(
      d.notify.mock.invocationCallOrder[0]!
    )

    monitor.emit('suspend')
    expect(d.lock).toHaveBeenCalledTimes(2)
  })

  it('never locks a password-less (or absent) profile', () => {
    const monitor = fakeMonitor()
    const d = deps(false)
    createPowerLockBinding(d).attach(monitor)

    monitor.emit('suspend')
    monitor.emit('lock-screen')
    expect(d.isPasswordProfileActive).toHaveBeenCalledTimes(2)
    expect(d.lock).not.toHaveBeenCalled()
    expect(d.notify).not.toHaveBeenCalled()
  })

  it('re-checks the profile at signal time, not attach time', () => {
    const monitor = fakeMonitor()
    let passwordActive = false
    const lock = vi.fn()
    const notify = vi.fn()
    createPowerLockBinding({
      isPasswordProfileActive: () => passwordActive,
      lock,
      notify
    }).attach(monitor)

    monitor.emit('suspend')
    expect(lock).not.toHaveBeenCalled()

    passwordActive = true
    monitor.emit('suspend')
    expect(lock).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('detach removes both listeners so re-registering cannot double-fire', () => {
    const monitor = fakeMonitor()
    const d = deps(true)
    const detach = createPowerLockBinding(d).attach(monitor)

    detach()
    expect(monitor.listenerCount('suspend')).toBe(0)
    expect(monitor.listenerCount('lock-screen')).toBe(0)

    monitor.emit('suspend')
    expect(d.lock).not.toHaveBeenCalled()
  })
})
