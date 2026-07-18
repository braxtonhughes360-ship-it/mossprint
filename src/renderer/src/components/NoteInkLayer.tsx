import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type {
  NoteInkData,
  NoteSketchColor,
  NoteSketchStroke,
  NoteSketchStrokeWidth,
  NoteSketchTool
} from '@shared/notes'
import {
  NOTE_INK_STROKES_MAX_BYTES,
  NOTE_INK_VERSION,
  serializeNoteInkData
} from '@shared/notes'
import type { PressureSampler } from '../lib/inkCanvas'
import {
  createPressureSampler,
  drawStrokeFrom,
  drawSketchStrokes,
  resolveSketchPalette
} from '../lib/inkCanvas'

/**
 * R2: draw-anywhere ink ON the note document. Strokes live in document
 * coordinates (CSS px from the content column's top-left), so they scroll with
 * the text and images they annotate — GoodNotes/Apple-Notes-markup behavior,
 * inside the one document.
 *
 * The canvas is a viewport-sized window (position: sticky), never a
 * document-sized bitmap: a long note would otherwise pin tens of MB of canvas
 * memory. Scrolling repaints the window with a translate — strokes are culled
 * by their cached y-extent, so the per-frame cost tracks visible ink, not
 * total ink. While a stroke is live the engine draws incrementally (the same
 * B4/N3 path — catmull-rom, pressure taper), one flush per animation frame.
 */

export interface NoteInkLayerHandle {
  undo: () => void
  clear: () => void
}

interface NoteInkLayerProps {
  /** The scrollable document pane — the canvas windows over its viewport. */
  scrollerRef: React.RefObject<HTMLDivElement | null>
  initial: NoteInkData | null
  penActive: boolean
  tool: NoteSketchTool
  color: NoteSketchColor
  strokeWidth: NoteSketchStrokeWidth
  busy: boolean
  /** Fired after every committed change (stroke end, undo, clear) with the full ink data. */
  onCommit: (ink: NoteInkData, strokeCount: number) => void
  onError: (message: string) => void
}

interface ActiveStroke {
  pointerId: number
  stroke: NoteSketchStroke
  drawnTriples: number
  samplePressure: PressureSampler
  /** Scroll position the incremental frames were inked at — a scroll mid-stroke forces a replay. */
  scrollTop: number
}

type StrokeWithBounds = { stroke: NoteSketchStroke; minY: number; maxY: number }

function strokeBounds(stroke: NoteSketchStroke): StrokeWithBounds {
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 1; i < stroke.points.length; i += 3) {
    if (stroke.points[i] < minY) minY = stroke.points[i]
    if (stroke.points[i] > maxY) maxY = stroke.points[i]
  }
  // Pad by the widest possible sweep so a stroke never pops at the window edge.
  return { stroke, minY: minY - 40, maxY: maxY + 40 }
}

export const NoteInkLayer = forwardRef<NoteInkLayerHandle, NoteInkLayerProps>(
  function NoteInkLayer(
    { scrollerRef, initial, penActive, tool, color, strokeWidth, busy, onCommit, onError },
    handleRef
  ): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const strokesRef = useRef<StrokeWithBounds[]>([])
    const widthRef = useRef(0)
    const activeRef = useRef<ActiveStroke | null>(null)
    const rafRef = useRef<number | null>(null)
    const scrollRafRef = useRef<number | null>(null)
    const paletteRef = useRef(resolveSketchPalette())
    const frameTimesRef = useRef<number[]>([])

    const toolRef = useRef(tool)
    toolRef.current = tool
    const colorRef = useRef(color)
    colorRef.current = color
    const strokeWidthRef = useRef(strokeWidth)
    strokeWidthRef.current = strokeWidth
    const busyRef = useRef(busy)
    busyRef.current = busy
    const onCommitRef = useRef(onCommit)
    onCommitRef.current = onCommit
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError

    const currentInk = useCallback((): NoteInkData => {
      return {
        version: NOTE_INK_VERSION,
        width: Math.max(1, Math.round(widthRef.current)),
        strokes: strokesRef.current.map((entry) => entry.stroke)
      }
    }, [])

    /** Full window repaint: clear, translate to the scroll position, replay visible strokes. */
    const redraw = useCallback((): void => {
      const canvas = canvasRef.current
      const ctx = ctxRef.current
      const scroller = scrollerRef.current
      if (!canvas || !ctx || !scroller) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewW = canvas.width / dpr
      const viewH = canvas.height / dpr
      const scrollTop = scroller.scrollTop
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewW, viewH)
      ctx.translate(0, -scrollTop)
      const visible = strokesRef.current
        .filter((entry) => entry.maxY >= scrollTop && entry.minY <= scrollTop + viewH)
        .map((entry) => entry.stroke)
      drawSketchStrokes(ctx, visible, paletteRef.current)
      const active = activeRef.current
      if (active) {
        active.drawnTriples = drawStrokeFrom(ctx, active.stroke, paletteRef.current, 0, false)
        active.scrollTop = scrollTop
      }
    }, [scrollerRef])

    // Mount/reseed: size the window canvas, normalize stored strokes to the
    // live column width (the only stable anchor a reflowing document has),
    // and paint. Re-runs when the note (initial) changes via the parent key.
    useEffect(() => {
      const canvas = canvasRef.current
      const scroller = scrollerRef.current
      if (!canvas || !scroller) return undefined
      paletteRef.current = resolveSketchPalette()

      const applySize = (): void => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewW = canvas.parentElement?.clientWidth ?? scroller.clientWidth
        const viewH = scroller.clientHeight
        if (viewW <= 0 || viewH <= 0) return
        const previousWidth = widthRef.current
        if (previousWidth > 0 && Math.abs(previousWidth - viewW) > 0.5) {
          // Proportional re-anchor on column resize, x and y together so
          // annotated shapes keep their aspect.
          const factor = viewW / previousWidth
          strokesRef.current = strokesRef.current.map((entry) => {
            const points = entry.stroke.points.map((value, index) =>
              index % 3 === 2 ? value : Math.round(value * factor * 100) / 100
            )
            return strokeBounds({ ...entry.stroke, points })
          })
        }
        widthRef.current = viewW
        canvas.width = Math.round(viewW * dpr)
        canvas.height = Math.round(viewH * dpr)
        canvas.style.width = `${viewW}px`
        canvas.style.height = `${viewH}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctxRef.current = ctx
        redraw()
      }

      const seedWidth = canvas.parentElement?.clientWidth ?? scroller.clientWidth
      const storedWidth = initial?.width ?? seedWidth
      const factor = storedWidth > 0 && seedWidth > 0 ? seedWidth / storedWidth : 1
      strokesRef.current = (initial?.strokes ?? []).map((stroke) =>
        strokeBounds({
          ...stroke,
          points:
            factor === 1
              ? [...stroke.points]
              : stroke.points.map((value, index) =>
                  index % 3 === 2 ? value : Math.round(value * factor * 100) / 100
                )
        })
      )
      widthRef.current = seedWidth
      applySize()

      const observer = new ResizeObserver(() => applySize())
      observer.observe(scroller)
      if (canvas.parentElement) observer.observe(canvas.parentElement)

      const onScroll = (): void => {
        if (scrollRafRef.current !== null) return
        scrollRafRef.current = requestAnimationFrame(() => {
          scrollRafRef.current = null
          redraw()
        })
      }
      scroller.addEventListener('scroll', onScroll, { passive: true })

      return () => {
        observer.disconnect()
        scroller.removeEventListener('scroll', onScroll)
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
        rafRef.current = null
        scrollRafRef.current = null
        activeRef.current = null
        ctxRef.current = null
        canvas.width = 0
        canvas.height = 0
      }
    }, [initial, redraw, scrollerRef])

    const commit = useCallback((): void => {
      onCommitRef.current(currentInk(), strokesRef.current.length)
    }, [currentInk])

    useImperativeHandle(
      handleRef,
      () => ({
        undo: () => {
          if (strokesRef.current.length === 0) return
          strokesRef.current.pop()
          redraw()
          commit()
        },
        clear: () => {
          if (strokesRef.current.length === 0) return
          strokesRef.current = []
          redraw()
          commit()
        }
      }),
      [commit, redraw]
    )

    function pushPoint(event: PointerEvent, active: ActiveStroke): void {
      const canvas = canvasRef.current
      const scroller = scrollerRef.current
      if (!canvas || !scroller) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0) return
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top + scroller.scrollTop
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
      const scroller = scrollerRef.current
      const active = activeRef.current
      if (!ctx || !scroller || !active) return
      const frameStart = performance.now()
      if (scroller.scrollTop !== active.scrollTop) {
        // The window moved under the live stroke — repaint, which also
        // re-inks the active stroke at the new translate.
        redraw()
      } else {
        active.drawnTriples = drawStrokeFrom(
          ctx,
          active.stroke,
          paletteRef.current,
          active.drawnTriples,
          final
        )
      }
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
      if (busyRef.current || activeRef.current) return
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointer events (headless QA) have no capturable pointer.
      }
      const scroller = scrollerRef.current
      const active: ActiveStroke = {
        pointerId: event.pointerId,
        stroke: {
          tool: toolRef.current,
          color: colorRef.current,
          width: strokeWidthRef.current,
          points: []
        },
        drawnTriples: 0,
        samplePressure: createPressureSampler(),
        scrollTop: scroller?.scrollTop ?? 0
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
        const next = [...strokesRef.current, strokeBounds(active.stroke)]
        const candidate: NoteInkData = {
          version: NOTE_INK_VERSION,
          width: Math.max(1, Math.round(widthRef.current)),
          strokes: next.map((entry) => entry.stroke)
        }
        if (serializeNoteInkData(candidate).length > NOTE_INK_STROKES_MAX_BYTES) {
          onErrorRef.current('This drawing is too detailed to save — undo some strokes first.')
          redraw()
          return
        }
        strokesRef.current = next
        commit()
      }
      if (import.meta.env.DEV && frameTimesRef.current.length > 3) {
        const times = frameTimesRef.current
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length
        const max = Math.max(...times)
        // 60fps budget is 16.7ms/frame; the stroke renderer should sit well under 1ms.
        console.debug(
          `[note-ink] stroke draw: avg ${avg.toFixed(2)}ms, max ${max.toFixed(2)}ms over ${times.length} frames`
        )
      }
    }

    return (
      <div className="notes-ink-sticky" aria-hidden={!penActive}>
        <canvas
          ref={canvasRef}
          className="notes-ink-layer"
          data-pen={penActive ? '' : undefined}
          data-tool={tool}
          onPointerDown={penActive ? handlePointerDown : undefined}
          onPointerMove={penActive ? handlePointerMove : undefined}
          onPointerUp={penActive ? finishStroke : undefined}
          onPointerCancel={penActive ? finishStroke : undefined}
        />
      </div>
    )
  }
)
