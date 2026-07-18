import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest globals are off, so RTL cannot auto-register cleanup; do both halves
// of the per-test teardown here — unmount trees AND drop the window.moss seam.
afterEach(() => {
  cleanup()
  delete (window as { moss?: unknown }).moss
})

// React 19 requires act() awareness to be opted into outside of react-dom/test-utils.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom gaps the renderer relies on. NoteInkLayer observes its scroller.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}

// Radix Select (MossSelect) drives these on open/close and keyboard nav.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
