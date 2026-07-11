import { useCallback, useEffect, useState } from 'react'
import type { DataOverview, DatabaseHealthResult, DatabasePingResult } from '@shared/types'
import { MossConfirmDialog } from './MossConfirmDialog'

type LoadState = 'loading' | 'ready' | 'error'
type MoveState = 'idle' | 'confirm' | 'moving' | 'restarting'

export function LocalDataPanel(): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [ping, setPing] = useState<DatabasePingResult | null>(null)
  const [health, setHealth] = useState<DatabaseHealthResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshPing = useCallback(async () => {
    const result = await window.moss.db.ping()
    setPing(result)
    return result
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const result = await refreshPing()
        if (!cancelled) {
          setLoadState('ready')
          if (!result.value) {
            const initial = await window.moss.db.runHealthCheck()
            if (!cancelled) {
              setHealth(initial)
              await refreshPing()
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadState('error')
          setError(err instanceof Error ? err.message : 'Could not reach local data')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshPing])

  const runHealthCheck = async (): Promise<void> => {
    setRunning(true)
    setError(null)

    try {
      const result = await window.moss.db.runHealthCheck()
      setHealth(result)
      await refreshPing()
      setLoadState('ready')
    } catch (err) {
      setLoadState('error')
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setRunning(false)
    }
  }

  const connected = loadState !== 'error' && (health?.ok || Boolean(ping?.value))

  return (
    <div className="memory-panel mt-6">
      <dl className="memory-grid">
        <DataField label="Status" value={formatStatus(loadState, connected)} />
        <DataField
          label="Last verified"
          value={ping?.updatedAt ? formatTimestamp(ping.updatedAt) : '—'}
          mono
        />
        <DataField label="Record" value={ping?.value ? truncate(ping.value, 32) : '—'} mono />
        <DataField
          label="Active database"
          value={ping?.databasePath ? truncate(ping.databasePath, 40) : '—'}
          mono
        />
      </dl>

      {health && (
        <p
          className={[
            'memory-feedback mt-5',
            health.ok ? 'memory-feedback-ok' : 'memory-feedback-error'
          ].join(' ')}
        >
          {health.ok ? 'Read/write verified.' : health.message}
        </p>
      )}

      {error && <p className="memory-feedback memory-feedback-error mt-5">{error}</p>}

      <div className="memory-actions mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void runHealthCheck()}
          disabled={running}
          className="btn-accent"
        >
          {running ? 'Verifying…' : 'Verify storage'}
        </button>
        <button type="button" onClick={() => void refreshPing()} className="btn-secondary">
          Refresh
        </button>
      </div>

      <YourDataSection />
    </div>
  )
}

/** D1 (QA-18): the real location, sizes, Show in Finder, and the move flow. */
function YourDataSection(): React.JSX.Element {
  const [overview, setOverview] = useState<DataOverview | null>(null)
  const [moveState, setMoveState] = useState<MoveState>('idle')
  const [pendingTarget, setPendingTarget] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [needsReload, setNeedsReload] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setOverview(await window.moss.data.getOverview())
    } catch {
      // the card above already surfaces storage errors
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const chooseFolder = async (): Promise<void> => {
    setMoveError(null)
    const target = await window.moss.data.pickMoveTarget()
    if (!target) return
    setPendingTarget(target)
    setMoveState('confirm')
  }

  const moveBackToDefault = (): void => {
    if (!overview) return
    setMoveError(null)
    setPendingTarget(overview.defaultDataRoot)
    setMoveState('confirm')
  }

  const confirmMove = async (): Promise<void> => {
    if (!pendingTarget) return
    setMoveState('moving')
    try {
      const result = await window.moss.data.moveFolder(pendingTarget)
      if (result.ok) {
        setMoveState('restarting')
      } else {
        setMoveError(result.error)
        setNeedsReload(Boolean(result.locked))
        setMoveState('idle')
        setPendingTarget(null)
        void refresh()
      }
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Move failed — nothing was changed.')
      setNeedsReload(true)
      setMoveState('idle')
      setPendingTarget(null)
    }
  }

  const busy = moveState === 'moving' || moveState === 'restarting'

  return (
    <div className="mt-8">
      <dl className="memory-grid">
        <DataField
          label="Data folder"
          value={overview ? overview.dataRoot : '—'}
          mono
          full
        />
        <DataField
          label="Total size"
          value={overview ? formatBytes(overview.totalBytes) : '—'}
        />
        <DataField
          label="Location"
          value={overview ? (overview.isCustomLocation ? 'Custom folder' : 'Default (app support)') : '—'}
        />
        {overview?.profiles.map((profile) => (
          <DataField
            key={profile.id}
            label={`Profile · ${profile.displayName}`}
            value={formatBytes(profile.bytes)}
          />
        ))}
        <DataField
          label="Smart parsing model"
          value={
            overview
              ? overview.modelBytes > 0
                ? `${formatBytes(overview.modelBytes)}`
                : 'Not downloaded'
              : '—'
          }
        />
        {overview && overview.modelBytes > 0 && (
          <DataField label="Model folder" value={overview.modelDir} mono full />
        )}
      </dl>

      {moveState === 'restarting' && (
        <p className="memory-feedback memory-feedback-ok mt-5">
          Copy verified — MOSS is restarting from the new folder…
        </p>
      )}
      {moveState === 'moving' && (
        <p className="memory-feedback mt-5">
          Moving your data… nothing is deleted until the copy is verified.
        </p>
      )}
      {moveError && <p className="memory-feedback memory-feedback-error mt-5">{moveError}</p>}

      <div className="memory-actions mt-5 flex flex-wrap gap-3">
        {needsReload && (
          <button
            type="button"
            className="btn-accent"
            onClick={() => window.location.reload()}
          >
            Reload MOSS
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void window.moss.data.showInFolder()}
          disabled={busy}
        >
          Show in {isMac() ? 'Finder' : 'file manager'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void chooseFolder()}
          disabled={busy}
        >
          Move data folder…
        </button>
        {overview?.isCustomLocation && (
          <button
            type="button"
            className="btn-secondary"
            onClick={moveBackToDefault}
            disabled={busy}
          >
            Move back to default
          </button>
        )}
      </div>

      {moveState === 'confirm' && pendingTarget && (
        <MossConfirmDialog
          title="Move your data folder?"
          body={
            <>
              MOSS copies everything to{' '}
              <span className="nutrition-mono moss-selectable">{pendingTarget}</span>, verifies
              the copy, then removes the old one and restarts. Your data is never deleted before
              the copy is verified. You&apos;ll unlock your profile again after the restart.
            </>
          }
          confirmLabel="Move & restart"
          onConfirm={() => void confirmMove()}
          onClose={() => {
            setMoveState('idle')
            setPendingTarget(null)
          }}
        />
      )}
    </div>
  )
}

function isMac(): boolean {
  return navigator.platform.toLowerCase().includes('mac')
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`
}

function DataField({
  label,
  value,
  mono = false,
  full = false
}: {
  label: string
  value: string
  mono?: boolean
  /** Span the whole grid row — for long paths that deserve the width. */
  full?: boolean
}): React.JSX.Element {
  return (
    <div className={full ? 'memory-cell sm:col-span-2' : 'memory-cell'}>
      <dt className="index-label">{label}</dt>
      <dd
        className={
          mono
            ? 'mono-data moss-selectable mt-2 break-all'
            : 'mt-2 text-sm font-medium text-ink'
        }
      >
        {value}
      </dd>
    </div>
  )
}

function formatStatus(loadState: LoadState, connected: boolean): string {
  if (loadState === 'loading') return 'Checking'
  if (loadState === 'error') return 'Unavailable'
  return connected ? 'Ready' : 'Awaiting'
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}
