/** In-memory unlock throttling — cleared on app quit. */

interface AttemptState {
  failures: number
  lockedUntil: number
}

const attempts = new Map<string, AttemptState>()

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 60_000

export function clearUnlockAttempts(profileId: string): void {
  attempts.delete(profileId)
}

export function getUnlockDelayMs(profileId: string): number {
  const state = attempts.get(profileId)
  if (!state) return 0
  const remaining = state.lockedUntil - Date.now()
  return remaining > 0 ? remaining : 0
}

export function assertUnlockAllowed(profileId: string): void {
  const delayMs = getUnlockDelayMs(profileId)
  if (delayMs > 0) {
    const seconds = Math.ceil(delayMs / 1000)
    throw new Error(`Too many tries. Wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`)
  }
}

export async function enforceUnlockDelay(profileId: string): Promise<void> {
  const delayMs = getUnlockDelayMs(profileId)
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

export function recordFailedUnlock(profileId: string): void {
  const state = attempts.get(profileId) ?? { failures: 0, lockedUntil: 0 }
  state.failures += 1
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(state.failures - 1, 6))
  state.lockedUntil = Date.now() + delay
  attempts.set(profileId, state)
}
