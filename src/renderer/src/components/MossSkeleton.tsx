import type { CSSProperties, HTMLAttributes } from 'react'

export type MossSkeletonVariant = 'line' | 'block' | 'thumbnail'

export interface MossSkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  variant?: MossSkeletonVariant
  width?: CSSProperties['width']
  height?: CSSProperties['height']
}

/**
 * Shared content placeholder. The parent owns loading semantics (`aria-busy`
 * and a useful label); this visual primitive stays hidden from assistive tech.
 */
export function MossSkeleton({
  variant = 'line',
  width,
  height,
  className,
  style,
  ...props
}: MossSkeletonProps): React.JSX.Element {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={['moss-skeleton', `moss-skeleton--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...style,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {})
      }}
    />
  )
}
