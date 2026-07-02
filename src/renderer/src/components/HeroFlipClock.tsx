import { AnimatePresence, motion } from 'motion/react'
import { mossFlipTransition } from '../lib/mossMotion'

interface TimeParts {
  hour: string
  minute: string
  second: string
  dayPeriod?: string
}

export function getHeroTimeParts(date: Date): TimeParts {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date)

  return {
    hour: parts.find((part) => part.type === 'hour')?.value ?? '00',
    minute: parts.find((part) => part.type === 'minute')?.value ?? '00',
    second: parts.find((part) => part.type === 'second')?.value ?? '00',
    dayPeriod: parts.find((part) => part.type === 'dayPeriod')?.value
  }
}

interface FlipDigitProps {
  digit: string
  motionEnabled: boolean
  size?: 'main' | 'seconds'
}

function FlipDigit({
  digit,
  motionEnabled,
  size = 'main'
}: FlipDigitProps): React.JSX.Element {
  const sizeClass = size === 'seconds' ? 'flip-digit--seconds' : ''

  if (!motionEnabled) {
    return (
      <span className={['flip-digit', 'flip-digit--static', sizeClass].filter(Boolean).join(' ')}>
        {digit}
      </span>
    )
  }

  // Split-flap fold: the outgoing face hinges down and away while the incoming
  // face unfolds from the top a beat later. Seconds fold too — the full
  // split-flap effect (operator call, 2026-07-02). transform/opacity only.
  return (
    <span className={['flip-digit', 'flip-digit--fold', sizeClass].filter(Boolean).join(' ')}>
      <AnimatePresence mode="sync" initial={false}>
        <motion.span
          key={digit}
          className="flip-digit-face"
          initial={{ rotateX: 90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1, transition: { ...mossFlipTransition, delay: 0.1 } }}
          exit={{ rotateX: -90, opacity: 0, transition: mossFlipTransition }}
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

interface HeroFlipClockProps {
  parts: TimeParts
  motionEnabled: boolean
}

/** Flip-digit hero clock — shared by solar instrument and legacy daylight band. */
export function HeroFlipClock({ parts, motionEnabled }: HeroFlipClockProps): React.JSX.Element {
  return (
    <div className="hero-flip-clock" aria-live="polite" aria-label="Current time">
      <span className="hero-flip-main">
        <span className="hero-flip-group">
          {parts.hour.split('').map((digit, index) => (
            <FlipDigit key={`hour-${index}`} digit={digit} motionEnabled={motionEnabled} />
          ))}
        </span>
        <span className="hero-flip-sep" aria-hidden>
          :
        </span>
        <span className="hero-flip-group">
          {parts.minute.split('').map((digit, index) => (
            <FlipDigit key={`minute-${index}`} digit={digit} motionEnabled={motionEnabled} />
          ))}
        </span>
        {parts.dayPeriod ? <span className="hero-flip-period">{parts.dayPeriod}</span> : null}
      </span>
      <span className="hero-flip-seconds" aria-label={`${parts.second} seconds`}>
        {parts.second.split('').map((digit, index) => (
          <FlipDigit
            key={`second-${index}`}
            digit={digit}
            motionEnabled={motionEnabled}
            size="seconds"
          />
        ))}
      </span>
    </div>
  )
}
