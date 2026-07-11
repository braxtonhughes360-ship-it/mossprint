import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNavPathByOrder } from '@shared/nav'
import { isEditableTarget } from '../lib/isEditableTarget'
import { useMotionGates } from './useMotionGates'

/** Alt+1…6 jumps to nav destinations (invisible in UI). */
export function useNavShortcuts(): void {
  const navigate = useNavigate()
  const { routeTransitionFull } = useMotionGates()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (isEditableTarget(event.target)) return

      const order = Number.parseInt(event.key, 10)
      if (order < 1 || order > 6) return

      const path = getNavPathByOrder(order)
      if (!path) return

      event.preventDefault()
      void navigate(path, { viewTransition: routeTransitionFull })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, routeTransitionFull])
}
