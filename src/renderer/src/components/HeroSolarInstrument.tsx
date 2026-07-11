import { useEffect, useMemo, useState } from 'react'
import { m } from 'motion/react'
import { getHeroTimeParts, HeroFlipClock } from './HeroFlipClock'
import { useMotionGates } from '../hooks/useMotionGates'
import { MOSS_EASE_EDITORIAL } from '../lib/mossMotion'
import { fetchUvSnapshot, type UvSnapshot } from '../lib/heroUv'
import {
  FALLBACK_COORDS,
  getDaylightProgress,
  getMoonSnapshot,
  getNightProgress,
  getNightWindow,
  getSolarSchedule,
  getSunAltitude,
  sunTimeFormatter,
  type Coordinates
} from '../lib/heroSolar'

interface HeroSolarInstrumentProps {
  motionEnabled?: boolean
  enterClassName?: string
}

/** Hero right column — flip clock + sun arc + next solar event. */
export function HeroSolarInstrument({
  motionEnabled = true,
  enterClassName = ''
}: HeroSolarInstrumentProps): React.JSX.Element {
  const { motionEnabled: motionGate, presenceEnabled } = useMotionGates()
  const flipMotion = motionEnabled && motionGate
  const [coords, setCoords] = useState<Coordinates>(FALLBACK_COORDS)
  const [now, setNow] = useState(() => new Date())
  const [uv, setUv] = useState<UvSnapshot | null>(null)
  // One-shot entrance: the arc fills + the sun eases into place on first paint,
  // then tracks instantly (no looping). Disabled outside full motion.
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => undefined,
      { maximumAge: 600_000, timeout: 5000 }
    )
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadUv(): Promise<void> {
      try {
        const snapshot = await fetchUvSnapshot(coords)
        if (!cancelled) setUv(snapshot)
      } catch {
        if (!cancelled) setUv(null)
      }
    }

    loadUv()
    const id = window.setInterval(loadUv, 30 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [coords.lat, coords.lng])

  useEffect(() => {
    // 1Hz tick drives the seconds column — but only while the document is
    // visible. Hidden (minimized/other desktop), each tick still cost a
    // layout + style recalc for a clock nobody sees; visibilitychange resyncs
    // immediately on re-show so the face is never stale. document.hidden only
    // — a visible-but-unfocused window keeps ticking.
    let id: number | null = null
    const tick = (): void => setNow(new Date())
    const start = (): void => {
      if (id === null) id = window.setInterval(tick, 1000)
    }
    const stop = (): void => {
      if (id !== null) {
        window.clearInterval(id)
        id = null
      }
    }
    const onVisibility = (): void => {
      if (document.hidden) {
        stop()
      } else {
        tick()
        start()
      }
    }
    tick()
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!presenceEnabled) {
      setEntered(true)
      return
    }
    const id = window.setTimeout(() => setEntered(true), 950)
    return () => window.clearTimeout(id)
  }, [presenceEnabled])

  const schedule = useMemo(() => getSolarSchedule(now, coords), [now, coords])
  const dayProgress = getDaylightProgress(now, schedule)
  const nightProgress = useMemo(() => getNightProgress(now, coords), [now, coords])
  const nightWindow = useMemo(() => getNightWindow(now, coords), [now, coords])
  const altitude = getSunAltitude(now, coords)
  const isDay = altitude > 0
  const moon = useMemo(() => getMoonSnapshot(now), [now])
  const timeParts = useMemo(() => getHeroTimeParts(now), [now])

  // The arc's edge labels already name the tracked events with times, so the
  // meta line only carries what the arc can't show: UV by day, moon by night.
  const uvShort = isDay && uv && uv.current != null ? `UV ${uv.current}` : null
  const metaLine = isDay
    ? uvShort
    : `${moon.phaseLabel} · ${Math.round(moon.fraction * 100)}%`

  // Arc endpoints follow the tracked span: sunrise → sunset by day, the
  // bounding sunset → sunrise across the night.
  const edgeStart = isDay
    ? { label: 'Sunrise', time: schedule.sunrise }
    : { label: 'Sunset', time: nightWindow.start }
  const edgeEnd = isDay
    ? { label: 'Sunset', time: schedule.sunset }
    : { label: 'Sunrise', time: nightWindow.end }

  // Curve geometry — a sine "sun path" that crosses the horizon (day hump above,
  // short twilight tails dipping below), like the iOS sunrise/sunset widget.
  const width = 280
  const height = 100
  const padX = 24
  const horizonY = 56
  const amplitude = 42
  const sunriseX = padX
  const sunsetX = width - padX
  const span = sunsetX - sunriseX

  const curveY = (x: number): number =>
    horizonY - amplitude * Math.sin((Math.PI * (x - sunriseX)) / span)

  const sinePath = (fromX: number, toX: number): string => {
    const steps = 48
    let d = ''
    for (let i = 0; i <= steps; i += 1) {
      const x = fromX + ((toX - fromX) * i) / steps
      d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${curveY(x).toFixed(1)} `
    }
    return d.trim()
  }

  const arcProgress = isDay ? dayProgress : nightProgress
  const bodyX = sunriseX + arcProgress * span
  const bodyY = horizonY - amplitude * Math.sin(Math.PI * arcProgress)

  const trackD = sinePath(6, width - 6)
  const litD = sinePath(sunriseX, Math.max(sunriseX + 0.5, bodyX))

  const entranceTransition =
    presenceEnabled && !entered
      ? { duration: 0.9, ease: MOSS_EASE_EDITORIAL }
      : { duration: 0 }

  // Lit crescent: a bright disc offset within the moon outline reveals the lit side
  // (waxing → right). Full = aligned; new = offset clear of the disc.
  const moonR = 5
  const moonLitX = bodyX + (moon.waxing ? 1 : -1) * (1 - moon.fraction) * moonR * 2

  return (
    <aside
      className={['hero-solar-instrument', enterClassName].filter(Boolean).join(' ')}
      aria-label="Local time and daylight"
    >
      <p className="hero-solar-label">Time</p>

      <HeroFlipClock parts={timeParts} motionEnabled={flipMotion} />

      <svg
        className="hero-solar-arc"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden
      >
        <defs>
          <linearGradient id="heroSolarDay" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className="hero-solar-grad-dawn" />
            <stop offset="0.45" className="hero-solar-grad-noon" />
            <stop offset="1" className="hero-solar-grad-dusk" />
          </linearGradient>
          <radialGradient id="heroSunGlow">
            <stop offset="0" className="hero-solar-glow-core" />
            <stop offset="1" className="hero-solar-glow-edge" />
          </radialGradient>
          <clipPath id="heroMoonClip">
            <circle cx={bodyX} cy={bodyY} r={moonR} />
          </clipPath>
        </defs>

        <line className="hero-solar-horizon" x1={4} y1={horizonY} x2={width - 4} y2={horizonY} />
        <path className="hero-solar-arc-path" d={trackD} fill="none" />

        <m.path
          className={['hero-solar-arc-fill', isDay ? '' : 'hero-solar-arc-fill--night']
            .filter(Boolean)
            .join(' ')}
          d={litD}
          fill="none"
          style={isDay ? { stroke: 'url(#heroSolarDay)' } : undefined}
          initial={presenceEnabled ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={entranceTransition}
        />

        {isDay ? (
          <m.g
            initial={presenceEnabled ? { x: sunriseX, y: horizonY } : false}
            animate={{ x: bodyX, y: bodyY }}
            transition={entranceTransition}
          >
            <circle className="hero-solar-sun-glow" r={15} />
            <circle className="hero-solar-sun hero-solar-sun--day" r={4.5} />
          </m.g>
        ) : (
          <m.g
            initial={presenceEnabled ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={entranceTransition}
          >
            <circle className="hero-solar-moon-halo" cx={bodyX} cy={bodyY} r={11} />
            <g clipPath="url(#heroMoonClip)">
              <circle className="hero-solar-moon-dim" cx={bodyX} cy={bodyY} r={moonR} />
              <circle className="hero-solar-moon" cx={moonLitX} cy={bodyY} r={moonR} />
            </g>
          </m.g>
        )}

        <text className="hero-solar-edge-label" x={padX} y={horizonY + 20} textAnchor="start">
          {edgeStart.label}
        </text>
        <text className="hero-solar-edge-time" x={padX} y={horizonY + 34} textAnchor="start">
          {sunTimeFormatter.format(edgeStart.time)}
        </text>
        <text
          className="hero-solar-edge-label"
          x={width - padX}
          y={horizonY + 20}
          textAnchor="end"
        >
          {edgeEnd.label}
        </text>
        <text className="hero-solar-edge-time" x={width - padX} y={horizonY + 34} textAnchor="end">
          {sunTimeFormatter.format(edgeEnd.time)}
        </text>
      </svg>

      {metaLine ? <p className="hero-solar-meta">{metaLine}</p> : null}
    </aside>
  )
}
