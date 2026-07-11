/**
 * Drop concurrent calls: while one run is in flight, further calls resolve
 * immediately without running. Used for the composer's "Draft with MOSS"
 * request — StrictMode's double mount effect (and Enter-vs-click races)
 * fired two generations that both landed in the body.
 */
export function createSingleFlight(run: () => Promise<void>): () => Promise<void> {
  let active = false
  return async () => {
    if (active) return
    active = true
    try {
      await run()
    } finally {
      active = false
    }
  }
}
