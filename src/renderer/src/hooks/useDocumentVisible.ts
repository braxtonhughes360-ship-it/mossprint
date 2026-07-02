import { useEffect, useState } from 'react'

/** False when tab hidden or window blurred — pauses ambient GPU drift per §4 perf contract. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden)

  useEffect(() => {
    const sync = (): void => setVisible(!document.hidden && document.hasFocus())
    const onVis = (): void => sync()
    const onFocus = (): void => setVisible(true)
    const onBlur = (): void => setVisible(false)

    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    sync()

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return visible
}
