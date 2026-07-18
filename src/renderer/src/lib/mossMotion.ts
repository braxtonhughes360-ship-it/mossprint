import type { Transition, Variants } from 'motion/react'

/**
 * MOSS motion vocabulary — motion/react for micro-interactions only.
 * Route transitions: React Router `viewTransition` + CSS View Transitions API.
 */

export const MOSS_EASE_EDITORIAL = [0.16, 1, 0.3, 1] as const

export const MOSS_DURATION = {
  micro: 0.16,
  hover: 0.16,
  active: 0.08,
  nav: 0.28,
  door: 0.26,
  digit: 0.16,
  flip: 0.4,
  heroItem: 0.26,
  countUp: 0.42,
  modal: 0.32,
  listStagger: 0.24,
  panelFade: 0.16
} as const

export const MOSS_STAGGER = {
  list: 0.05,
  door: 0.05
} as const

/** Shared spring presets — Watermelon cohesion: one physics vocabulary app-wide. */
export const MOSS_SPRING = {
  /** Tactile press / chip tap — quick settle, no bounce */
  press: { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.7 },
  /** In-module tab / panel — quick editorial settle, no decorative bounce */
  panel: { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.8 },
  /** Modal / overlay panel — soft entrance, minimal overshoot */
  modal: { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.85 }
} as const

export type MossMotionTier = 'full' | 'reduced' | 'off'

/** Nav pill slide — high damping, no overshoot bounce */
export const mossNavIndicatorTransition = (motionEnabled: boolean): Transition =>
  motionEnabled
    ? { type: 'spring', stiffness: 420, damping: 34, mass: 0.85 }
    : { duration: 0 }

export const mossNavLabelTransition = (motionEnabled: boolean): Transition =>
  motionEnabled
    ? { duration: MOSS_DURATION.nav, ease: MOSS_EASE_EDITORIAL }
    : { duration: 0 }

export const mossPressSpring = (motionEnabled: boolean): Transition =>
  motionEnabled ? MOSS_SPRING.press : { duration: 0 }

export const mossModalSpring = (motionEnabled: boolean): Transition =>
  motionEnabled ? MOSS_SPRING.modal : { duration: 0 }

export const mossDoorVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: index * MOSS_STAGGER.door,
      duration: MOSS_DURATION.door,
      ease: MOSS_EASE_EDITORIAL
    }
  })
}

export const mossDigitTransition: Transition = {
  duration: MOSS_DURATION.digit,
  ease: MOSS_EASE_EDITORIAL
}

/** Split-flap digit fold — rotateX hinge for the hero flip clock (full motion only). */
export const mossFlipTransition: Transition = {
  duration: MOSS_DURATION.flip,
  ease: MOSS_EASE_EDITORIAL
}

/** Modal backdrop — fade only */
export const mossModalBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
}

/** Modal panel — scale + lift only; never fade opacity (stalls invisible in Electron). */
export const mossModalPanelVariants: Variants = {
  hidden: { scale: 0.98, y: 8 },
  visible: { scale: 1, y: 0 }
}

/** List/grid container — orchestrates child stagger */
export const mossListStaggerContainerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: MOSS_STAGGER.list,
      delayChildren: 0
    }
  }
}

/** List/grid row — y:8→0 fade-in, used with mossListStaggerContainerVariants */
export const mossListStaggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: MOSS_DURATION.listStagger,
      ease: MOSS_EASE_EDITORIAL
    }
  }
}

/** Reduced-motion list row — keep the entrance cue, remove spatial movement. */
export const mossListFadeItemVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: MOSS_DURATION.listStagger,
      ease: MOSS_EASE_EDITORIAL
    }
  }
}

/** In-module panel transition. Reduced fades only; Off resolves synchronously. */
export function mossPanelVariants(tier: MossMotionTier): Variants {
  if (tier === 'off') {
    return {
      hidden: { opacity: 1 },
      visible: { opacity: 1, transition: { duration: 0 } },
      exit: { opacity: 1, transition: { duration: 0 } }
    }
  }

  if (tier === 'reduced') {
    return {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: { duration: MOSS_DURATION.panelFade, ease: MOSS_EASE_EDITORIAL }
      },
      exit: {
        opacity: 0,
        transition: { duration: MOSS_DURATION.active, ease: MOSS_EASE_EDITORIAL }
      }
    }
  }

  return {
    hidden: { opacity: 0, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        opacity: { duration: MOSS_DURATION.panelFade, ease: MOSS_EASE_EDITORIAL },
        y: MOSS_SPRING.panel
      }
    },
    exit: {
      opacity: 0,
      y: -4,
      transition: { duration: MOSS_DURATION.active, ease: MOSS_EASE_EDITORIAL }
    }
  }
}
