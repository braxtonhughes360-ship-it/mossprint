import type { LocalAiDownloadState } from '@shared/localai'
import { LOCALAI_MODEL_DOWNLOAD_GB } from '@shared/localai'
import { MossButton } from './MossButton'
import { MossToolbar } from './MossToolbar'

export function localAiDownloadPercent(download: LocalAiDownloadState): number {
  if (download.totalBytes <= 0) return 0
  return Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100))
}

/**
 * Bundled-helper consent + one-time download — the ONE copy of this card.
 * Settings (LocalAiPanel) and the setup wizard both render it; consent
 * semantics and the ~size line must never fork between the two.
 */
export function LocalAiConsentCard({
  download,
  onAccept,
  onLater,
  onRetry,
  offerHint,
  downloadingNote
}: {
  download: LocalAiDownloadState | null | undefined
  onAccept: () => void
  onLater: () => void
  onRetry: () => void
  /** Extra context line under the offer copy (e.g. wizard: download runs in background). */
  offerHint?: string
  /** Replaces the default "keep using MOSS while this finishes" progress note. */
  downloadingNote?: string
}): React.JSX.Element {
  const downloading = download?.status === 'downloading' || download?.status === 'verifying'

  if (download?.status === 'error') {
    return (
      <div className="settings-stack settings-stack-tight">
        <p className="settings-card-copy" role="alert">
          {download.error}
        </p>
        <MossToolbar label="Download actions" className="settings-actions">
          <MossToolbar.Group label="Retry">
            <MossButton tone="neutral" onClick={onRetry}>
              Try again
            </MossButton>
          </MossToolbar.Group>
        </MossToolbar>
      </div>
    )
  }

  if (downloading) {
    return (
      <div className="settings-stack settings-stack-tight">
        <p className="settings-card-copy" role="status">
          {download?.status === 'verifying'
            ? 'Checking the download…'
            : `Downloading the smart parsing helper — ${localAiDownloadPercent(download!)}%`}
        </p>
        <div
          className="settings-download-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={localAiDownloadPercent(download!)}
        >
          <span
            className="settings-download-fill"
            style={{ width: `${localAiDownloadPercent(download!)}%` }}
          />
        </div>
        <p className="settings-card-copy settings-card-note">
          {downloadingNote ??
            'You can keep using MOSS while this finishes. It resumes on its own if the connection drops.'}
        </p>
      </div>
    )
  }

  return (
    <div className="settings-stack settings-stack-tight">
      <p className="settings-card-copy">
        Smart parsing needs a one-time helper download (~{LOCALAI_MODEL_DOWNLOAD_GB}GB).
        Everything stays on this computer — no account, no cloud, no setup.
      </p>
      {offerHint && <p className="settings-card-copy settings-card-note">{offerHint}</p>}
      <MossToolbar label="Smart parsing download choices" className="settings-actions">
        <MossToolbar.Group label="Download">
          <MossButton onClick={onAccept}>Download the helper</MossButton>
          <MossButton tone="neutral" onClick={onLater}>
            Later
          </MossButton>
        </MossToolbar.Group>
      </MossToolbar>
    </div>
  )
}
