import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  NoteSketchColor,
  NoteSketchData,
  NoteSketchStroke,
  NoteSketchStrokeWidth,
  NoteSketchTool
} from '@shared/notes'
import {
  NOTE_SKETCH_COLORS,
  NOTE_SKETCH_STROKE_WIDTHS,
  NOTE_SKETCH_STROKES_MAX_BYTES,
  NOTE_SKETCH_VERSION,
  serializeNoteSketchData
} from '@shared/notes'
import type { PressureSampler, SketchPalette } from '../lib/inkCanvas'
import {
  INK_COLOR_LABELS,
  INK_WIDTH_LABELS,
  createPressureSampler,
  drawStrokeFrom,
  replayStrokes,
  resolveSketchPalette
} from '../lib/inkCanvas'
import { MossButton } from './MossButton'
import { MossToolbar } from './MossToolbar'

const DEFAULT_SKETCH_WIDTH = 800
const DEFAULT_SKETCH_HEIGHT = 500
/** PNG is baked at 2× logical so it stays crisp at full attachment width on retina. */
const EXPORT_SCALE = 2

const COLOR_LABELS = INK_COLOR_LABELS
const WIDTH_LABELS = INK_WIDTH_LABELS

/**
 * Bakes the display PNG: paper fill from the current theme, then the stroke layer
 * composited on top. Strokes replay on a transparent layer first so the eraser
 * (destination-out) cuts through ink to paper, never to transparency.
 */
async function exportSketchPng(data: NoteSketchData, palette: SketchPalette): Promise<Uint8Array> {
  const layer = document.createElement('canvas')
  layer.width = data.width * EXPORT_SCALE
  layer.height = data.height * EXPORT_SCALE
  const layerCtx = layer.getContext('2d')
  if (!layerCtx) throw new Error('Sketch export is unavailable')
  layerCtx.scale(EXPORT_SCALE, EXPORT_SCALE)
  layerCtx.lineCap = 'round'
  layerCtx.lineJoin = 'round'
  replayStrokes(layerCtx, data.strokes, palette, data.width, data.height)

  const output = document.createElement('canvas')
  output.width = layer.width
  output.height = layer.height
  const outputCtx = output.getContext('2d')
  if (!outputCtx) throw new Error('Sketch export is unavailable')
  outputCtx.fillStyle = palette.paper
  outputCtx.fillRect(0, 0, output.width, output.height)
  outputCtx.drawImage(layer, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => {
    output.toBlob(resolve, 'image/png')
  })
  layer.width = 0
  output.width = 0
  if (!blob) throw new Error('Sketch export is unavailable')
  return new Uint8Array(await blob.arrayBuffer())
}

interface ActiveStroke {
  pointerId: number
  stroke: NoteSketchStroke
  /** Segments already committed to pixels — the next frame draws from here. */
  drawnTriples: number
  /** Velocity-aware pressure source for this stroke (see inkCanvas). */
  samplePressure: PressureSampler
}

interface NoteSketchPadProps {
  heading: string
  initial: NoteSketchData | null
  busy: boolean
  /** QA2-03: draw ON the note — the pad overlays the editor surface instead of
   * stacking below the textarea like a separate app. Persistence is identical. */
  overlay?: boolean
  onSave: (sketch: NoteSketchData, png: Uint8Array) => void
  onCancel: () => void
}

export function NoteSketchPad({
  heading,
  initial,
  busy,
  overlay = false,
  onSave,
  onCancel
}: NoteSketchPadProps): React.JSX.Element {
  const logicalWidth = initial?.width ?? DEFAULT_SKETCH_WIDTH
  const logicalHeight = initial?.height ?? DEFAULT_SKETCH_HEIGHT
  const palette = useMemo(resolveSketchPalette, [])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const strokesRef = useRef<NoteSketchStroke[]>([])
  const activeRef = useRef<ActiveStroke | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameTimesRef = useRef<number[]>([])

  // Per-stroke React state only — never per-point.
  const [tool, setTool] = useState<NoteSketchTool>('pen')
  const [strokeWidth, setStrokeWidth] = useState<NoteSketchStrokeWidth>(4)
  const [color, setColor] = useState<NoteSketchColor>('ink')
  const [strokeCount, setStrokeCount] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = logicalWidth * dpr
    canvas.height = logicalHeight * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctxRef.current = ctx

    strokesRef.current = (initial?.strokes ?? []).map((stroke) => ({
      ...stroke,
      points: [...stroke.points]
    }))
    setStrokeCount(strokesRef.current.length)
    replayStrokes(ctx, strokesRef.current, palette, logicalWidth, logicalHeight)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      activeRef.current = null
      ctxRef.current = null
      // Release the backing store — the pad may sit in a long-lived notes session.
      canvas.width = 0
      canvas.height = 0
    }
  }, [initial, logicalWidth, logicalHeight, palette])

  function pushPoint(event: PointerEvent, active: ActiveStroke): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = ((event.clientX - rect.left) / rect.width) * logicalWidth
    const y = ((event.clientY - rect.top) / rect.height) * logicalHeight
    const pressure = active.samplePressure(
      event.clientX,
      event.clientY,
      event.timeStamp,
      event.pressure,
      event.pointerType
    )
    active.stroke.points.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, pressure)
  }

  function flushActiveStroke(final = false): void {
    rafRef.current = null
    const ctx = ctxRef.current
    const active = activeRef.current
    if (!ctx || !active) return
    const frameStart = performance.now()
    active.drawnTriples = drawStrokeFrom(ctx, active.stroke, palette, active.drawnTriples, final)
    if (import.meta.env.DEV) {
      frameTimesRef.current.push(performance.now() - frameStart)
    }
  }

  function scheduleFlush(): void {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => flushActiveStroke())
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (busy || activeRef.current) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer events (headless QA) have no capturable pointer.
    }
    const active: ActiveStroke = {
      pointerId: event.pointerId,
      stroke: { tool, color, width: strokeWidth, points: [] },
      drawnTriples: 0,
      samplePressure: createPressureSampler()
    }
    pushPoint(event.nativeEvent, active)
    activeRef.current = active
    frameTimesRef.current = []
    scheduleFlush()
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const active = activeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    const native = event.nativeEvent
    const coalesced = native.getCoalescedEvents?.() ?? [native]
    for (const sample of coalesced) {
      pushPoint(sample, active)
    }
    scheduleFlush()
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    const active = activeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }
    flushActiveStroke(true)
    activeRef.current = null
    if (active.stroke.points.length > 0) {
      strokesRef.current.push(active.stroke)
      setStrokeCount(strokesRef.current.length)
      setSaveError(null)
    }
    if (import.meta.env.DEV && frameTimesRef.current.length > 3) {
      const times = frameTimesRef.current
      const avg = times.reduce((sum, t) => sum + t, 0) / times.length
      const max = Math.max(...times)
      // 60fps budget is 16.7ms/frame; this stroke renderer should sit well under 1ms.
      console.debug(
        `[sketch] stroke draw: avg ${avg.toFixed(2)}ms, max ${max.toFixed(2)}ms over ${times.length} frames`
      )
    }
  }

  function replayAll(): void {
    const ctx = ctxRef.current
    if (!ctx) return
    replayStrokes(ctx, strokesRef.current, palette, logicalWidth, logicalHeight)
  }

  function handleUndo(): void {
    if (strokesRef.current.length === 0) return
    strokesRef.current.pop()
    setStrokeCount(strokesRef.current.length)
    setSaveError(null)
    replayAll()
  }

  function handleClear(): void {
    if (strokesRef.current.length === 0) return
    strokesRef.current = []
    setStrokeCount(0)
    setSaveError(null)
    replayAll()
  }

  async function handleSave(): Promise<void> {
    const data: NoteSketchData = {
      version: NOTE_SKETCH_VERSION,
      width: logicalWidth,
      height: logicalHeight,
      strokes: strokesRef.current
    }
    if (serializeNoteSketchData(data).length > NOTE_SKETCH_STROKES_MAX_BYTES) {
      setSaveError('This sketch is too detailed to save — undo some strokes first.')
      return
    }
    try {
      const png = await exportSketchPng(data, palette)
      setSaveError(null)
      onSave(data, png)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save sketch')
    }
  }

  return (
    <section
      className={['notes-sketch', overlay ? 'notes-sketch--overlay' : ''].filter(Boolean).join(' ')}
      aria-label={heading}
    >
      <div className="notes-sketch-head">
        <span className="notes-sidebar-label nutrition-mono">{heading}</span>
        <div className="notes-sketch-actions">
          <MossButton
            type="button"
            variant="quiet"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </MossButton>
          <MossButton
            type="button"
            size="sm"
            disabled={busy || strokeCount === 0}
            onClick={() => void handleSave()}
          >
            Save sketch
          </MossButton>
        </div>
      </div>

      <MossToolbar className="notes-sketch-toolbar" label="Sketch tools">
        <MossToolbar.Group label="Tool">
          {(['pen', 'eraser'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              className={[
                'notes-attachment-style-btn',
                tool === entry ? 'notes-attachment-style-btn--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={tool === entry}
              disabled={busy}
              onClick={() => setTool(entry)}
            >
              {entry === 'pen' ? 'Pen' : 'Eraser'}
            </button>
          ))}
        </MossToolbar.Group>
        <MossToolbar.Group label="Stroke width">
          {NOTE_SKETCH_STROKE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              className={[
                'notes-attachment-style-btn',
                strokeWidth === width ? 'notes-attachment-style-btn--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={strokeWidth === width}
              disabled={busy}
              onClick={() => setStrokeWidth(width)}
            >
              {WIDTH_LABELS[width]}
            </button>
          ))}
        </MossToolbar.Group>
        <MossToolbar.Group label="Ink color">
          {NOTE_SKETCH_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={[
                'notes-sketch-swatch',
                color === entry ? 'notes-sketch-swatch--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ background: palette[entry] }}
              aria-pressed={color === entry}
              aria-label={`${COLOR_LABELS[entry]} ink`}
              title={COLOR_LABELS[entry]}
              disabled={busy || tool === 'eraser'}
              onClick={() => setColor(entry)}
            />
          ))}
        </MossToolbar.Group>
        <MossToolbar.Group label="History">
          <MossButton
            variant="quiet"
            size="xs"
            disabled={busy || strokeCount === 0}
            onClick={handleUndo}
          >
            Undo
          </MossButton>
          <MossButton
            variant="quiet"
            size="xs"
            disabled={busy || strokeCount === 0}
            onClick={handleClear}
          >
            Clear
          </MossButton>
        </MossToolbar.Group>
      </MossToolbar>

      <canvas
        ref={canvasRef}
        className="notes-sketch-canvas"
        style={{ aspectRatio: `${logicalWidth} / ${logicalHeight}` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />

      {saveError && <p className="text-sm text-signal-error-text">{saveError}</p>}
    </section>
  )
}
