import { createHash, randomBytes, randomUUID } from 'node:crypto'

/** RFC 7636 PKCE pair + a CSRF state value, all base64url. */
export interface Pkce {
  verifier: string
  challenge: string
  state: string
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(32))
  return { verifier, challenge, state }
}

export function newId(): string {
  return randomUUID()
}

/** Decode a JWT payload (no signature verification — we only read claims like the account id). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
