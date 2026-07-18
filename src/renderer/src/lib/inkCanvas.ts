import type { NoteSketchColor, NoteSketchStroke, NoteSketchStrokeWidth } from '@shared/notes'
import {
  catmullRom,
  segmentWidth,
  smoothPressure,
  velocityPressureTarget
} from '@shared/sketchInk'

/**
 * B4 ink rendering — the canvas half of the shared sketch engine. The N3
 * NoteSketchPad and the board's world-layer ink both draw through here, so
 * pen feel (taper, smoothing, palette) is one implementation.
 */

export type SketchPalette = Record<NoteSketchColor, string> & { paper: string }

export const INK_COLOR_LABELS: Record<NoteSketchColor, string> = {
  ink: 'Ink',
  accent: 'Accent',
  mark: 'Magenta'
}

export const INK_WIDTH_LABELS: Record<NoteSketchStrokeWidth, string> = {
  2: 'Fine',
  4: 'Medium',
  8: 'Bold'
}

/**
 * Colors are stored as semantic token names; here they resolve against the live
 * theme so a sketch edited after a theme/accent change re-inks with current tokens.
 */
export function resolveSketchPalette(): SketchPalette {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    ink: read('--moss-contrast-12', 'oklch(0.17 0.014 74)'),
    accent: read('--moss-accent-9', 'oklch(0.48 0.102 148)'),
    mark: read('--moss-mark-accent', 'oklch(0.72 0.15 330)'),
    paper: read('--moss-base-2', 'oklch(0.886 0.021 82)')
  }
}

function beginStrokeStyle(
  ctx: CanvasRenderingContext2D,
  stroke: NoteSketchStroke,
  palette: SketchPalette
): void {
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#000' : palette[stroke.color]
  ctx.fillStyle = ctx.strokeStyle
}

// End-of-stroke tapers, applied at render time so they also dress up strokes
// recorded before B4. The start ramp is drawn live; the tail ramp rides the
// final held-back segment, so nothing already inked ever needs repainting.
const START_TAPER = 0.55
const END_TAPER = 0.45
// Catmull-Rom subdivision density: one sub-segment per ~2.5 units of travel.
const SMOOTH_STEP_UNITS = 2.5
const SMOOTH_STEPS_MAX = 12

/**
 * Incrementally draws a stroke's Catmull-Rom-smoothed segments. Segment `i`
 * covers points i-1 → i and needs point i+1 as its exit control, so while a
 * stroke is live (`final` false) the last segment is held back until the next
 * sample lands; `final` true flushes it with the tail taper. `fromTriple` is
 * the segment index already inked; returns the new value for it. This is the
 * only code that touches pixels while drawing — called once per animation
 * frame with whatever points coalesced since the last one.
 */
export function drawStrokeFrom(
  ctx: CanvasRenderingContext2D,
  stroke: NoteSketchStroke,
  palette: SketchPalette,
  fromTriple: number,
  final: boolean
): number {
  const points = stroke.points
  const totalTriples = points.length / 3
  if (totalTriples === 0) return 0
  beginStrokeStyle(ctx, stroke, palette)

  if (totalTriples === 1) {
    // A tap (or a just-started stroke): round dot, since a zero-length line
    // draws nothing. Live re-draws overpaint the same opaque dot harmlessly.
    const width = segmentWidth(stroke, points[2], points[2]) * START_TAPER
    ctx.beginPath()
    ctx.arc(points[0], points[1], width / 2, 0, Math.PI * 2)
    ctx.fill()
    return final ? 1 : 0
  }

  const lastSegment = final ? totalTriples - 1 : totalTriples - 2
  for (let seg = Math.max(fromTriple + 1, 1); seg <= lastSegment; seg += 1) {
    const i0 = Math.max(seg - 2, 0) * 3
    const i1 = (seg - 1) * 3
    const i2 = seg * 3
    const i3 = Math.min(seg + 1, totalTriples - 1) * 3

    const widthA = segmentWidth(stroke, points[i1 + 2], points[i1 + 2])
    const widthB = segmentWidth(stroke, points[i2 + 2], points[i2 + 2])
    const length = Math.hypot(points[i2] - points[i1], points[i2 + 1] - points[i1 + 1])
    const steps = Math.min(SMOOTH_STEPS_MAX, Math.max(1, Math.round(length / SMOOTH_STEP_UNITS)))

    let prevX = points[i1]
    let prevY = points[i1 + 1]
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      const x = catmullRom(points[i0], points[i1], points[i2], points[i3], t)
      const y = catmullRom(points[i0 + 1], points[i1 + 1], points[i2 + 1], points[i3 + 1], t)
      const mid = (step - 0.5) / steps
      let taper = 1
      if (seg === 1) taper = START_TAPER + (1 - START_TAPER) * mid
      if (final && seg === totalTriples - 1) taper = 1 - (1 - END_TAPER) * mid
      ctx.lineWidth = (widthA + (widthB - widthA) * mid) * taper
      ctx.beginPath()
      ctx.moveTo(prevX, prevY)
      ctx.lineTo(x, y)
      ctx.stroke()
      prevX = x
      prevY = y
    }
  }
  return Math.max(fromTriple, lastSegment)
}

/** Draw finished strokes 1:1 into whatever transform `ctx` already carries. */
export function drawSketchStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: NoteSketchStroke[],
  palette: SketchPalette
): void {
  for (const stroke of strokes) {
    drawStrokeFrom(ctx, stroke, palette, 0, true)
  }
  ctx.globalCompositeOperation = 'source-over'
}

/** N3 pad replay: clear the logical rect, then every stroke, composite reset. */
export function replayStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: NoteSketchStroke[],
  palette: SketchPalette,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height)
  drawSketchStrokes(ctx, strokes, palette)
}

export interface PressureSampler {
  (clientX: number, clientY: number, timeStamp: number, rawPressure: number, pointerType: string): number
}

/**
 * Per-stroke pressure source. Real pens keep their reported pressure (lightly
 * low-passed against sensor jitter); mice and trackpads — which report a flat
 * 0.5 — get a synthetic pressure from screen-space velocity, so fast flicks
 * thin out and slow deliberate lines ink heavy.
 */
export function createPressureSampler(): PressureSampler {
  let last: { x: number; y: number; t: number; pressure: number } | null = null
  return (clientX, clientY, timeStamp, rawPressure, pointerType) => {
    const synthetic = pointerType === 'mouse' || rawPressure === 0
    if (!last) {
      const pressure = synthetic ? SYNTH_START : rawPressure
      last = { x: clientX, y: clientY, t: timeStamp, pressure }
      return round2(pressure)
    }
    const dt = Math.max(timeStamp - last.t, 1)
    let pressure: number
    if (synthetic) {
      const speed = Math.hypot(clientX - last.x, clientY - last.y) / dt
      pressure = smoothPressure(last.pressure, velocityPressureTarget(speed))
    } else {
      pressure = smoothPressure(last.pressure, rawPressure, 0.5)
    }
    last = { x: clientX, y: clientY, t: timeStamp, pressure }
    return round2(pressure)
  }
}

const SYNTH_START = 0.55

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
