import { vi } from 'vitest'
import type { MossBridge } from '@shared/ipc'

/**
 * The one renderer test seam (W4a): window.moss mocked at the preload boundary.
 *
 * Overrides are typed against MossBridge, so a mock whose shape drifts from the
 * real preload surface fails `npm run lint` (tests/helpers is in tsconfig.web).
 * Any bridge method a test did NOT provide throws with its full path on call —
 * a missing mock surfaces as a loud, named failure instead of silently feeding
 * the component an undefined. Namespace objects are cached so hooks that hold
 * `window.moss.<ns>` in dependency arrays (useDoorSnapshot) see a stable
 * reference across renders.
 */
export type MossMockOverrides = {
  [NS in keyof MossBridge]?: Partial<MossBridge[NS]>
}

export function createMossMock(overrides: MossMockOverrides = {}): MossBridge {
  const namespaces = new Map<PropertyKey, object>()

  const makeNamespace = (ns: PropertyKey): object => {
    const provided = (overrides as Record<PropertyKey, object | undefined>)[ns] ?? {}
    const fallbacks = new Map<PropertyKey, unknown>()
    return new Proxy(provided, {
      get(target, method) {
        if (method in target) return (target as Record<PropertyKey, unknown>)[method]
        if (typeof method === 'symbol' || method === 'then') return undefined
        if (!fallbacks.has(method)) {
          fallbacks.set(
            method,
            vi.fn(() => {
              throw new Error(
                `window.moss.${String(ns)}.${String(method)} was called but not mocked — ` +
                  'add it to the createMossMock/installMossMock overrides for this test'
              )
            })
          )
        }
        return fallbacks.get(method)
      }
    })
  }

  return new Proxy(
    {},
    {
      get(_target, ns) {
        if (typeof ns === 'symbol' || ns === 'then') return undefined
        if (!namespaces.has(ns)) namespaces.set(ns, makeNamespace(ns))
        return namespaces.get(ns)
      }
    }
  ) as MossBridge
}

/** Install the mock bridge on window.moss and hand it back for assertions. */
export function installMossMock(overrides: MossMockOverrides = {}): MossBridge {
  const bridge = createMossMock(overrides)
  window.moss = bridge
  return bridge
}
