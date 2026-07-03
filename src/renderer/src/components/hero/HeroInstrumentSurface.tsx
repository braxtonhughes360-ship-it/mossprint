/** Structural hero atmosphere — dot grid + directional light shaft + living glow. */
export function HeroInstrumentSurface(): React.JSX.Element {
  return (
    <>
      <span className="moss-hero-instrument-grid" aria-hidden />
      <span className="moss-hero-light-shaft" aria-hidden />
      {/* The living light — warm, present, slowly breathing (the signature moment). */}
      <span className="moss-hero-glow" aria-hidden />
    </>
  )
}
