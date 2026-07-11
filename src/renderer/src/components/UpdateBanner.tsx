import { useState } from 'react'
import { useUpdateState } from '../hooks/useUpdateState'

function dismissKey(version: string): string {
  return `moss-update-banner-dismissed-${version}`
}

/**
 * Calm one-line strip shown on the dashboard when a new version is waiting —
 * either as a download link (macOS notify path) or a restart prompt
 * (Windows/Linux, already downloaded). Dismissing hides it for the session;
 * Settings → About always keeps the same actions available.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const { update, restartAndInstall, openDownloadPage } = useUpdateState()
  const [dismissed, setDismissed] = useState(false)

  const actionable =
    update?.status === 'update-available' || update?.status === 'ready-to-install'
  if (!update || !actionable || !update.latestVersion) return null
  if (dismissed || sessionStorage.getItem(dismissKey(update.latestVersion))) return null

  const dismiss = (): void => {
    sessionStorage.setItem(dismissKey(update.latestVersion!), '1')
    setDismissed(true)
  }

  const ready = update.status === 'ready-to-install'

  return (
    <div className="update-banner" role="status">
      <p className="update-banner-copy">
        MOSS {update.latestVersion} is {ready ? 'ready' : 'out'} —{' '}
        <button
          type="button"
          className="update-banner-action"
          onClick={() => void (ready ? restartAndInstall() : openDownloadPage())}
        >
          {ready ? 'Restart to update' : 'Download'}
        </button>
      </p>
      <button type="button" className="update-banner-dismiss" onClick={dismiss}>
        Later
      </button>
    </div>
  )
}
