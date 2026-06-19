/** Compact token counts: 1234 → "1.2k", 1_500_000 → "1.5M". */
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/** Full grouped number: 1234567 → "1,234,567". */
export function grouped(n: number): string {
  return n.toLocaleString('en-US')
}

/** "刚刚" / "3 分钟前" / a date — relative time for a recent epoch-ms timestamp. */
export function ago(ms?: number): string {
  if (!ms) return '从未'
  const d = Date.now() - ms
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  return new Date(ms).toLocaleDateString('zh-CN')
}
