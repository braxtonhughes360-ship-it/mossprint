import { useEffect, useRef } from 'react'
import type {
  NoteAttachmentRecord,
  NoteAttachmentShape,
  NoteAttachmentSize,
  NoteImageBlock,
  NoteSketchBlock,
  UpdateNoteAttachmentInput
} from '@shared/notes'
import {
  DEFAULT_NOTE_ATTACHMENT_STYLE,
  NOTE_ATTACHMENT_SHAPES,
  NOTE_ATTACHMENT_SIZES,
  noteAttachmentUrl
} from '@shared/notes'
import { drawSketchStrokes, resolveSketchPalette } from '../lib/inkCanvas'
import { MossButton } from './MossButton'
import { MossToolbar } from './MossToolbar'

/**
 * R1 inline blocks: an image lives IN the document at its block position —
 * placed like a PDF, not stacked in a bottom gallery. The tile chrome (hover
 * style toolbar, remove button) carries over from the gallery-era attachment
 * tile unchanged; only where it renders moved.
 */

const ATTACHMENT_SHAPE_LABELS: Record<NoteAttachmentShape, string> = {
  rectangle: 'Square',
  rounded: 'Soft',
  circle: 'Circle'
}

const ATTACHMENT_SIZE_LABELS: Record<NoteAttachmentSize, string> = {
  small: 'Small',
  medium: 'Medium',
  full: 'Full'
}

interface NoteImageBlockViewProps {
  block: NoteImageBlock
  /** The attachment record when this note owns it; null for a migrated cross-note reference. */
  attachment: NoteAttachmentRecord | null
  busy: boolean
  /** Bumped after each in-place sketch edit — the URL is stable, so this busts the img cache. */
  sketchRev: number
  sketchPadOpen: boolean
  onRemove: (block: NoteImageBlock) => void
  onStyleChange: (attachmentId: string, patch: UpdateNoteAttachmentInput) => void
  onEditSketch: (attachment: NoteAttachmentRecord) => void
}

export function NoteImageBlockView({
  block,
  attachment,
  busy,
  sketchRev,
  sketchPadOpen,
  onRemove,
  onStyleChange,
  onEditSketch
}: NoteImageBlockViewProps): React.JSX.Element {
  const style = attachment?.style ?? DEFAULT_NOTE_ATTACHMENT_STYLE
  const url = attachment?.url ?? noteAttachmentUrl(block.attachmentId)

  return (
    <div className="notes-attachment notes-block-image" data-shape={style.shape} data-size={style.size}>
      <figure className="notes-attachment-figure notes-inline-figure" tabIndex={0}>
        <img
          className="notes-attachment-img"
          src={sketchRev > 0 ? `${url}?v=${sketchRev}` : url}
          alt={attachment?.filename ?? 'Image'}
          loading="lazy"
        />
        {attachment && (
          <MossToolbar className="notes-attachment-toolbar" label="Image style">
            <MossToolbar.Group label="Shape">
              {NOTE_ATTACHMENT_SHAPES.map((shape) => {
                const active = style.shape === shape
                return (
                  <button
                    key={shape}
                    type="button"
                    className={[
                      'notes-attachment-style-btn',
                      active ? 'notes-attachment-style-btn--active' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={active}
                    aria-label={`${ATTACHMENT_SHAPE_LABELS[shape]} shape`}
                    title={ATTACHMENT_SHAPE_LABELS[shape]}
                    disabled={busy || active}
                    onClick={() => onStyleChange(attachment.id, { shape })}
                  >
                    {ATTACHMENT_SHAPE_LABELS[shape]}
                  </button>
                )
              })}
            </MossToolbar.Group>
            <MossToolbar.Group label="Size">
              {NOTE_ATTACHMENT_SIZES.map((size) => {
                const active = style.size === size
                return (
                  <button
                    key={size}
                    type="button"
                    className={[
                      'notes-attachment-style-btn',
                      active ? 'notes-attachment-style-btn--active' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={active}
                    aria-label={`${ATTACHMENT_SIZE_LABELS[size]} size`}
                    title={ATTACHMENT_SIZE_LABELS[size]}
                    disabled={busy || active}
                    onClick={() => onStyleChange(attachment.id, { size })}
                  >
                    {ATTACHMENT_SIZE_LABELS[size]}
                  </button>
                )
              })}
            </MossToolbar.Group>
            {attachment.sketch && (
              <MossToolbar.Group label="Sketch">
                <MossButton
                  variant="quiet"
                  size="xs"
                  disabled={busy || sketchPadOpen}
                  onClick={() => onEditSketch(attachment)}
                >
                  Edit sketch
                </MossButton>
              </MossToolbar.Group>
            )}
          </MossToolbar>
        )}
        <span className="notes-attachment-remove-wrap">
          <MossButton
            variant="icon"
            size="xs"
            tone="neutral"
            aria-label={`Remove image ${attachment?.filename ?? ''}`.trim()}
            title="Remove image"
            disabled={busy}
            onClick={() => onRemove(block)}
          >
            ×
          </MossButton>
        </span>
      </figure>
    </div>
  )
}

interface NoteSketchBlockViewProps {
  block: NoteSketchBlock
  busy: boolean
  sketchPadOpen: boolean
  onEdit: (block: NoteSketchBlock) => void
  onRemove: (block: NoteSketchBlock) => void
}

/**
 * A migrated board drawing: N3 strokes carried inline in the document with no
 * baked PNG, replayed onto a canvas. Editing routes through the sketch pad and
 * saves back as a normal sketch attachment (PNG + strokes), replacing this
 * block with an image block — the upgrade path out of the boards era.
 */
export function NoteSketchBlockView({
  block,
  busy,
  sketchPadOpen,
  onEdit,
  onRemove
}: NoteSketchBlockViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = block.sketch.width * dpr
    canvas.height = block.sketch.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    drawSketchStrokes(ctx, block.sketch.strokes, resolveSketchPalette())
    return () => {
      canvas.width = 0
      canvas.height = 0
    }
  }, [block.sketch])

  return (
    <div className="notes-attachment notes-block-image" data-shape="rounded" data-size="medium">
      <figure className="notes-attachment-figure notes-inline-figure" tabIndex={0}>
      <canvas
        ref={canvasRef}
        className="notes-attachment-img notes-block-sketch-canvas"
        style={{ aspectRatio: `${block.sketch.width} / ${block.sketch.height}` }}
        role="img"
        aria-label="Drawing"
      />
        <MossToolbar className="notes-attachment-toolbar" label="Drawing">
          <MossToolbar.Group label="Sketch">
            <MossButton
              variant="quiet"
              size="xs"
              disabled={busy || sketchPadOpen}
              onClick={() => onEdit(block)}
            >
              Edit sketch
            </MossButton>
          </MossToolbar.Group>
        </MossToolbar>
        <span className="notes-attachment-remove-wrap">
          <MossButton
            variant="icon"
            size="xs"
            tone="neutral"
            aria-label="Remove drawing"
            title="Remove drawing"
            disabled={busy}
            onClick={() => onRemove(block)}
          >
            ×
          </MossButton>
        </span>
      </figure>
    </div>
  )
}
