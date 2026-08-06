#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { CLI_SESSION_FILE, MANAGEMENT_STATUS_FILE } from '@shared/constants'
import { formatCompactNumber, parseCompactNumber } from '@shared/number-format'
import type { CredentialView, ManagementAuthStatus, ProxyEndpoint, ProxyServerStatus, UsageHistoryReport } from '@shared/types'

interface StatusFile {
  name: string
  env: 'dev' | 'prod'
  host: '127.0.0.1'
  port: number
  token: string
  pid: number
  startedAt: number
}

interface CliSession {
  env: 'dev' | 'prod'
  sessionToken: string
  savedAt: number
}

type Env = 'dev' | 'prod'
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type JsonObject = Record<string, unknown>

interface KeypressInfo {
  name?: string
  sequence?: string
  ctrl?: boolean
}

let env: Env = 'dev'
let commandArgs: string[] = []

function initCli(rawArgs: string[]): void {
  const args = rawArgs.filter((arg) => arg !== '--apiyes-cli')
  env = readEnv(args)
  commandArgs = stripEnvArgs(args)
}

function appDataDir(target: Env): string {
  const appName = target === 'dev' ? 'API-YES-dev' : 'API-YES'
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), appName)
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', appName)
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), appName)
}

function statusPath(): string {
  return join(appDataDir(env), MANAGEMENT_STATUS_FILE)
}

function sessionPath(): string {
  return join(appDataDir(env), CLI_SESSION_FILE)
}

function readEnv(argv: string[]): Env {
  const i = argv.indexOf('--env')
  const value = i >= 0 ? argv[i + 1] : process.env.APIYES_ENV
  return value === 'prod' ? 'prod' : 'dev'
}

function stripEnvArgs(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env') {
      i += 1
      continue
    }
    out.push(argv[i])
  }
  return out
}

function readStatus(): StatusFile {
  const file = statusPath()
  if (!existsSync(file)) {
    throw new Error(
      env === 'dev'
        ? '未找到开发版 API-YES。请先运行 npm run dev。'
        : '未找到 API-YES。请先启动已安装的 API-YES。'
    )
  }
  return JSON.parse(readFileSync(file, 'utf8')) as StatusFile
}

function readSession(): string | undefined {
  const file = sessionPath()
  if (!existsSync(file)) return undefined
  try {
    const session = JSON.parse(readFileSync(file, 'utf8')) as CliSession
    return session.env === env ? session.sessionToken : undefined
  } catch {
    return undefined
  }
}

function saveSession(sessionToken: string): void {
  writeFileSync(sessionPath(), JSON.stringify({ env, sessionToken, savedAt: Date.now() } satisfies CliSession, null, 2), 'utf8')
}

function clearSession(): void {
  const file = sessionPath()
  if (existsSync(file)) unlinkSync(file)
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function request<T>(method: HttpMethod, path: string, body?: unknown, retryLogin = true): Promise<T> {
  const status = readStatus()
  const session = readSession()
  const headers: Record<string, string> = {
    'x-api-yes-token': status.token,
    'content-type': 'application/json'
  }
  if (session) headers.authorization = `Bearer ${session}`
  const res = await fetch(`http://${status.host}:${status.port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  if (res.status === 401 && retryLogin) {
    await loginInteractive()
    return request<T>(method, path, body, false)
  }
  if (!res.ok) {
    const msg = isObject(payload) ? String(payload.error ?? res.statusText) : res.statusText
    throw new Error(msg)
  }
  return payload as T
}

async function prompt(label: string, defaultValue = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : ''
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    return answer || defaultValue
  } finally {
    rl.close()
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) return prompt(label)
  return new Promise<string>((resolve) => {
    let value = ''
    let cleanup = (): void => {}
    const onKey = (str: string, key: KeypressInfo): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup()
        process.exit(130)
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup()
        process.stdout.write('\n')
        resolve(value.trim())
        return
      }
      if (key.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1)
          process.stdout.write('\b \b')
        }
        return
      }
      if (key.name === 'escape') return
      if (str >= ' ') {
        value += str
        process.stdout.write('•')
      }
    }
    process.stdout.write(`${label}: `)
    cleanup = withRawInput(onKey)
  })
}

async function pause(): Promise<void> {
  await prompt('按 Enter 继续', '')
}

async function confirm(label: string): Promise<boolean> {
  const answer = (await prompt(`${label} (y/N)`, '')).toLowerCase()
  return answer === 'y' || answer === 'yes' || answer === '是'
}

function clear(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1Bc')
}

function short(id: string): string {
  return id.slice(0, 8)
}

function compact(n: number): string {
  return formatCompactNumber(n)
}

function grouped(n: number): string {
  return n.toLocaleString('en-US')
}

function parseAmount(input: string): number | undefined {
  return parseCompactNumber(input)
}

function parseLockTimeout(input: string): number | null | undefined {
  const s = input.trim().toLowerCase().replace(/\s+/g, '')
  if (!s || s === 'never' || s === 'none' || s === 'off' || s === '永久' || s === '不锁定' || s === '永久不锁定') {
    return null
  }
  const hit = /^(\d+(?:\.\d+)?|\.\d+)(ms|毫秒|s|sec|secs|second|seconds|秒|m|min|mins|minute|minutes|分钟|分)?$/.exec(s)
  if (!hit) return undefined
  const value = Number(hit[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  const unit = hit[2] ?? 'm'
  const ms = unit === 'ms' || unit === '毫秒'
    ? value
    : unit.startsWith('s') || unit === '秒' || unit.startsWith('sec')
      ? value * 1000
      : value * 60 * 1000
  return Math.max(1000, Math.floor(ms))
}

function formatLockTimeout(ms: number | null): string {
  if (ms === null) return '永久'
  if (ms % 60000 === 0) return `${ms / 60000}m`
  return `${Math.max(1, Math.round(ms / 1000))}s`
}

function totalUsage(report: UsageHistoryReport): { requests: number; inputTokens: number; outputTokens: number } {
  const total = { requests: 0, inputTokens: 0, outputTokens: 0 }
  for (const day of Object.values(report.days)) {
    for (const usage of Object.values(day)) {
      total.requests += usage.requests
      total.inputTokens += usage.inputTokens
      total.outputTokens += usage.outputTokens
    }
  }
  return total
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function commandName(): 'apiyes' | 'apiyesdev' {
  return env === 'prod' ? 'apiyes' : 'apiyesdev'
}

function printHelp(): void {
  const cmd = commandName()
  console.log(`API-YES CLI (${env})

无参数运行 ${cmd} 会进入交互式 TUI。

用法：
  ${cmd} status
  ${cmd} auth login|logout|enable|disable|lock-timeout <30s|5m|永久>
  ${cmd} credentials list
  ${cmd} credentials add --provider openai|anthropic --name 名称 --key sk-... [--base-url URL]
  ${cmd} credentials enable|disable|delete <credentialId>
  ${cmd} credentials rename <credentialId> <name>
  ${cmd} apis list [--credential credentialId]
  ${cmd} apis add --credential credentialId [--name 名称] [--key local-key]
  ${cmd} apis rename|delete|regenerate-key|reset-usage <apiId>
  ${cmd} apis local-only|lan|enable|disable|unlimited <apiId>
  ${cmd} apis limit <apiId> <tokens>
  ${cmd} usage app|credential <id>|api <id>
  ${cmd} proxy status|start|stop|restart
`)
}

function flag(name: string): string | undefined {
  const i = commandArgs.indexOf(name)
  return i >= 0 ? commandArgs[i + 1] : undefined
}

function withRawInput(onKey: (str: string, key: KeypressInfo) => void): () => void {
  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.on('keypress', onKey)
  return () => {
    stdin.off('keypress', onKey)
    stdin.setRawMode(wasRaw)
    if (!wasRaw) stdin.pause()
  }
}

function renderChoice(title: string, options: { key: string; label: string }[], body: string, selected: number): void {
  clear()
  console.log(`╭─ API-YES CLI ${env === 'dev' ? '开发版' : '正式版'} ─ ${title}`)
  console.log('')
  if (body) console.log(`${body}\n`)
  console.log('  ↑/↓/←/→ 选择，Enter 确认，数字可快速跳转，Esc 返回')
  console.log('')
  options.forEach((option, i) => {
    const active = i === selected
    const pointer = active ? '❯' : ' '
    const text = `${pointer} ${option.label}`
    console.log(active ? `\x1b[7m${text}\x1b[0m` : text)
  })
}

async function choose(title: string, options: { key: string; label: string }[], body = ''): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    for (;;) {
      clear()
      console.log(`╭─ API-YES CLI ${env === 'dev' ? '开发版' : '正式版'} ─ ${title}`)
      console.log('')
      if (body) console.log(`${body}\n`)
      for (const option of options) console.log(`  ${option.key}. ${option.label}`)
      console.log('')
      const picked = await prompt('选择', '')
      if (options.some((option) => option.key === picked)) return picked
    }
  }

  return new Promise<string>((resolve) => {
    const zeroIndex = options.findIndex((option) => option.key === '0')
    let selected = options.findIndex((option) => option.key !== '0')
    if (selected < 0) selected = 0

    let cleanup = (): void => {}
    const finish = (key: string): void => {
      cleanup()
      process.stdout.write('\x1b[?25h')
      resolve(key)
    }
    const move = (delta: number): void => {
      selected = (selected + delta + options.length) % options.length
      renderChoice(title, options, body, selected)
    }
    const onKey = (str: string, key: KeypressInfo): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup()
        process.stdout.write('\x1b[?25h')
        process.exit(130)
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(options[selected].key)
        return
      }
      if (key.name === 'escape') {
        finish(zeroIndex >= 0 ? options[zeroIndex].key : options[selected].key)
        return
      }
      if (key.name === 'up' || key.name === 'left') {
        move(-1)
        return
      }
      if (key.name === 'down' || key.name === 'right') {
        move(1)
        return
      }
      const quick = options.find((option) => option.key === str.trim())
      if (quick) finish(quick.key)
    }

    process.stdout.write('\x1b[?25l')
    cleanup = withRawInput(onKey)
    renderChoice(title, options, body, selected)
  })
}

async function loginInteractive(): Promise<void> {
  const password = await promptSecret('管理密码')
  const result = await request<{ ok: boolean; sessionToken: string | null }>('POST', '/auth/login', { password }, false)
  if (!result.ok) throw new Error('登录失败')
  if (!result.sessionToken) {
    console.log('管理密码未开启，无需登录')
    return
  }
  saveSession(result.sessionToken)
  console.log('已登录')
}

async function ensureAuthenticated(): Promise<void> {
  const status = await request<{ managementAuth: { enabled: boolean }; authenticated: boolean }>('GET', '/auth/status', undefined, false)
  if (status.managementAuth.enabled && !status.authenticated) await loginInteractive()
}

async function statusCommand(): Promise<void> {
  const result = await request<{
    ok: boolean
    env: Env
    managementAuth: { enabled: boolean; lockTimeoutMs: number | null }
    proxy: ProxyServerStatus
  }>('GET', '/healthz')
  console.log(`API-YES ${result.env === 'dev' ? '开发版' : '正式版'}`)
  console.log(`管理密码：${result.managementAuth.enabled ? '开启' : '关闭'}`)
  console.log(`API 服务器：${result.proxy.running ? `运行中 ${result.proxy.host}:${result.proxy.port}` : `已停止 ${result.proxy.host}:${result.proxy.port}`}`)
}

function printCredentials(credentials: CredentialView[]): void {
  if (credentials.length === 0) {
    console.log('没有授权/凭证')
    return
  }
  for (const c of credentials) {
    console.log(`${c.id}\t${c.enabled ? 'on ' : 'off'}\t${c.provider}\t${c.kind}\t${c.name}\t${c.keyPreview ?? ''}`)
  }
}

function printApis(apis: ProxyEndpoint[]): void {
  if (apis.length === 0) {
    console.log('没有 API')
    return
  }
  for (const api of apis) {
    const used = api.usage.inputTokens + api.usage.outputTokens
    const cap = api.limitTotalTokens ? `/${compact(api.limitTotalTokens)}` : '/∞'
    console.log(`${api.id}\t${api.enabled ? 'on ' : 'off'}\t${api.localOnly ? 'local' : 'lan  '}\t${api.name}\t${compact(used)}${cap}\t${api.key}`)
  }
}

async function credentialsCommand(): Promise<void> {
  const sub = commandArgs[1]
  if (sub === 'list') {
    printCredentials(await request<CredentialView[]>('GET', '/credentials'))
    return
  }
  if (sub === 'add') {
    const provider = flag('--provider')
    const apiKey = flag('--key')
    if ((provider !== 'openai' && provider !== 'anthropic') || !apiKey) throw new Error('需要 --provider openai|anthropic 和 --key')
    const added = await request<CredentialView>('POST', '/credentials', {
      provider,
      apiKey,
      name: flag('--name') ?? '',
      baseUrl: flag('--base-url')
    })
    console.log(`已添加：${added.name} (${added.id})`)
    return
  }
  const id = commandArgs[2]
  if (!id) throw new Error('缺少 credentialId')
  if (sub === 'rename') {
    const name = commandArgs.slice(3).join(' ')
    if (!name) throw new Error('缺少名称')
    const updated = await request<CredentialView>('PATCH', `/credentials/${encodeURIComponent(id)}`, { name })
    console.log(`已重命名：${updated.name}`)
    return
  }
  if (sub === 'enable' || sub === 'disable') {
    const updated = await request<CredentialView>('PATCH', `/credentials/${encodeURIComponent(id)}`, { enabled: sub === 'enable' })
    console.log(`${updated.name} ${updated.enabled ? '已启用' : '已停用'}`)
    return
  }
  if (sub === 'delete') {
    await request<{ ok: boolean }>('DELETE', `/credentials/${encodeURIComponent(id)}`)
    console.log('已删除凭证')
    return
  }
  printHelp()
}

async function apisCommand(): Promise<void> {
  const sub = commandArgs[1]
  if (sub === 'list') {
    const credentialId = flag('--credential')
    printApis(await request<ProxyEndpoint[]>('GET', credentialId ? `/credentials/${encodeURIComponent(credentialId)}/apis` : '/apis'))
    return
  }
  if (sub === 'add') {
    const credentialId = flag('--credential')
    if (!credentialId) throw new Error('需要 --credential credentialId')
    const created = await request<ProxyEndpoint>('POST', `/credentials/${encodeURIComponent(credentialId)}/apis`, {
      name: flag('--name'),
      key: flag('--key')
    })
    console.log(`已创建 API：${created.name} (${created.id})`)
    console.log(created.key)
    return
  }
  const id = commandArgs[2]
  if (!id) throw new Error('缺少 apiId')
  if (sub === 'rename') {
    const name = commandArgs.slice(3).join(' ')
    if (!name) throw new Error('缺少名称')
    const updated = await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(id)}`, { name })
    console.log(`已重命名：${updated.name}`)
    return
  }
  if (sub === 'enable' || sub === 'disable') {
    const updated = await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(id)}`, { enabled: sub === 'enable' })
    console.log(`${updated.name} ${updated.enabled ? '已启用' : '已停用'}`)
    return
  }
  if (sub === 'local-only' || sub === 'lan') {
    const updated = await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(id)}`, { localOnly: sub === 'local-only' })
    console.log(`${updated.name} 访问范围：${updated.localOnly ? '仅本机' : '允许局域网'}`)
    return
  }
  if (sub === 'limit') {
    const limit = parseAmount(commandArgs[3] ?? '')
    if (limit === undefined || limit <= 0) throw new Error('tokens 上限必须是正数，可使用 1k / 1.5m / 2b / 1t')
    const updated = await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(id)}`, { limitTotalTokens: limit })
    console.log(`${updated.name} 上限：${compact(updated.limitTotalTokens ?? 0)}`)
    return
  }
  if (sub === 'unlimited') {
    const updated = await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(id)}`, { limitTotalTokens: 0 })
    console.log(`${updated.name} 已取消上限`)
    return
  }
  if (sub === 'regenerate-key') {
    const updated = await request<ProxyEndpoint>('POST', `/apis/${encodeURIComponent(id)}/regenerate-key`)
    console.log(`已重新生成：${updated.key}`)
    return
  }
  if (sub === 'reset-usage') {
    await request<ProxyEndpoint>('POST', `/apis/${encodeURIComponent(id)}/reset-usage`)
    console.log('已清零用量')
    return
  }
  if (sub === 'delete') {
    await request<{ ok: boolean }>('DELETE', `/apis/${encodeURIComponent(id)}`)
    console.log('已删除 API')
    return
  }
  printHelp()
}

async function usageCommand(): Promise<void> {
  const scope = commandArgs[1]
  let report: UsageHistoryReport
  if (scope === 'app') report = await request<UsageHistoryReport>('GET', '/usage/app')
  else if (scope === 'credential' && commandArgs[2]) report = await request<UsageHistoryReport>('GET', `/usage/credentials/${encodeURIComponent(commandArgs[2])}`)
  else if (scope === 'api' && commandArgs[2]) report = await request<UsageHistoryReport>('GET', `/usage/apis/${encodeURIComponent(commandArgs[2])}`)
  else throw new Error('用法：usage app | usage credential <id> | usage api <id>')
  const total = totalUsage(report)
  console.log(`请求：${grouped(total.requests)}`)
  console.log(`输入 tokens：${compact(total.inputTokens)}`)
  console.log(`输出 tokens：${compact(total.outputTokens)}`)
}

async function proxyCommand(): Promise<void> {
  const sub = commandArgs[1]
  if (sub === 'status') printJson(await request<ProxyServerStatus>('GET', '/proxy/status'))
  else if (sub === 'start') printJson(await request<ProxyServerStatus>('POST', '/proxy/start'))
  else if (sub === 'stop') printJson(await request<ProxyServerStatus>('POST', '/proxy/stop'))
  else if (sub === 'restart') printJson(await request<ProxyServerStatus>('POST', '/proxy/restart'))
  else printHelp()
}

async function authCommand(): Promise<void> {
  const sub = commandArgs[1]
  if (sub === 'login') {
    await loginInteractive()
    return
  }
  if (sub === 'logout') {
    await authLogoutLocal()
    console.log('已退出 CLI 登录')
    return
  }
  if (sub === 'enable') {
    await enableManagementPassword()
    return
  }
  if (sub === 'disable') {
    await disableManagementPassword()
    return
  }
  if (sub === 'lock-timeout') {
    const raw = commandArgs[2]
    if (!raw) throw new Error(`用法：${commandName()} auth lock-timeout <30s|5m|永久>`)
    const lockTimeoutMs = parseLockTimeout(raw)
    if (lockTimeoutMs === undefined) throw new Error('锁定时间格式不正确')
    const result = await request<{ ok: boolean; managementAuth: ManagementAuthStatus }>('POST', '/auth/lock-timeout', { lockTimeoutMs })
    console.log(`已保存 · 自动锁定：${formatLockTimeout(result.managementAuth.lockTimeoutMs)}`)
    return
  }
  printJson(await request<unknown>('GET', '/auth/status'))
}

async function pickCredential(title = '选择授权/凭证'): Promise<CredentialView | null> {
  const credentials = await request<CredentialView[]>('GET', '/credentials')
  if (credentials.length === 0) {
    await pauseWith('还没有授权/凭证。')
    return null
  }
  const key = await choose(
    title,
    [
      ...credentials.map((c, i) => ({ key: String(i + 1), label: `${c.enabled ? '●' : '○'} ${c.name} · ${c.provider} · ${short(c.id)}` })),
      { key: '0', label: '返回' }
    ]
  )
  if (key === '0') return null
  return credentials[Number(key) - 1] ?? null
}

async function pickApi(title = '选择 API', credentialId?: string): Promise<ProxyEndpoint | null> {
  const apis = await request<ProxyEndpoint[]>('GET', credentialId ? `/credentials/${encodeURIComponent(credentialId)}/apis` : '/apis')
  if (apis.length === 0) {
    await pauseWith('还没有 API。')
    return null
  }
  const key = await choose(
    title,
    [
      ...apis.map((api, i) => ({ key: String(i + 1), label: `${api.enabled ? '●' : '○'} ${api.name} · ${api.localOnly ? '仅本机' : '局域网'} · ${short(api.id)}` })),
      { key: '0', label: '返回' }
    ]
  )
  if (key === '0') return null
  return apis[Number(key) - 1] ?? null
}

async function pauseWith(message: string): Promise<void> {
  clear()
  console.log(message)
  await pause()
}

async function tuiAddCredential(): Promise<void> {
  const providerKey = await choose('添加授权/凭证', [
    { key: '1', label: 'OpenAI API Key' },
    { key: '2', label: 'Anthropic API Key' },
    { key: '0', label: '返回' }
  ])
  if (providerKey === '0') return
  const provider = providerKey === '1' ? 'openai' : 'anthropic'
  const name = await prompt('名称（可选）', provider === 'openai' ? 'My OpenAI' : 'My Claude')
  const baseUrl = await prompt('API 地址（可保持默认）', provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com')
  const apiKey = await promptSecret('API Key')
  if (!apiKey) return
  const added = await request<CredentialView>('POST', '/credentials', { provider, name, baseUrl, apiKey })
  await pauseWith(`已添加：${added.name}\nID: ${added.id}`)
}

async function tuiCreateApi(credentialId?: string): Promise<void> {
  const credential = credentialId ? null : await pickCredential('选择要挂载 API 的授权')
  const id = credentialId ?? credential?.id
  if (!id) return
  const name = await prompt('API 名称', 'API')
  const custom = await confirm('要自定义本地 Key 吗？')
  const key = custom ? await promptSecret('本地 Key') : undefined
  const created = await request<ProxyEndpoint>('POST', `/credentials/${encodeURIComponent(id)}/apis`, { name, key })
  await pauseWith(`已创建 API：${created.name}\nID: ${created.id}\nKey: ${created.key}`)
}

async function tuiCredentialDetail(credential: CredentialView): Promise<void> {
  for (;;) {
    const fresh = await request<CredentialView | null>('GET', `/credentials/${encodeURIComponent(credential.id)}`)
    if (!fresh) {
      await pauseWith('这个授权/凭证已不存在。')
      return
    }
    const key = await choose(
      `授权/凭证 · ${fresh.name}`,
      [
        { key: '1', label: '查看 / 管理下面的 API' },
        { key: '2', label: '新建 API' },
        { key: '3', label: '重命名' },
        { key: '4', label: fresh.enabled ? '停用这个授权' : '启用这个授权' },
        { key: '5', label: '查看用量' },
        { key: '6', label: '删除这个授权/凭证' },
        { key: '0', label: '返回' }
      ],
      `ID: ${fresh.id}\n服务商: ${fresh.provider}\n类型: ${fresh.kind}\n状态: ${fresh.enabled ? '启用' : '停用'}\n${fresh.keyPreview ? `Key: ${fresh.keyPreview}` : ''}`
    )
    if (key === '0') return
    if (key === '1') await tuiApis(fresh.id)
    else if (key === '2') await tuiCreateApi(fresh.id)
    else if (key === '3') {
      const name = await prompt('新名称', fresh.name)
      await request<CredentialView>('PATCH', `/credentials/${encodeURIComponent(fresh.id)}`, { name })
    } else if (key === '4') {
      await request<CredentialView>('PATCH', `/credentials/${encodeURIComponent(fresh.id)}`, { enabled: !fresh.enabled })
    } else if (key === '5') {
      await showUsage(`/usage/credentials/${encodeURIComponent(fresh.id)}`)
    } else if (key === '6' && (await confirm(`删除「${fresh.name}」以及下面所有 API？`))) {
      await request<{ ok: boolean }>('DELETE', `/credentials/${encodeURIComponent(fresh.id)}`)
      await pauseWith('已删除。')
      return
    }
  }
}

async function tuiCredentials(): Promise<void> {
  for (;;) {
    const key = await choose('授权/凭证', [
      { key: '1', label: '查看 / 管理授权' },
      { key: '2', label: '添加 OpenAI / Anthropic API Key' },
      { key: '0', label: '返回' }
    ])
    if (key === '0') return
    if (key === '2') await tuiAddCredential()
    if (key === '1') {
      const credential = await pickCredential()
      if (credential) await tuiCredentialDetail(credential)
    }
  }
}

async function currentApi(id: string): Promise<ProxyEndpoint | null> {
  const apis = await request<ProxyEndpoint[]>('GET', '/apis')
  return apis.find((api) => api.id === id) ?? null
}

async function tuiApiDetail(api: ProxyEndpoint): Promise<void> {
  for (;;) {
    const fresh = await currentApi(api.id)
    if (!fresh) {
      await pauseWith('这个 API 已不存在。')
      return
    }
    const used = fresh.usage.inputTokens + fresh.usage.outputTokens
    const key = await choose(
      `API · ${fresh.name}`,
      [
        { key: '1', label: '重命名' },
        { key: '2', label: fresh.enabled ? '停用 API' : '启用 API' },
        { key: '3', label: fresh.localOnly ? '改为允许局域网' : '改为仅本机' },
        { key: '4', label: '设置 / 修改 token 上限' },
        { key: '5', label: '取消 token 上限' },
        { key: '6', label: '自定义本地 Key' },
        { key: '7', label: '重新生成 Key' },
        { key: '8', label: '清零用量' },
        { key: '9', label: '查看用量历史' },
        { key: '10', label: '显示完整 Key' },
        { key: '11', label: '删除 API' },
        { key: '0', label: '返回' }
      ],
      `ID: ${fresh.id}\n状态: ${fresh.enabled ? '启用' : '停用'}\n访问范围: ${fresh.localOnly ? '仅本机' : '允许局域网'}\n用量: ${compact(used)}${fresh.limitTotalTokens ? ` / ${compact(fresh.limitTotalTokens)}` : ' / ∞'} tokens`
    )
    if (key === '0') return
    if (key === '1') {
      const name = await prompt('新名称', fresh.name)
      await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(fresh.id)}`, { name })
    } else if (key === '2') {
      await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(fresh.id)}`, { enabled: !fresh.enabled })
    } else if (key === '3') {
      await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(fresh.id)}`, { localOnly: !fresh.localOnly })
    } else if (key === '4') {
      const raw = await prompt('总 tokens 上限（支持 1k / 1.5m / 2b / 1t）', fresh.limitTotalTokens ? compact(fresh.limitTotalTokens) : '1m')
      const limit = parseAmount(raw)
      if (limit !== undefined && limit > 0) await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(fresh.id)}`, { limitTotalTokens: limit })
    } else if (key === '5') {
      await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(fresh.id)}`, { limitTotalTokens: 0 })
    } else if (key === '6') {
      const localKey = await promptSecret('新的本地 Key')
      if (localKey) await request<ProxyEndpoint>('PATCH', `/apis/${encodeURIComponent(fresh.id)}`, { key: localKey })
    } else if (key === '7' && (await confirm('重新生成 Key？旧 Key 会立即失效'))) {
      const updated = await request<ProxyEndpoint>('POST', `/apis/${encodeURIComponent(fresh.id)}/regenerate-key`)
      await pauseWith(`新 Key：${updated.key}`)
    } else if (key === '8' && (await confirm('清零这个 API 的用量？'))) {
      await request<ProxyEndpoint>('POST', `/apis/${encodeURIComponent(fresh.id)}/reset-usage`)
    } else if (key === '9') {
      await showUsage(`/usage/apis/${encodeURIComponent(fresh.id)}`)
    } else if (key === '10') {
      await pauseWith(`Key:\n${fresh.key}`)
    } else if (key === '11' && (await confirm(`删除 API「${fresh.name}」？`))) {
      await request<{ ok: boolean }>('DELETE', `/apis/${encodeURIComponent(fresh.id)}`)
      await pauseWith('已删除。')
      return
    }
  }
}

async function tuiApis(credentialId?: string): Promise<void> {
  for (;;) {
    const key = await choose('API 管理', [
      { key: '1', label: '查看 / 管理 API' },
      { key: '2', label: '新建 API' },
      { key: '0', label: '返回' }
    ])
    if (key === '0') return
    if (key === '2') await tuiCreateApi(credentialId)
    if (key === '1') {
      const api = await pickApi('选择 API', credentialId)
      if (api) await tuiApiDetail(api)
    }
  }
}

async function showUsage(path: string): Promise<void> {
  const report = await request<UsageHistoryReport>('GET', path)
  const total = totalUsage(report)
  await pauseWith(`请求：${grouped(total.requests)}\n输入 tokens：${compact(total.inputTokens)}\n输出 tokens：${compact(total.outputTokens)}`)
}

async function tuiUsage(): Promise<void> {
  const key = await choose('用量记录', [
    { key: '1', label: '应用总用量' },
    { key: '2', label: '选择授权/凭证' },
    { key: '3', label: '选择 API' },
    { key: '0', label: '返回' }
  ])
  if (key === '1') await showUsage('/usage/app')
  else if (key === '2') {
    const credential = await pickCredential('选择授权/凭证查看用量')
    if (credential) await showUsage(`/usage/credentials/${encodeURIComponent(credential.id)}`)
  } else if (key === '3') {
    const api = await pickApi('选择 API 查看用量')
    if (api) await showUsage(`/usage/apis/${encodeURIComponent(api.id)}`)
  }
}

async function tuiProxy(): Promise<void> {
  for (;;) {
    const status = await request<ProxyServerStatus>('GET', '/proxy/status')
    const key = await choose(
      'API 服务器',
      [
        { key: '1', label: status.running ? '停止服务器' : '启动服务器' },
        { key: '2', label: '重启服务器' },
        { key: '0', label: '返回' }
      ],
      `状态: ${status.running ? '运行中' : '已停止'}\n监听: ${status.host}:${status.port}${status.error ? `\n错误: ${status.error}` : ''}`
    )
    if (key === '0') return
    if (key === '1') await request<ProxyServerStatus>('POST', status.running ? '/proxy/stop' : '/proxy/start')
    if (key === '2') await request<ProxyServerStatus>('POST', '/proxy/restart')
  }
}

async function enableManagementPassword(): Promise<void> {
  const password = await promptSecret('新管理密码')
  const again = await promptSecret('重复输入密码')
  if (password !== again) {
    await pauseWith('两次输入的密码不一致。')
    return
  }
  const raw = await prompt('自动锁定时间（支持 30s / 5m / 永久）', '5m')
  const lockTimeoutMs = parseLockTimeout(raw)
  if (lockTimeoutMs === undefined) {
    await pauseWith('锁定时间格式不正确。')
    return
  }
  const result = await request<{ ok: boolean; managementAuth: ManagementAuthStatus; sessionToken: string }>(
    'POST',
    '/auth/enable',
    { password, lockTimeoutMs },
    false
  )
  if (result.sessionToken) saveSession(result.sessionToken)
  await pauseWith(`已开启管理密码 · 自动锁定：${formatLockTimeout(result.managementAuth.lockTimeoutMs)}`)
}

async function disableManagementPassword(): Promise<void> {
  const password = await promptSecret('当前管理密码')
  await request<{ ok: boolean; managementAuth: ManagementAuthStatus }>('POST', '/auth/disable', { password }, false)
  clearSession()
  await pauseWith('已关闭管理密码。')
}

async function updateManagementLockTimeout(current: number | null): Promise<void> {
  const raw = await prompt('自动锁定时间（支持 30s / 5m / 永久）', formatLockTimeout(current))
  const lockTimeoutMs = parseLockTimeout(raw)
  if (lockTimeoutMs === undefined) {
    await pauseWith('锁定时间格式不正确。')
    return
  }
  const result = await request<{ ok: boolean; managementAuth: ManagementAuthStatus }>('POST', '/auth/lock-timeout', { lockTimeoutMs })
  await pauseWith(`已保存 · 自动锁定：${formatLockTimeout(result.managementAuth.lockTimeoutMs)}`)
}

async function tuiAuth(): Promise<void> {
  const info = await request<{ managementAuth: ManagementAuthStatus; authenticated: boolean }>('GET', '/auth/status', undefined, false)
  const options = info.managementAuth.enabled
    ? [
        { key: '1', label: '登录 CLI 会话' },
        { key: '2', label: '退出 CLI 登录' },
        { key: '3', label: '修改自动锁定时间' },
        { key: '4', label: '输入密码关闭管理密码' },
        { key: '0', label: '返回' }
      ]
    : [
        { key: '1', label: '设置新密码并开启管理密码' },
        { key: '0', label: '返回' }
      ]
  const key = await choose(
    'CLI / 管理密码',
    options,
    `管理密码: ${info.managementAuth.enabled ? `开启 · ${formatLockTimeout(info.managementAuth.lockTimeoutMs)}` : '关闭'}\nCLI 会话: ${info.authenticated ? '已登录' : '未登录'}`
  )
  if (key === '0') return
  if (!info.managementAuth.enabled && key === '1') await enableManagementPassword()
  else if (key === '1') await loginInteractive()
  else if (key === '2') {
    await authLogoutLocal()
    await pauseWith('已退出 CLI 登录。')
  } else if (key === '3') await updateManagementLockTimeout(info.managementAuth.lockTimeoutMs)
  else if (key === '4') await disableManagementPassword()
}

async function authLogoutLocal(): Promise<void> {
  try {
    await request<{ ok: boolean }>('POST', '/auth/logout', undefined, false)
  } catch {
    // local cleanup still matters if the app is already gone
  }
  clearSession()
}

async function interactive(): Promise<void> {
  await ensureAuthenticated()
  for (;;) {
    const health = await request<{
      managementAuth: { enabled: boolean }
      proxy: ProxyServerStatus
    }>('GET', '/healthz')
    const key = await choose(
      '主菜单',
      [
        { key: '1', label: '状态总览' },
        { key: '2', label: '管理授权/凭证' },
        { key: '3', label: '管理 API' },
        { key: '4', label: '查看用量' },
        { key: '5', label: 'API 服务器' },
        { key: '6', label: 'CLI / 管理密码' },
        { key: '0', label: '退出' }
      ],
      `管理密码: ${health.managementAuth.enabled ? '开启' : '关闭'}\nAPI 服务器: ${health.proxy.running ? `运行中 ${health.proxy.host}:${health.proxy.port}` : '已停止'}`
    )
    if (key === '0') return
    if (key === '1') await statusTui()
    else if (key === '2') await tuiCredentials()
    else if (key === '3') await tuiApis()
    else if (key === '4') await tuiUsage()
    else if (key === '5') await tuiProxy()
    else if (key === '6') await tuiAuth()
  }
}

async function statusTui(): Promise<void> {
  clear()
  await statusCommand()
  await pause()
}

async function main(): Promise<void> {
  const cmd = commandArgs[0]
  if (!cmd) {
    await interactive()
    return
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') printHelp()
  else if (cmd === 'status') await statusCommand()
  else if (cmd === 'auth') await authCommand()
  else if (cmd === 'credentials') await credentialsCommand()
  else if (cmd === 'apis') await apisCommand()
  else if (cmd === 'usage') await usageCommand()
  else if (cmd === 'proxy') await proxyCommand()
  else printHelp()
}

export async function runCli(rawArgs = process.argv.slice(2)): Promise<void> {
  initCli(rawArgs)
  await main()
}

if (require.main === module) {
  runCli().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
}
