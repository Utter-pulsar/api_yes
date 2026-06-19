import { randomBytes } from 'node:crypto'
import type { Provider } from '@shared/types/common'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** A cryptographically-random base62 string of length `n`. */
function rand(n: number): string {
  const bytes = randomBytes(n)
  let s = ''
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return s
}

/**
 * Generate a LOCAL proxy key styled to match the provider, so it looks at home in the user's tool
 * config. These gate access to the local proxy only — they are not upstream secrets.
 *   openai    → sk-proj-<48>
 *   anthropic → sk-ant-api03-<86>AA
 */
export function generateProxyKey(provider: Provider): string {
  if (provider === 'anthropic') return `sk-ant-api03-${rand(86)}AA`
  return `sk-proj-${rand(48)}`
}
