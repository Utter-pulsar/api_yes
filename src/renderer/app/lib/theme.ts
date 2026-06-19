/**
 * Resolve a value for canvas/SVG (Rough.js) fills & strokes. A CSS custom-property token like
 * '--ink' is read from :root (theme-aware) and returned as a concrete `rgb(r g b)` string;
 * anything else (a hex like '#FF5A2C') is passed through.
 */
export function cssColor(value: string): string {
  if (!value.startsWith('--')) return value
  const v = getComputedStyle(document.documentElement).getPropertyValue(value).trim()
  return v ? `rgb(${v})` : value
}
