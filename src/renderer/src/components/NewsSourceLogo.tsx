import { useState } from 'react'

export interface NewsSourceLogoProps {
  logoUrl?: string | null
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/** Publisher favicon with monogram fallback — widget, reader, and setup. */
export function NewsSourceLogo({
  logoUrl,
  label,
  size = 'sm',
  className = ''
}: NewsSourceLogoProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const fallback = label.trim().charAt(0).toUpperCase() || '?'

  if (!logoUrl || failed) {
    return (
      <span
        className={[
          'news-source-logo-fallback',
          `news-source-logo-fallback--${size}`,
          className
        ]
          .filter(Boolean)
          .join(' ')}
        aria-hidden
      >
        {fallback}
      </span>
    )
  }

  return (
    <img
      className={['news-source-logo', `news-source-logo--${size}`, className].filter(Boolean).join(' ')}
      src={logoUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
