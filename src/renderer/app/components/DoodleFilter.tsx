/**
 * Invisible SVG that defines the global hand-drawn wobble filter. Mount once near the app root;
 * then any element with the `doodle-edge` class gets sketchy edges — the cheap, app-wide way to
 * get the Excalidraw vibe without per-element art.
 */
export function DoodleFilter(): JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id="doodle-wobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" />
        </filter>
      </defs>
    </svg>
  )
}
