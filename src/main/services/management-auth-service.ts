import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { ManagementAuthStatus } from '@shared/types'
import { DEFAULT_MANAGEMENT_LOCK_TIMEOUT_MS, emptyUsageHistoryTree } from '@shared/types'
import type { AppCore } from './context'
import { mt } from './i18n'
import { normalizeSameApiKeyState, normalizeSameProxyKeyState, toCredentialView } from './store'

const SCRYPT_KEYLEN = 64

function normalizeLockTimeout(ms: number | null): number | null {
  if (ms === null) return null
  const n = Math.floor(Number(ms) || 0)
  return n > 0 ? n : DEFAULT_MANAGEMENT_LOCK_TIMEOUT_MS
}

function status(core: AppCore): ManagementAuthStatus {
  const auth = core.store.data.settings.managementAuth
  return { enabled: auth.enabled, lockTimeoutMs: auth.lockTimeoutMs }
}

function hashPassword(password: string): { passwordHash: string; passwordSalt: string } {
  const passwordSalt = randomBytes(16).toString('base64')
  const passwordHash = scryptSync(password, passwordSalt, SCRYPT_KEYLEN).toString('base64')
  return { passwordHash, passwordSalt }
}

export function isManagementPasswordValid(core: AppCore, password: string): boolean {
  const { passwordHash, passwordSalt } = core.store.data.managementPassword
  if (!passwordHash || !passwordSalt) return false
  try {
    const expected = Buffer.from(passwordHash, 'base64')
    const actual = scryptSync(password, passwordSalt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function requirePassword(core: AppCore, password: string): void {
  if (!isManagementPasswordValid(core, password)) throw new Error(mt('err.badManagementPassword'))
}

function broadcastSettings(core: AppCore): void {
  core.events.emit('settings.changed', { ...core.store.data.settings })
}

function broadcastCredentials(core: AppCore): void {
  const credentials = core.store.data.credentials.slice().sort((a, b) => a.order - b.order)
  core.events.emit(
    'credentials.changed',
    credentials.map((c) => toCredentialView(c, credentials))
  )
}

function broadcastProxies(core: AppCore): void {
  core.events.emit(
    'proxies.changed',
    core.store.data.proxies.slice().sort((a, b) => a.order - b.order)
  )
}

export function registerManagementAuthService(core: AppCore): void {
  core.queries.register('managementAuth.status', () => status(core))

  core.commands.register('managementAuth.enable', ({ password, lockTimeoutMs }) => {
    const trimmed = password.trim()
    if (trimmed.length < 4) throw new Error(mt('err.managementPasswordTooShort'))
    const hashed = hashPassword(trimmed)
    core.store.mutate((db) => {
      db.managementPassword = hashed
      db.settings.managementAuth = {
        enabled: true,
        lockTimeoutMs: normalizeLockTimeout(lockTimeoutMs)
      }
    })
    broadcastSettings(core)
    return status(core)
  })

  core.commands.register('managementAuth.disable', ({ password }) => {
    requirePassword(core, password.trim())
    core.store.mutate((db) => {
      db.managementPassword = {}
      db.settings.managementAuth = { enabled: false, lockTimeoutMs: normalizeLockTimeout(db.settings.managementAuth.lockTimeoutMs) }
    })
    broadcastSettings(core)
    return status(core)
  })

  core.commands.register('managementAuth.verify', ({ password }) => ({ ok: isManagementPasswordValid(core, password.trim()) }))

  core.commands.register('managementAuth.updateLockTimeout', ({ lockTimeoutMs }) => {
    core.store.mutate((db) => {
      db.settings.managementAuth = {
        ...db.settings.managementAuth,
        lockTimeoutMs: normalizeLockTimeout(lockTimeoutMs)
      }
    })
    broadcastSettings(core)
    return status(core)
  })

  core.commands.register('managementAuth.resetByDeletingAllCredentials', () => {
    core.store.mutate((db) => {
      db.credentials = []
      db.proxies = []
      db.usageHistory = emptyUsageHistoryTree()
      db.managementPassword = {}
      db.settings.managementAuth = { enabled: false, lockTimeoutMs: DEFAULT_MANAGEMENT_LOCK_TIMEOUT_MS }
      normalizeSameApiKeyState(db.credentials)
      normalizeSameProxyKeyState(db.proxies)
    })
    broadcastSettings(core)
    broadcastCredentials(core)
    broadcastProxies(core)
    return status(core)
  })
}
