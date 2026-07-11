function newsBridgeError(): string | null {
  if (!window.moss) {
    return 'Open MOSS in the Electron desktop app (npm run dev), not a browser tab alone.'
  }
  if (!window.moss.news) {
    return 'News bridge not loaded — quit MOSS completely, then restart npm run dev (main process must reload after updates).'
  }
  return null
}

export function useNewsBridge(): { ready: boolean; error: string | null } {
  const ready = Boolean(window.moss?.news)
  return { ready, error: ready ? null : newsBridgeError() }
}
