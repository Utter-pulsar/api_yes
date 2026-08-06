import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { app } from 'electron'
import {
  APP_NAME,
  DEFAULT_MANAGEMENT_PORT,
  DEV_MANAGEMENT_PORT,
  MANAGEMENT_STATUS_FILE
} from '@shared/constants'
import { DEFAULT_BASE_URL, DEFAULT_MANAGEMENT_LOCK_TIMEOUT_MS, type ManagementAuthStatus, type Provider } from '@shared/types'
import type { AppCore } from './context'
import { isManagementPasswordValid } from './management-auth-service'

type JsonObject = Record<string, unknown>

interface ManagementStatusFile {
  name: string
  env: 'dev' | 'prod'
  host: '127.0.0.1'
  port: number
  token: string
  pid: number
  startedAt: number
}

const HOST = '127.0.0.1' as const
const MAX_PORT_PROBES = 20
const MAX_BODY_BYTES = 1024 * 1024

function authStatus(core: AppCore): ManagementAuthStatus {
  const auth = core.store.data.settings.managementAuth
  return { enabled: auth.enabled, lockTimeoutMs: auth.lockTimeoutMs }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function providerValue(value: unknown): Provider {
  if (value === 'openai' || value === 'anthropic') return value
  throw new Error('provider must be "openai" or "anthropic"')
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function bearer(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  return undefined
}

function splitPath(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

export class ManagementServer {
  private server: Server | null = null
  private readonly token = randomBytes(32).toString('base64url')
  private readonly sessions = new Set<string>()
  private port = app.isPackaged ? DEFAULT_MANAGEMENT_PORT : DEV_MANAGEMENT_PORT

  constructor(private readonly core: AppCore) {}

  async start(): Promise<void> {
    if (this.server) return
    const preferred = app.isPackaged ? DEFAULT_MANAGEMENT_PORT : DEV_MANAGEMENT_PORT
    for (let i = 0; i < MAX_PORT_PROBES; i += 1) {
      const port = preferred + i
      const server = createServer((req, res) => void this.handle(req, res))
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false))
        server.listen(port, HOST, () => resolve(true))
      })
      if (!ok) continue
      this.server = server
      this.port = port
      this.writeStatusFile()
      return
    }
    console.warn(`[management] failed to bind ${HOST}:${preferred}-${preferred + MAX_PORT_PROBES - 1}`)
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.sessions.clear()
    this.removeStatusFile()
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private statusPath(): string {
    return join(app.getPath('userData'), MANAGEMENT_STATUS_FILE)
  }

  private writeStatusFile(): void {
    const payload: ManagementStatusFile = {
      name: APP_NAME,
      env: app.isPackaged ? 'prod' : 'dev',
      host: HOST,
      port: this.port,
      token: this.token,
      pid: process.pid,
      startedAt: Date.now()
    }
    writeFileSync(this.statusPath(), JSON.stringify(payload, null, 2), 'utf8')
  }

  private removeStatusFile(): void {
    const path = this.statusPath()
    if (existsSync(path)) unlinkSync(path)
  }

  private hasServerToken(req: IncomingMessage): boolean {
    return req.headers['x-api-yes-token'] === this.token
  }

  private hasSession(req: IncomingMessage): boolean {
    const session = bearer(req) ?? stringValue(req.headers['x-api-yes-session'])
    return !!session && this.sessions.has(session)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.hasServerToken(req)) {
        json(res, 403, { error: 'invalid management server token' })
        return
      }

      const url = new URL(req.url ?? '/', `http://${HOST}`)
      const parts = splitPath(url.pathname)
      const method = req.method ?? 'GET'
      const loginRoute = method === 'POST' && parts.length === 2 && parts[0] === 'auth' && parts[1] === 'login'
      const authStatusRoute = method === 'GET' && parts.length === 2 && parts[0] === 'auth' && parts[1] === 'status'
      const disableRoute = method === 'POST' && parts.length === 2 && parts[0] === 'auth' && parts[1] === 'disable'
      const healthRoute = method === 'GET' && parts.length === 1 && parts[0] === 'healthz'

      if (!loginRoute && !authStatusRoute && !disableRoute && !healthRoute && this.core.store.data.settings.managementAuth.enabled && !this.hasSession(req)) {
        json(res, 401, { error: 'management password required', code: 'AUTH_REQUIRED' })
        return
      }

      await this.route(method, parts, req, res)
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  private async route(method: string, parts: string[], req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (method === 'GET' && parts.length === 1 && parts[0] === 'healthz') {
      json(res, 200, {
        ok: true,
        name: APP_NAME,
        env: app.isPackaged ? 'prod' : 'dev',
        managementAuth: authStatus(this.core),
        proxy: await this.core.queries.execute('proxy.status', undefined)
      })
      return
    }

    if (parts[0] === 'auth') {
      await this.routeAuth(method, parts, req, res)
      return
    }
    if (parts[0] === 'credentials') {
      await this.routeCredentials(method, parts, req, res)
      return
    }
    if (parts[0] === 'apis') {
      await this.routeApis(method, parts, req, res)
      return
    }
    if (parts[0] === 'usage') {
      await this.routeUsage(method, parts, res)
      return
    }
    if (parts[0] === 'proxy') {
      await this.routeProxy(method, parts, res)
      return
    }

    json(res, 404, { error: 'not found' })
  }

  private async routeAuth(method: string, parts: string[], req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (method === 'GET' && parts.length === 2 && parts[1] === 'status') {
      json(res, 200, { managementAuth: authStatus(this.core), authenticated: this.hasSession(req) })
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'login') {
      const body = await readJson(req)
      const password = isObject(body) ? stringValue(body.password).trim() : ''
      if (!this.core.store.data.settings.managementAuth.enabled) {
        json(res, 200, { ok: true, managementAuth: authStatus(this.core), sessionToken: null })
        return
      }
      if (!isManagementPasswordValid(this.core, password)) {
        json(res, 401, { ok: false, error: 'management password is incorrect' })
        return
      }
      const sessionToken = randomBytes(32).toString('base64url')
      this.sessions.add(sessionToken)
      json(res, 200, { ok: true, managementAuth: authStatus(this.core), sessionToken })
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'logout') {
      const session = bearer(req) ?? stringValue(req.headers['x-api-yes-session'])
      if (session) this.sessions.delete(session)
      json(res, 200, { ok: true })
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'enable') {
      const body = await readJson(req)
      if (!isObject(body)) throw new Error('management auth payload must be an object')
      const password = stringValue(body.password).trim()
      const lockTimeoutMs = body.lockTimeoutMs === null ? null : numberOrUndefined(body.lockTimeoutMs)
      const managementAuth = await this.core.commands.execute('managementAuth.enable', { password, lockTimeoutMs: lockTimeoutMs === undefined ? DEFAULT_MANAGEMENT_LOCK_TIMEOUT_MS : lockTimeoutMs })
      const sessionToken = randomBytes(32).toString('base64url')
      this.sessions.add(sessionToken)
      json(res, 200, { ok: true, managementAuth, sessionToken })
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'disable') {
      const body = await readJson(req)
      if (!isObject(body)) throw new Error('management auth payload must be an object')
      const managementAuth = await this.core.commands.execute('managementAuth.disable', { password: stringValue(body.password) })
      this.sessions.clear()
      json(res, 200, { ok: true, managementAuth })
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'lock-timeout') {
      const body = await readJson(req)
      if (!isObject(body)) throw new Error('management auth payload must be an object')
      const lockTimeoutMs = body.lockTimeoutMs === null ? null : numberOrUndefined(body.lockTimeoutMs)
      const managementAuth = await this.core.commands.execute('managementAuth.updateLockTimeout', { lockTimeoutMs: lockTimeoutMs ?? null })
      json(res, 200, { ok: true, managementAuth })
      return
    }
    json(res, 404, { error: 'not found' })
  }

  private async routeCredentials(method: string, parts: string[], req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (method === 'GET' && parts.length === 1) {
      json(res, 200, await this.core.queries.execute('credentials.list', undefined))
      return
    }

    if (method === 'POST' && parts.length === 1) {
      const body = await readJson(req)
      if (!isObject(body)) throw new Error('credential payload must be an object')
      const provider = providerValue(body.provider)
      const apiKey = stringValue(body.apiKey).trim()
      if (!apiKey) throw new Error('apiKey is required')
      const credential = await this.core.commands.execute('credentials.createApiKey', {
        provider,
        name: stringValue(body.name),
        baseUrl: stringValue(body.baseUrl, DEFAULT_BASE_URL[provider]),
        apiKey
      })
      json(res, 200, credential)
      return
    }

    if (parts.length >= 2) {
      const id = parts[1]
      if (method === 'GET' && parts.length === 2) {
        json(res, 200, await this.core.queries.execute('credentials.get', { id }))
        return
      }
      if (method === 'PATCH' && parts.length === 2) {
        const body = await readJson(req)
        if (!isObject(body)) throw new Error('credential patch must be an object')
        const patch = {
          name: optionalString(body.name),
          baseUrl: optionalString(body.baseUrl),
          apiKey: optionalString(body.apiKey),
          enabled: boolOrUndefined(body.enabled)
        }
        json(res, 200, await this.core.commands.execute('credentials.update', { id, patch }))
        return
      }
      if (method === 'DELETE' && parts.length === 2) {
        await this.core.commands.execute('credentials.delete', { id })
        json(res, 200, { ok: true })
        return
      }
      if (method === 'GET' && parts.length === 3 && parts[2] === 'apis') {
        json(res, 200, await this.core.queries.execute('proxies.list', { credentialId: id }))
        return
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'apis') {
        const body = await readJson(req)
        if (!isObject(body)) throw new Error('api payload must be an object')
        const endpoint = await this.core.commands.execute('proxies.create', {
          credentialId: id,
          name: optionalString(body.name),
          key: optionalString(body.key)
        })
        json(res, 200, endpoint)
        return
      }
    }

    json(res, 404, { error: 'not found' })
  }

  private async routeApis(method: string, parts: string[], req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (method === 'GET' && parts.length === 1) {
      json(res, 200, await this.core.queries.execute('proxies.list', {}))
      return
    }
    if (parts.length < 2) {
      json(res, 404, { error: 'not found' })
      return
    }

    const id = parts[1]
    if (method === 'PATCH' && parts.length === 2) {
      const body = await readJson(req)
      if (!isObject(body)) throw new Error('api patch must be an object')
      const patch = {
        name: optionalString(body.name),
        key: optionalString(body.key),
        enabled: boolOrUndefined(body.enabled),
        localOnly: boolOrUndefined(body.localOnly),
        limitTotalTokens: numberOrUndefined(body.limitTotalTokens)
      }
      json(res, 200, await this.core.commands.execute('proxies.update', { id, patch }))
      return
    }
    if (method === 'DELETE' && parts.length === 2) {
      await this.core.commands.execute('proxies.delete', { id })
      json(res, 200, { ok: true })
      return
    }
    if (method === 'POST' && parts.length === 3 && parts[2] === 'regenerate-key') {
      json(res, 200, await this.core.commands.execute('proxies.regenerateKey', { id }))
      return
    }
    if (method === 'POST' && parts.length === 3 && parts[2] === 'reset-usage') {
      json(res, 200, await this.core.commands.execute('proxies.resetUsage', { id }))
      return
    }

    json(res, 404, { error: 'not found' })
  }

  private async routeUsage(method: string, parts: string[], res: ServerResponse): Promise<void> {
    if (method === 'GET' && parts.length === 2 && parts[1] === 'app') {
      json(res, 200, await this.core.queries.execute('usage.history', { scope: 'app' }))
      return
    }
    if (method === 'GET' && parts.length === 3 && parts[1] === 'credentials') {
      json(res, 200, await this.core.queries.execute('usage.history', { scope: 'credential', id: parts[2] }))
      return
    }
    if (method === 'GET' && parts.length === 3 && parts[1] === 'apis') {
      json(res, 200, await this.core.queries.execute('usage.history', { scope: 'proxy', id: parts[2] }))
      return
    }
    json(res, 404, { error: 'not found' })
  }

  private async routeProxy(method: string, parts: string[], res: ServerResponse): Promise<void> {
    if (method === 'GET' && parts.length === 2 && parts[1] === 'status') {
      json(res, 200, await this.core.queries.execute('proxy.status', undefined))
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'start') {
      json(res, 200, await this.core.commands.execute('proxy.start', undefined))
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'stop') {
      json(res, 200, await this.core.commands.execute('proxy.stop', undefined))
      return
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'restart') {
      json(res, 200, await this.core.commands.execute('proxy.restart', undefined))
      return
    }
    json(res, 404, { error: 'not found' })
  }
}
