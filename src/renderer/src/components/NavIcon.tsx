import type { AppRouteId } from '@shared/types'

interface NavIconProps {
  id: AppRouteId
  className?: string
}

/**
 * One cohesive nav icon set — consistent 20×20 grid, 1.5 stroke, round joins,
 * and a single filled accent element per icon for presence (duotone). All use
 * currentColor so the active-state accent threads through.
 */
export function NavIcon({ id, className = '' }: NavIconProps): React.JSX.Element {
  const shared = ['moss-nav-glyph-svg', className].filter(Boolean).join(' ')
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    fill: 'none'
  }

  switch (id) {
    case 'dashboard':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <rect x="2.75" y="2.75" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
          <rect x="11.25" y="2.75" width="6" height="6" rx="1.5" {...stroke} />
          <rect x="2.75" y="11.25" width="6" height="6" rx="1.5" {...stroke} />
          <rect x="11.25" y="11.25" width="6" height="6" rx="1.5" {...stroke} />
        </svg>
      )
    case 'calendar':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <rect x="2.75" y="4" width="14.5" height="13.25" rx="2.5" {...stroke} />
          <path d="M2.75 8 H17.25" {...stroke} />
          <path d="M6.5 2.5 V5 M13.5 2.5 V5" {...stroke} />
          <rect x="5.75" y="10.5" width="3.25" height="3.25" rx="0.9" fill="currentColor" opacity="0.9" />
        </svg>
      )
    case 'money':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <rect x="2.5" y="5" width="15" height="10" rx="2.25" {...stroke} />
          <circle cx="10" cy="10" r="2.5" fill="currentColor" opacity="0.9" />
          <circle cx="5" cy="10" r="0.85" fill="currentColor" opacity="0.5" />
          <circle cx="15" cy="10" r="0.85" fill="currentColor" opacity="0.5" />
        </svg>
      )
    case 'nutrition':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <path
            d="M10 6.5 C10 6.5 8.5 3.5 5.5 3.8 C5 6 6 7 7.5 7.2"
            {...stroke}
            opacity="0.6"
          />
          <path
            d="M10 6.3 C12 4.8 14.6 5 16 6.4 C17.4 7.8 17.2 10.4 15.4 13 C13.8 15.3 11.6 17 10 17 C8.4 17 6.2 15.3 4.6 13 C2.8 10.4 2.6 7.8 4 6.4 C5.4 5 8 4.8 10 6.3 Z"
            {...stroke}
            fill="currentColor"
            fillOpacity="0.14"
          />
        </svg>
      )
    case 'inbox':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <rect x="2.75" y="4.5" width="14.5" height="11" rx="2.25" {...stroke} />
          <path d="M3.25 6 L10 10.75 L16.75 6" {...stroke} opacity="0.6" />
          <circle cx="10" cy="13" r="1.1" fill="currentColor" opacity="0.9" />
        </svg>
      )
    case 'notes':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <rect x="4.5" y="2.75" width="11" height="14.5" rx="2" {...stroke} />
          <path d="M7 6.5 H13 M7 10 H13 M7 13.5 H10.5" {...stroke} opacity="0.75" />
          <rect x="7" y="6" width="6" height="1.25" rx="0.4" fill="currentColor" opacity="0.9" />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 20 20" className={shared} aria-hidden>
          <path d="M4 6.25 H16" {...stroke} />
          <path d="M4 13.75 H16" {...stroke} />
          <circle cx="7.25" cy="6.25" r="2.1" fill="currentColor" stroke="var(--moss-chassis-bg, currentColor)" strokeWidth="1" />
          <circle cx="12.75" cy="13.75" r="2.1" fill="currentColor" stroke="var(--moss-chassis-bg, currentColor)" strokeWidth="1" />
        </svg>
      )
    default:
      return <span className={shared} />
  }
}
