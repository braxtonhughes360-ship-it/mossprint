import type { NoteSketchData, NoteSketchStroke } from './notes'
import { NOTE_SKETCH_ERASER_MULTIPLIER, NOTE_SKETCH_VERSION } from './notes'

/**
 * B4 ink math — the pure half of the sketch engine. Everything here is
 * DOM-free so the board page, the note sketch pad, the main process
 * validators and vitest all share one set of numbers. Canvas rendering
 * lives in renderer/src/lib/inkCanvas.ts.
 */

/**
 * Pressure → width factor. Tightened from the B2/N3 curve (0.4 + 1.2p):
 * the midpoint stays exactly 1.0 (a plain mouse stroke keeps its nominal
 * width) but the dynamic range is wider, so pressure and the synthetic
 * velocity taper below actually read on the page.
 */
export function pressureFactor(pressure: number): number {
  if (pressure <= 0) return 1
  return Math.min(Math.max(0.35 + pressure * 1.3, 0.35), 1.65)
}

export function strokeBaseWidth(stroke: NoteSketchStroke): number {
  return stroke.tool === 'eraser' ? stroke.width * NOTE_SKETCH_ERASER_MULTIPLIER : stroke.width
}

export function segmentWidth(
  stroke: NoteSketchStroke,
  pressureA: number,
  pressureB: number
): number {
  return strokeBaseWidth(stroke) * pressureFactor((pressureA + pressureB) / 2)
}

// Synthetic pressure for pointers that report none (mouse/trackpad send a
// constant 0.5): slow, deliberate strokes ink heavy; a fast flick thins out
// toward the floor — the Concepts feel, baked into the stored pressures so
// replays are deterministic.
export const SYNTH_PRESSURE_MAX = 0.72
export const SYNTH_PRESSURE_MIN = 0.26
const SYNTH_FLICK_SPEED = 4 // px/ms of screen travel that reaches the thin floor

export function velocityPressureTarget(speedPxPerMs: number): number {
  const t = Math.min(Math.max(speedPxPerMs / SYNTH_FLICK_SPEED, 0), 1)
  return SYNTH_PRESSURE_MAX - t * (SYNTH_PRESSURE_MAX - SYNTH_PRESSURE_MIN)
}

/** One-pole low-pass so per-sample speed noise never becomes width jitter. */
export function smoothPressure(previous: number, target: number, alpha = 0.3): number {
  return previous + (target - previous) * alpha
}

/** Uniform Catmull-Rom interpolation for one coordinate. t=0 → p1, t=1 → p2. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

export interface SketchBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * World-space bounds of a stroke set, padded by each stroke's widest possible
 * inked half-width (pressure factor ceiling included) so a frame cut from
 * these bounds never clips its own ink.
 */
export function sketchStrokesBounds(strokes: NoteSketchStroke[]): SketchBounds | null {
  let bounds: SketchBounds | null = null
  for (const stroke of strokes) {
    const pad = (strokeBaseWidth(stroke) * 1.65) / 2 + 1
    const points = stroke.points
    for (let i = 0; i + 2 < points.length; i += 3) {
      const x = points[i]
      const y = points[i + 1]
      if (!bounds) {
        bounds = { minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad }
      } else {
        if (x - pad < bounds.minX) bounds.minX = x - pad
        if (y - pad < bounds.minY) bounds.minY = y - pad
        if (x + pad > bounds.maxX) bounds.maxX = x + pad
        if (y + pad > bounds.maxY) bounds.maxY = y + pad
      }
    }
  }
  return bounds
}

/**
 * Re-express strokes in another coordinate space: x' = translateX + x·scaleX.
 * Widths and pressures are untouched — N3 widths are a fixed enum, so scaling
 * lives in how a frame is rendered, never in the stored stroke.
 */
export function transformSketchStrokes(
  strokes: NoteSketchStroke[],
  opts: { translateX: number; translateY: number; scaleX?: number; scaleY?: number }
): NoteSketchStroke[] {
  const sx = opts.scaleX ?? 1
  const sy = opts.scaleY ?? 1
  return strokes.map((stroke) => {
    const points: number[] = new Array(stroke.points.length)
    for (let i = 0; i + 2 < stroke.points.length; i += 3) {
      points[i] = Math.round((opts.translateX + stroke.points[i] * sx) * 100) / 100
      points[i + 1] = Math.round((opts.translateY + stroke.points[i + 1] * sy) * 100) / 100
      points[i + 2] = stroke.points[i + 2]
    }
    return { ...stroke, points }
  })
}

const SKETCH_ENVELOPE_BYTES = 120 // {"version":1,"width":…,"height":…,"strokes":[…]} slack

/**
 * Split a drawing session into chunks whose serialized N3 JSON stays under
 * `maxBytes`, preserving stroke order. A single stroke that alone exceeds the
 * budget has its tail points dropped — at ~30k points per 512KB that is a
 * pathological stroke, not a real one.
 */
export function splitStrokesByByteBudget(
  strokes: NoteSketchStroke[],
  maxBytes: number
): NoteSketchStroke[][] {
  const budget = maxBytes - SKETCH_ENVELOPE_BYTES
  const chunks: NoteSketchStroke[][] = []
  let current: NoteSketchStroke[] = []
  let currentBytes = 0
  for (let stroke of strokes) {
    let bytes = JSON.stringify(stroke).length + 1
    if (bytes > budget) {
      const keepTriples = Math.floor((budget / bytes) * (stroke.points.length / 3))
      stroke = { ...stroke, points: stroke.points.slice(0, Math.max(3, keepTriples * 3)) }
      bytes = JSON.stringify(stroke).length + 1
    }
    if (current.length > 0 && currentBytes + bytes > budget) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(stroke)
    currentBytes += bytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Assemble an N3 sketch payload for a frame of the given size. */
export function makeSketchData(
  width: number,
  height: number,
  strokes: NoteSketchStroke[]
): NoteSketchData {
  return { version: NOTE_SKETCH_VERSION, width, height, strokes }
}
