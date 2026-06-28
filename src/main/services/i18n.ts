import type { Lang } from '@shared/types'

/**
 * Main-process i18n. The renderer owns the language switch (localStorage); it mirrors the choice
 * into AppSettings, and the boot sequence + settings.update keep this module-level `current` in
 * sync. Main-side messages (test results, errors, the OAuth callback page, the tray menu) are
 * translated through `mt()`. Strings frozen into stored data (default credential names, plan
 * labels) are translated once at creation time using whatever language is active then.
 */
type Entry = { zh: string; en: string }

let current: Lang = 'zh'

export function setMainLang(l: Lang | undefined | null): void {
  if (l === 'zh' || l === 'en') current = l
}

export function currentLang(): Lang {
  return current
}

/** Join a list with the locale-appropriate separator ("、" for zh, ", " for en). */
export function listJoin(items: string[]): string {
  return items.join(current === 'zh' ? '、' : ', ')
}

const DICT: Record<string, Entry> = {
  // ── tray ──
  'tray.show': { zh: '显示 {app}', en: 'Show {app}' },
  'tray.quit': { zh: '退出', en: 'Quit' },

  // ── oauth callback page ──
  'oauthpage.ok': { zh: '✅ 授权成功', en: '✅ Authorized' },
  'oauthpage.fail': { zh: '⚠️ 授权失败', en: '⚠️ Authorization failed' },
  'oauthpage.close': { zh: '可以关闭此页面，返回 API-YES。', en: 'You can close this page and return to API-YES.' },

  // ── oauth flow ──
  'oauth.connectedChatgpt': { zh: '已连接 ChatGPT 订阅', en: 'Connected to ChatGPT subscription' },
  'oauth.missingCode': { zh: '回调缺少 code', en: 'Callback is missing the code' },
  'oauth.stateMismatch': { zh: 'state 不匹配（可能存在 CSRF）', en: 'state mismatch (possible CSRF)' },
  'oauth.portInUse': { zh: '本地端口 {port} 被占用，无法接收回调', en: 'Local port {port} is in use; cannot receive the callback' },
  'oauth.sessionExpired': { zh: '授权会话已过期，请重新发起', en: 'Authorization session expired; please start again' },
  'oauth.noPasteNeeded': { zh: '该授权方式无需手动粘贴', en: 'This method does not require pasting a code' },
  'oauth.success': { zh: '授权成功', en: 'Authorized' },
  'oauth.openaiAuthFail': { zh: 'OpenAI 授权失败 ({status})：{t}', en: 'OpenAI authorization failed ({status}): {t}' },
  'oauth.openaiRefreshFail': { zh: 'OpenAI 刷新令牌失败 ({status})：{t}', en: 'OpenAI token refresh failed ({status}): {t}' },
  'oauth.anthropicAuthFail': { zh: 'Anthropic 授权失败 ({status})：{t}', en: 'Anthropic authorization failed ({status}): {t}' },
  'oauth.anthropicRefreshFail': { zh: 'Anthropic 刷新令牌失败 ({status})：{t}', en: 'Anthropic token refresh failed ({status}): {t}' },

  // ── default names / plan labels (frozen into stored data at creation) ──
  'name.claudeSub': { zh: 'Claude 订阅', en: 'Claude subscription' },
  'name.chatgptSub': { zh: 'ChatGPT 订阅', en: 'ChatGPT subscription' },
  'name.providerCred': { zh: '{provider} 凭证', en: '{provider} credential' },

  // ── credential / proxy errors ──
  'err.credNotFound': { zh: '凭证不存在', en: 'Credential not found' },
  'err.authNotFound': { zh: '授权不存在', en: 'Credential not found' },
  'err.keyExists': { zh: '该 Key 已存在，请换一个', en: 'That key already exists; choose another' },
  'err.proxyNotFound': { zh: 'API Key 不存在', en: 'API key not found' },

  // ── proxy server (runtime) ──
  'proxy.portTaken': { zh: '端口 {port} 已被占用', en: 'Port {port} is already in use' },
  'proxy.missingKey': { zh: '缺少 API Key（Authorization: Bearer 或 x-api-key）', en: 'Missing API key (Authorization: Bearer or x-api-key)' },
  'proxy.invalidKey': { zh: '无效的 API Key', en: 'Invalid API key' },
  'proxy.keyDisabled': { zh: '该 API Key 已停用', en: 'This API key is disabled' },
  'proxy.credGone': { zh: '该 API Key 对应的授权已不存在', en: "This API key's credential no longer exists" },
  'proxy.credDisabled': { zh: '该授权已停用', en: 'This credential is disabled' },
  'proxy.localOnly': { zh: '该 API Key 仅允许本机访问（如需局域网，请在该 Key 上改为“允许局域网”）', en: 'This API key only allows local access (enable “Allow LAN” on this key for LAN access)' },
  'proxy.capHit': { zh: '已达该 API Key 的用量上限', en: "This API key's usage cap has been reached" },
  'proxy.readBodyFailed': { zh: '读取请求体失败', en: 'Failed to read the request body' },
  'proxy.upstreamFailed': { zh: '连接上游失败：{e}', en: 'Failed to reach upstream: {e}' },
  'proxy.badJson': { zh: '请求体不是合法 JSON', en: 'Request body is not valid JSON' },
  'proxy.upstreamError': { zh: '上游错误：{t}', en: 'Upstream error: {t}' },
  'proxy.toast': { zh: '代理 {status}：{message}', en: 'Proxy {status}: {message}' },

  // ── upstream (test connection / list models) ──
  'up.missingOAuthToken': { zh: '凭证缺少 OAuth 访问令牌，请重新登录', en: 'Credential is missing an OAuth access token; please sign in again' },
  'up.missingApiKey': { zh: '凭证缺少 API Key', en: 'Credential is missing an API key' },
  'up.codexModels': { zh: 'Codex 可用模型（ChatGPT 订阅）· {n} 个', en: 'Codex models (ChatGPT subscription) · {n}' },
  'up.listFailed': { zh: '获取失败 ({status})：{t}', en: 'Fetch failed ({status}): {t}' },
  'up.modelCount': { zh: '共 {n} 个模型', en: '{n} models' },
  'up.authFailRelogin': { zh: '鉴权失败：令牌无效或已过期，请重新登录 ({status})', en: 'Auth failed: token invalid or expired; please sign in again ({status})' },
  'up.okModels': { zh: '连接正常 · 可用模型：{list}', en: 'Connected · models: {list}' },
  'up.okNoCandidate': { zh: '连接正常（已鉴权）· 未匹配到内置候选模型，可在工具里手动指定模型', en: 'Connected (authenticated) · no built-in candidate model matched; specify a model manually in your tool' },
  'up.cannotConnect': { zh: '无法连接：{e}', en: 'Cannot connect: {e}' },
  'up.networkError': { zh: '网络错误', en: 'network error' },
  'up.okWithMsg': { zh: '连接正常 · {m}', en: 'Connected · {m}' },
  'up.okSubAuthed': { zh: '连接正常 · 订阅已鉴权', en: 'Connected · subscription authenticated' },
  'up.authFail': { zh: '鉴权失败：令牌无效或已过期 ({status})', en: 'Auth failed: token invalid or expired ({status})' },
  'up.okAuthed': { zh: '连接正常（已鉴权）', en: 'Connected (authenticated)' },

  // ── subscription usage / quota ──
  'usage.onlySub': { zh: '仅订阅授权支持额度查询', en: 'Usage is only available for subscription credentials' },
  'usage.authFail': { zh: '鉴权失败：令牌无效或已过期 ({status})', en: 'Auth failed: token invalid or expired ({status})' },
  'usage.noWindows': { zh: '暂无额度数据（可能尚未产生用量，或当前套餐不提供）', en: 'No usage data (no usage yet, or your plan does not expose it)' },

  // ── updater ──
  'update.unsupported': { zh: '当前平台暂不支持自动更新', en: 'Auto-update is not supported on this platform' },
  'update.devMode': { zh: '开发模式下不检查更新', en: 'Updates are not checked in development mode' }
}

/** Translate `key` into the current main-process language, interpolating `{var}` placeholders. */
export function mt(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key]
  let s = entry ? entry[current] : key
  if (vars) {
    for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]))
  }
  return s
}
