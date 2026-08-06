const COMPACT_UNITS = [
  { suffix: 't', value: 1_000_000_000_000 },
  { suffix: 'b', value: 1_000_000_000 },
  { suffix: 'm', value: 1_000_000 },
  { suffix: 'k', value: 1_000 }
] as const

/** Parse human token amounts: 1000, 1k, 1.5m, 2B, 0.25t. Returns undefined on invalid input. */
export function parseCompactNumber(input: string): number | undefined {
  const s = input.trim().replace(/[,_\s]/g, '').toLowerCase()
  if (!s) return 0
  const hit = /^(\d+(?:\.\d+)?|\.\d+)([kmbt])?$/.exec(s)
  if (!hit) return undefined
  const n = Number(hit[1])
  if (!Number.isFinite(n) || n < 0) return undefined
  const unit = COMPACT_UNITS.find((u) => u.suffix === hit[2])
  return Math.floor(n * (unit?.value ?? 1))
}

function trimFixed(n: number, maxFractionDigits: number): string {
  return parseFloat(n.toFixed(maxFractionDigits)).toString()
}

/** 1234 → 1.2k, 1_500_000 → 1.5m, 2_000_000_000 → 2b. */
export function formatCompactNumber(n: number, maxFractionDigits = 1): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  for (const unit of COMPACT_UNITS) {
    if (abs >= unit.value) return `${sign}${trimFixed(abs / unit.value, maxFractionDigits)}${unit.suffix}`
  }
  return `${sign}${Math.floor(abs)}`
}
