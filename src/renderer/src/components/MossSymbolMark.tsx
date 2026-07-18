/**
 * Panel badge mark — machined slab, diagonal groove, inset screen (bottom-right).
 * Optimized for 32–36px display; no outer chrome — plate provides the frame.
 */
export function MossSymbolMark(): React.JSX.Element {
  return (
    <svg
      className="moss-mark-svg"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="moss-mark-slab"
        d="M10.5 1.5h18a3.5 3.5 0 0 1 3.5 3.5v19.5a2.5 2.5 0 0 1-2.5 2.5H3.5a2.5 2.5 0 0 1-2.5-2.5V10.5a9 9 0 0 1 9-9z"
      />
      <path
        className="moss-mark-slab-edge"
        d="M10.5 1.5h18a3.5 3.5 0 0 1 3.5 3.5"
        fill="none"
        strokeWidth="0.75"
        strokeLinecap="round"
      />
      <path
        className="moss-mark-groove"
        d="M3 21.5L11 29.5"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
      <rect className="moss-mark-inner" x="15.5" y="16" width="12" height="10" rx="2.25" />
      <rect className="moss-mark-inner-glint" x="16.5" y="17" width="4" height="1.25" rx="0.5" />
    </svg>
  )
}
