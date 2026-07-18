import { MossSkeleton } from './MossSkeleton'

interface DashboardDoorSkeletonProps {
  density?: 'featured' | 'accent' | 'secondary'
  label: string
}

/** Reserves the glance region while a door's first snapshot is unavailable. */
export function DashboardDoorSkeleton({
  density = 'secondary',
  label
}: DashboardDoorSkeletonProps): React.JSX.Element {
  return (
    <div
      className={`dashboard-door-skeleton dashboard-door-skeleton--${density}`}
      aria-busy="true"
      aria-label={`Loading ${label} snapshot`}
    >
      <MossSkeleton width={density === 'featured' ? '24%' : '34%'} />
      <MossSkeleton width={density === 'secondary' ? '78%' : '64%'} />
      {density !== 'secondary' ? (
        <MossSkeleton variant="block" height="0.375rem" />
      ) : null}
      <MossSkeleton width={density === 'accent' ? '46%' : '38%'} />
    </div>
  )
}
