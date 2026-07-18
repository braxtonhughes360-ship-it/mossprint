/**
 * H1 — OS-level lock triggers, kept electron-free so the decision logic is
 * unit-testable (vitest runs node-only; idleLock.ts owns the real wiring).
 *
 * Policy: the machine leaving the user's control ('suspend', 'lock-screen') is
 * exactly when the profile lock matters, so it fires immediately — but only
 * for password-enabled profiles. Password-less profiles never lock (there is
 * nothing to lock behind), and display-sleep alone must NOT lock (too
 * aggressive) — we subscribe to the two exit signals and nothing else.
 */

export const POWER_LOCK_SIGNALS = ['suspend', 'lock-screen'] as const
export type PowerLockSignal = (typeof POWER_LOCK_SIGNALS)[number]

/** Structural subset of Electron's powerMonitor — swappable in tests. */
export interface PowerMonitorLike {
  on(event: PowerLockSignal, listener: () => void): unknown
  removeListener(event: PowerLockSignal, listener: () => void): unknown
}

export interface PowerLockDeps {
  /** True only when the active profile exists AND has a password. */
  isPasswordProfileActive: () => boolean
  /** Revoke the session + close the DB (profiles.lockActiveProfile). */
  lock: () => void
  /** Push the locked event so the renderer lands on the unlock screen. */
  notify: () => void
}

export interface PowerLockBinding {
  /** The signal handler itself — exported for direct unit testing. */
  handleSignal: () => void
  /** Subscribe to both exit signals; returns a detach function. */
  attach: (monitor: PowerMonitorLike) => () => void
}

export function createPowerLockBinding(deps: PowerLockDeps): PowerLockBinding {
  const handleSignal = (): void => {
    if (!deps.isPasswordProfileActive()) return
    deps.lock()
    deps.notify()
  }

  return {
    handleSignal,
    attach(monitor: PowerMonitorLike): () => void {
      for (const signal of POWER_LOCK_SIGNALS) {
        monitor.on(signal, handleSignal)
      }
      return () => {
        for (const signal of POWER_LOCK_SIGNALS) {
          monitor.removeListener(signal, handleSignal)
        }
      }
    }
  }
}
