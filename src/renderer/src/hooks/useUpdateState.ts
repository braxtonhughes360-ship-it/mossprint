import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '@shared/updates'

/**
 * Live view of the app updater (R4). The main process pushes state changes;
 * this hook mirrors them and exposes the three renderer-side actions.
 */
export function useUpdateState(): {
  update: UpdateState | null
  checkNow: () => Promise<void>
  restartAndInstall: () => Promise<void>
  openDownloadPage: () => Promise<void>
} {
  const bridgeReady = Boolean(window.moss?.updates)
  const [update, setUpdate] = useState<UpdateState | null>(null)

  useEffect(() => {
    if (!bridgeReady) return

    let cancelled = false
    void window.moss.updates.getState().then((state) => {
      if (!cancelled) setUpdate(state)
    })
    const unsubscribe = window.moss.updates.onStateChanged((state) => {
      setUpdate(state)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridgeReady])

  const checkNow = useCallback(async (): Promise<void> => {
    if (!bridgeReady) return
    const state = await window.moss.updates.checkNow()
    setUpdate(state)
  }, [bridgeReady])

  const restartAndInstall = useCallback(async (): Promise<void> => {
    if (!bridgeReady) return
    await window.moss.updates.restartAndInstall()
  }, [bridgeReady])

  const openDownloadPage = useCallback(async (): Promise<void> => {
    if (!bridgeReady || !update?.downloadUrl) return
    await window.moss.shell.openExternal(update.downloadUrl)
  }, [bridgeReady, update?.downloadUrl])

  return { update, checkNow, restartAndInstall, openDownloadPage }
}
