import { memo } from 'react'
import type { WeeklyScoreSnapshot } from '@shared/weeklyScore'

interface DashboardWeeklyScoreCardProps {
  snapshot: WeeklyScoreSnapshot | null
  loading?: boolean
}

export const DashboardWeeklyScoreCard = memo(function DashboardWeeklyScoreCard({
  snapshot,
  loading = false
}: DashboardWeeklyScoreCardProps): React.JSX.Element {
  const ready = snapshot?.status === 'ready' && snapshot.score !== null

  return (
    <section
      className="dashboard-weekly-score"
      aria-label="Weekly score"
      data-status={snapshot?.status ?? 'loading'}
    >
      <header className="dashboard-weekly-score-head">
        <div>
          <p className="dashboard-weekly-score-kicker nutrition-mono">This week</p>
          <h2 className="dashboard-weekly-score-title">Weekly score</h2>
        </div>
        {ready ? (
          <p className="dashboard-weekly-score-value" aria-live="polite">
            {snapshot.score}
          </p>
        ) : (
          <p className="dashboard-weekly-score-value dashboard-weekly-score-value--empty">
            —
          </p>
        )}
      </header>

      {loading && !snapshot ? (
        <p className="dashboard-weekly-score-hint">Loading…</p>
      ) : !snapshot ? (
        <p className="dashboard-weekly-score-hint">Score unavailable.</p>
      ) : ready ? (
        <>
          <p className="dashboard-weekly-score-hint">{snapshot.hint}</p>
          <ul className="dashboard-weekly-score-pillars">
            {snapshot.pillars
              .filter((pillar) => pillar.trustworthy)
              .map((pillar) => (
                <li key={pillar.id} className="dashboard-weekly-score-pillar">
                  <span className="dashboard-weekly-score-pillar-label">{pillar.label}</span>
                  <span className="dashboard-weekly-score-pillar-value nutrition-mono">
                    {pillar.score}
                  </span>
                  <span className="dashboard-weekly-score-pillar-summary">{pillar.summary}</span>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <>
          <p className="dashboard-weekly-score-empty-title">Insufficient data</p>
          <p className="dashboard-weekly-score-hint">{snapshot.hint}</p>
          <ul className="dashboard-weekly-score-pillars">
            {snapshot.pillars.map((pillar) => (
              <li
                key={pillar.id}
                className={[
                  'dashboard-weekly-score-pillar',
                  pillar.trustworthy ? 'dashboard-weekly-score-pillar--ready' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="dashboard-weekly-score-pillar-label">{pillar.label}</span>
                <span className="dashboard-weekly-score-pillar-value nutrition-mono">
                  {pillar.trustworthy && pillar.score !== null ? pillar.score : '—'}
                </span>
                <span className="dashboard-weekly-score-pillar-summary">{pillar.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}

    </section>
  )
})
