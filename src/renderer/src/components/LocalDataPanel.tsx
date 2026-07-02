import { useCallback, useEffect, useState } from 'react'
import type { DatabaseHealthResult, DatabasePingResult } from '@shared/types'

type LoadState = 'loading' | 'ready' | 'error'

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
          label="Location"
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
    </div>
  )
}

function DataField({
  label,
  value,
  mono = false
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="memory-cell">
      <dt className="index-label">{label}</dt>
      <dd className={mono ? 'mono-data mt-2 break-all' : 'mt-2 text-sm font-medium text-ink'}>
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
