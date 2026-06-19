import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DATA_FILE } from '@shared/constants'
import type {
  AppSettings,
  CredentialView,
  OAuthAccount,
  ProxyEndpoint
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { TestResult } from '@shared/types/common'
import type { Provider, CredentialKind, Id } from '@shared/types/common'

/** OAuth token bundle for a subscription credential — secret material, never sent to the renderer. */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  /** epoch ms */
  expiresAt?: number
  account?: OAuthAccount
  scopes?: string[]
  /** provider-specific extras (e.g. OpenAI chatgpt account id, id_token, idTokenClaims) */
  extra?: Record<string, unknown>
}

/**
 * The full credential as held in the main process: metadata PLUS the secret payload
 * (`apiKey` for an API-key credential, `oauth` for a subscription). The secret is encrypted
 * at rest (Electron safeStorage) and is stripped before anything crosses to the renderer.
 */
export interface StoredCredential {
  id: Id
  name: string
  provider: Provider
  kind: CredentialKind
  baseUrl: string
  /** master switch; undefined/true = on, false = off (gates ALL of its API keys) */
  enabled?: boolean
  createdAt: number
  updatedAt: number
  order: number
  lastTest?: TestResult
  // secret payload (one of these, depending on kind)
  apiKey?: string
  oauth?: OAuthTokens
}

export interface Database {
  version: number
  settings: AppSettings
  credentials: StoredCredential[]
  proxies: ProxyEndpoint[]
}

const SCHEMA_VERSION = 1

/** Persisted-on-disk shape: secrets are split out and encrypted; everything else is plain JSON. */
interface PersistedCredential extends Omit<StoredCredential, 'apiKey' | 'oauth'> {
  /** base64 of the encrypted JSON {apiKey?, oauth?}; empty if there is no secret */
  secret: string
  /** true if `secret` is safeStorage-encrypted; false ⇒ it's plain base64 JSON (no OS crypto) */
  enc: boolean
}
interface PersistedDB {
  version: number
  settings: AppSettings
  credentials: PersistedCredential[]
  proxies: ProxyEndpoint[]
}

function emptyDb(): Database {
  return { version: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, credentials: [], proxies: [] }
}

// ---- secret (de)serialization ----
function encodeSecret(c: StoredCredential): { secret: string; enc: boolean } {
  const payload = JSON.stringify({ apiKey: c.apiKey, oauth: c.oauth })
  if (!c.apiKey && !c.oauth) return { secret: '', enc: false }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { secret: safeStorage.encryptString(payload).toString('base64'), enc: true }
    }
  } catch {
    /* fall through to plain */
  }
  // No OS encryption available — store base64 JSON. Still inside the gitignored userData dir.
  return { secret: Buffer.from(payload, 'utf8').toString('base64'), enc: false }
}

function decodeSecret(p: PersistedCredential): Pick<StoredCredential, 'apiKey' | 'oauth'> {
  if (!p.secret) return {}
  try {
    const raw = Buffer.from(p.secret, 'base64')
    const json = p.enc ? safeStorage.decryptString(raw) : raw.toString('utf8')
    const parsed = JSON.parse(json) as { apiKey?: string; oauth?: OAuthTokens }
    return { apiKey: parsed.apiKey, oauth: parsed.oauth }
  } catch (e) {
    console.warn(`[store] failed to decrypt secret for credential ${p.id}:`, e)
    return {}
  }
}

/**
 * Plain-JSON persistence (no native build → ships identically cross-platform). The whole DB is
 * tiny and lives in memory; mutations write through to disk (debounced) atomically (tmp + rename).
 * Upstream secrets are encrypted with the OS keychain via safeStorage; the renderer only ever
 * receives secret-free views.
 */
export class Store {
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private readonly path: string,
    private db: Database
  ) {}

  static open(filePath?: string): Store {
    const path = filePath ?? join(app.getPath('userData'), DATA_FILE)
    let db: Database
    let needsWrite = false
    if (existsSync(path)) {
      try {
        db = Store.read(path)
      } catch (e) {
        console.warn('[store] failed to read data file, starting fresh:', e)
        db = emptyDb()
        needsWrite = true
      }
    } else {
      db = emptyDb()
      mkdirSync(dirname(path), { recursive: true })
      needsWrite = true
    }
    const store = new Store(path, db)
    if (needsWrite) store.flush()
    return store
  }

  private static read(path: string): Database {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as PersistedDB
    const credentials: StoredCredential[] = (raw.credentials ?? []).map((p) => {
      const { secret: _s, enc: _e, ...meta } = p
      return { ...meta, ...decodeSecret(p) }
    })
    // normalize legacy proxies (created before per-key fields existed) to definite booleans —
    // undefined localOnly/enabled must read as the safe defaults (loopback-only, enabled), so the
    // server's bind logic and the UI agree.
    const proxies = (raw.proxies ?? []).map((p) => ({
      ...p,
      enabled: p.enabled !== false,
      localOnly: p.localOnly !== false
    }))
    return {
      version: raw.version ?? SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
      credentials,
      proxies
    }
  }

  get data(): Database {
    return this.db
  }

  mutate(fn: (db: Database) => void): void {
    fn(this.db)
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.persistNow(), 150)
  }

  private persistNow(): void {
    const persisted: PersistedDB = {
      version: this.db.version,
      settings: this.db.settings,
      proxies: this.db.proxies,
      credentials: this.db.credentials.map((c) => {
        const { apiKey: _a, oauth: _o, ...meta } = c
        return { ...meta, ...encodeSecret(c) }
      })
    }
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8')
    renameSync(tmp, this.path) // atomic swap so a crash mid-write can't truncate the store
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.persistNow()
  }
}

/** Strip the secret payload → the renderer-safe credential view. */
export function toCredentialView(c: StoredCredential): CredentialView {
  const view: CredentialView = {
    id: c.id,
    name: c.name,
    provider: c.provider,
    kind: c.kind,
    baseUrl: c.baseUrl,
    enabled: c.enabled !== false, // undefined (legacy) ⇒ enabled
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    order: c.order,
    lastTest: c.lastTest
  }
  if (c.kind === 'apikey' && c.apiKey) view.keyPreview = maskKey(c.apiKey)
  if (c.kind === 'oauth' && c.oauth) {
    view.account = c.oauth.account
    view.expiresAt = c.oauth.expiresAt
    view.scopes = c.oauth.scopes
  }
  return view
}

/** "sk-proj-abcd…WXYZ" → "sk-proj-…WXYZ". Keeps the recognisable prefix + last 4 chars. */
export function maskKey(key: string): string {
  if (key.length <= 10) return '••••'
  const head = key.slice(0, key.indexOf('-', 3) > 0 ? key.indexOf('-', 3) + 1 : 3)
  return `${head}…${key.slice(-4)}`
}
