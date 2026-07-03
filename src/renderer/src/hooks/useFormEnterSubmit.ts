import { useEffect } from 'react'

const SUBMITTABLE_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local'
])

function isSubmitField(element: HTMLElement): boolean {
  if (element.tagName === 'TEXTAREA') {
    return true
  }

  if (element.tagName !== 'INPUT') {
    return false
  }

  const type = (element as HTMLInputElement).type || 'text'
  return SUBMITTABLE_INPUT_TYPES.has(type)
}

/**
 * Desktop-client Enter behavior for Moss forms:
 * - single-line inputs: Enter submits the enclosing form
 * - textarea: Enter submits; Shift+Enter inserts a newline
 *
 * Dispatches a native submit event so React onSubmit runs even when the
 * visible submit button is disabled for empty-state validation.
 */
export function useFormEnterSubmit(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) {
        return
      }

      const target = event.target as HTMLElement
      if (!isSubmitField(target)) {
        return
      }

      if (target.tagName === 'TEXTAREA' && event.shiftKey) {
        return
      }

      const form = target.closest('form')
      if (!form) {
        return
      }

      event.preventDefault()
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
