import * as Select from '@radix-ui/react-select'

export interface MossSelectOption {
  value: string
  label: string
}

interface MossSelectProps {
  value: string
  options: MossSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  /** Extra classes for the wrapper (sizing/layout in its form context). */
  className?: string
}

// Radix Select reserves the empty string for "no value / show placeholder" and
// throws on an empty-string <Select.Item>. Several callers legitimately use
// value: '' for "All / No / Other" options, so map it to a sentinel internally
// and translate back at the boundary — the public API keeps plain '' values.
const EMPTY_SENTINEL = '__moss_select_empty__'
const toRadix = (value: string): string => (value === '' ? EMPTY_SENTINEL : value)
const fromRadix = (value: string): string => (value === EMPTY_SENTINEL ? '' : value)

/**
 * MOSS's own pop-out dropdown — a styled, accessible replacement for the native
 * <select>. Native selects render an OS-drawn menu (inconsistent on macOS, and
 * different again on Windows), and on our tinted surfaces the closed value can
 * read as blank. This keeps one calm, on-brand control that looks identical
 * everywhere we ship.
 *
 * Built on Radix Select (7-0 Radix-under-skins): Radix supplies listbox
 * semantics, typeahead, keyboard nav, and portalled Popper positioning (no more
 * clipping inside overflow:hidden panels); every visual is our own class.
 */
export function MossSelect({
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled = false,
  ariaLabel,
  className
}: MossSelectProps): React.JSX.Element {
  const hasSelection = options.some((option) => option.value === value)

  return (
    <Select.Root
      value={toRadix(value)}
      onValueChange={(next) => onChange(fromRadix(next))}
      disabled={disabled}
    >
      <div className={['moss-select', className].filter(Boolean).join(' ')}>
        <Select.Trigger
          className={[
            'moss-select-trigger',
            hasSelection ? '' : 'moss-select-trigger--placeholder'
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={ariaLabel}
        >
          <span className="moss-select-value">
            <Select.Value placeholder={placeholder} />
          </span>
          <Select.Icon className="moss-select-chevron">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Select.Icon>
        </Select.Trigger>
      </div>

      <Select.Portal>
        <Select.Content className="moss-select-pop" position="popper" sideOffset={4}>
          <Select.Viewport>
            {options.map((option, index) => (
              <Select.Item
                key={option.value || `__empty-${index}`}
                value={toRadix(option.value)}
                className="moss-select-option"
              >
                <Select.ItemText>
                  <span className="moss-select-option-label">{option.label}</span>
                </Select.ItemText>
                <Select.ItemIndicator className="moss-select-option-check">✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
