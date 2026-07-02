import { useStore } from '../store'

export type Lang = 'zh' | 'en'

type Entry = { zh: string; en: string }

/** Flat translation dictionary. Keys are dotted ids; values carry both languages. Use {var}
 *  placeholders for interpolation (see `t`). */
const DICT: Record<string, Entry> = {
  // ── common ──
  'common.ok': { zh: '好的', en: 'OK' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.save': { zh: '保存', en: 'Save' },
  'common.saving': { zh: '保存中…', en: 'Saving…' },
  'common.delete': { zh: '删除', en: 'Delete' },
  'common.rename': { zh: '重命名', en: 'Rename' },
  'common.copy': { zh: '复制', en: 'Copy' },
  'common.show': { zh: '显示', en: 'Show' },
  'common.hide': { zh: '隐藏', en: 'Hide' },
  'common.refresh': { zh: '刷新', en: 'Refresh' },
  'common.loading': { zh: '加载中…', en: 'Loading…' },
  'common.enable': { zh: '启用', en: 'Enable' },

  // ── title bar / menu / about ──
  'menu.aria': { zh: '菜单', en: 'Menu' },
  'menu.settings': { zh: '⚙️ 设置', en: '⚙️ Settings' },
  'menu.themeDark': { zh: '🌙 夜间模式', en: '🌙 Dark mode' },
  'menu.themeLight': { zh: '☀️ 白天模式', en: '☀️ Light mode' },
  'menu.about': { zh: '🏷️ 版本', en: '🏷️ Version' },
  'about.version': { zh: '版本 {v}', en: 'Version {v}' },
  'about.author': { zh: '作者 {a}', en: 'Author {a}' },
  'about.upToDate': { zh: '已是最新版本 ✓', en: 'Up to date ✓' },
  'about.updateFailed': { zh: '更新失败：{m}', en: 'Update failed: {m}' },
  'about.updateHint': { zh: '有新版本会自动下载、安装并重启', en: 'New versions auto-download, install, and restart' },
  'update.checking': { zh: '检查中…', en: 'Checking…' },
  'update.downloading': { zh: '下载中 {p}%', en: 'Downloading {p}%' },
  'update.installing': { zh: '即将重启安装…', en: 'Restarting to install…' },
  'update.check': { zh: '检查更新', en: 'Check for updates' },
  'update.checkingDots': { zh: '检查更新中…', en: 'Checking for updates…' },
  'update.downloadBar': { zh: '下载更新 {p}%', en: 'Downloading {p}%' },
  'win.min': { zh: '最小化', en: 'Minimize' },
  'win.max': { zh: '最大化', en: 'Maximize' },
  'win.restore': { zh: '还原', en: 'Restore' },
  'win.close': { zh: '关闭', en: 'Close' },

  // ── settings ──
  'settings.title': { zh: '设置', en: 'Settings' },
  'settings.apiServer': { zh: 'API 服务器', en: 'API server' },
  'settings.running': { zh: '运行中 · 端口 {p}', en: 'Running · port {p}' },
  'settings.startFailed': { zh: '启动失败', en: 'Start failed' },
  'settings.stopped': { zh: '已停止', en: 'Stopped' },
  'settings.port': { zh: '端口', en: 'Port' },
  'settings.bindHint': {
    zh: '监听地址自动决定：某个 API Key 开了「允许局域网」就绑定 0.0.0.0，否则只监听本机。每个 Key 的访问范围在它自己那里单独设置。',
    en: 'The bind address is automatic: it binds 0.0.0.0 when some API key allows LAN, otherwise loopback only. Each key sets its own access scope.'
  },
  'settings.start': { zh: '启动', en: 'Start' },
  'settings.stop': { zh: '停止', en: 'Stop' },
  'settings.stoppedPort': { zh: '已停止 · 端口 {p}', en: 'Stopped · port {p}' },
  'settings.collapse': { zh: '折叠', en: 'Collapse' },
  'settings.expand': { zh: '展开', en: 'Expand' },
  'settings.autostart': { zh: '开机自动启动 API 服务器', en: 'Auto-start API server' },
  'settings.autostartHint': { zh: '应用启动时自动开启 API 服务器', en: 'Start the API server when the app launches' },
  'settings.background': { zh: '关闭后保持后台运行', en: 'Keep running after close' },
  'settings.backgroundHint': { zh: '点关闭只把窗口收进系统托盘，API 服务继续', en: 'Closing hides to the tray; the API keeps serving' },
  'settings.launchAtLogin': { zh: '开机自动启动', en: 'Launch at login' },
  'settings.launchAtLoginHint': { zh: '开机时自动在后台启动 API-YES', en: 'Start API-YES in the background at login' },
  'settings.language': { zh: '语言', en: 'Language' },

  // ── sidebar ──
  'sidebar.title': { zh: '授权 / 凭证', en: 'Credentials' },
  'sidebar.add': { zh: '＋ 添加', en: '＋ Add' },
  'sidebar.empty': {
    zh: '还没有任何授权。点 “＋ 添加” 来登录 OpenAI / Anthropic 订阅，或粘贴一个 API Key。',
    en: 'No credentials yet. Click "＋ Add" to sign in to an OpenAI / Anthropic subscription, or paste an API key.'
  },
  'sidebar.apiCount': { zh: '{n} 个 API', en: '{n} API(s)' },
  'sidebar.disabled': { zh: '已停用', en: 'Disabled' },

  // ── badges ──
  'badge.oauth': { zh: '订阅授权', en: 'Subscription' },
  'badge.apikey': { zh: 'API Key', en: 'API key' },

  // ── add credential ──
  'add.title': { zh: '添加授权', en: 'Add credential' },
  'add.nameOptional': { zh: '名称（可选）', en: 'Name (optional)' },
  'add.namePlaceholderOpenai': { zh: '我的 OpenAI', en: 'My OpenAI' },
  'add.namePlaceholderAnthropic': { zh: '我的 Claude', en: 'My Claude' },
  'add.provider': { zh: '服务商', en: 'Provider' },
  'add.method': { zh: '方式', en: 'Method' },
  'add.methodOauth': { zh: '订阅授权', en: 'Subscription' },
  'add.methodApikey': { zh: 'API Key', en: 'API key' },
  'add.apiBase': { zh: 'API 地址', en: 'API base URL' },
  'add.apiBaseHint': { zh: '一般保持默认即可；自建/中转可改成你的地址', en: 'Keep the default, or set your own/relay URL' },
  'add.apiKey': { zh: 'API Key', en: 'API key' },
  'add.test': { zh: '测试', en: 'Test' },
  'add.testing': { zh: '测试中…', en: 'Testing…' },
  'add.add': { zh: '添加', en: 'Add' },
  'add.adding': { zh: '添加中…', en: 'Adding…' },
  'add.oauthAnthropicDesc': {
    zh: '登录你的 Claude 订阅（Pro / Max）。会打开浏览器完成授权，然后把页面给出的 code 粘回来。',
    en: 'Sign in to your Claude subscription (Pro / Max). A browser opens for authorization; paste back the code it shows.'
  },
  'add.oauthOpenaiDesc': {
    zh: '登录你的 ChatGPT 订阅（Plus / Pro / Team）。会打开浏览器完成授权，授权后自动返回。',
    en: 'Sign in to your ChatGPT subscription (Plus / Pro / Team). A browser opens; it returns automatically after authorization.'
  },
  'add.openBrowser': { zh: '🔑 打开浏览器登录', en: '🔑 Open browser to sign in' },
  'add.manualOpen': { zh: '没有自动打开？点这里手动打开授权链接', en: "Didn't open? Click to open the link manually" },
  'add.pasteLabel': { zh: '把页面显示的 code 粘贴到这里', en: 'Paste the code shown on the page' },
  'add.finish': { zh: '完成授权', en: 'Finish' },
  'add.verifying': { zh: '验证中…', en: 'Verifying…' },
  'add.loopbackWaiting': { zh: '请在浏览器中完成登录，完成后会自动返回…', en: 'Finish signing in in the browser; it returns automatically…' },
  'add.cancelAuth': { zh: '取消本次授权', en: 'Cancel this authorization' },
  'add.added': { zh: '已添加凭证', en: 'Credential added' },
  'add.authSuccess': { zh: '授权成功', en: 'Authorized' },

  // ── credential detail ──
  'detail.emptyPick': { zh: '从左边选一个授权，或先添加一个', en: 'Pick a credential on the left, or add one' },
  'detail.enabled': { zh: '已启用', en: 'Enabled' },
  'detail.disabled': { zh: '已停用', en: 'Disabled' },
  'detail.enableLabel': { zh: '启用此授权', en: 'Enable this credential' },
  'detail.disabledBanner': {
    zh: '此授权已停用，其下所有 API 会返回 403。打开右上角开关即可恢复。',
    en: 'This credential is disabled; all its APIs return 403. Toggle it back on to restore.'
  },
  'detail.apiBase': { zh: 'API 地址：', en: 'API base: ' },
  'detail.key': { zh: 'Key：', en: 'Key: ' },
  'detail.account': { zh: '账号：{e}', en: 'Account: {e}' },
  'detail.plan': { zh: '订阅：{p}', en: 'Plan: {p}' },
  'detail.tokenValid': { zh: '令牌有效 · {t} 过期', en: 'Token valid · expires {t}' },
  'detail.tokenExpired': { zh: '令牌已过期（下次调用会自动刷新）', en: 'Token expired (auto-refreshes on next call)' },
  'detail.testConn': { zh: '🔌 测试连接', en: '🔌 Test connection' },
  'detail.testing': { zh: '测试中…', en: 'Testing…' },
  'detail.models': { zh: '📋 模型列表', en: '📋 Models' },
  'detail.edit': { zh: '✏️ 编辑', en: '✏️ Edit' },
  'detail.delete': { zh: '🗑 删除', en: '🗑 Delete' },
  'detail.deleteConfirm': { zh: '删除「{n}」？其下所有 API 也会一起删除', en: 'Delete "{n}"? All its APIs will be removed too' },
  'detail.deleted': { zh: '已删除', en: 'Deleted' },

  // ── edit credential ──
  'edit.title': { zh: '编辑凭证', en: 'Edit credential' },
  'edit.name': { zh: '名称', en: 'Name' },
  'edit.apiBase': { zh: 'API 地址', en: 'API base URL' },
  'edit.apiKey': { zh: 'API Key', en: 'API key' },
  'edit.keyHint': { zh: '留空则不修改（当前 {p}）', en: 'Leave blank to keep (current {p})' },
  'edit.keyPlaceholder': { zh: '留空表示不修改', en: 'Leave blank to keep current' },
  'edit.testNewKey': { zh: '测试新 Key', en: 'Test new key' },
  'edit.saved': { zh: '已保存', en: 'Saved' },

  // ── model list ──
  'models.title': { zh: '模型列表', en: 'Models' },
  'models.copyHint': { zh: '点击复制模型 ID', en: 'Click to copy the model id' },
  'models.none': { zh: '没有模型', en: 'No models' },
  'models.copied': { zh: '已复制 {id}', en: 'Copied {id}' },

  // ── subscription usage / quota ──
  'detail.usage': { zh: '📊 订阅额度', en: '📊 Usage' },
  'usage.title': { zh: '订阅额度', en: 'Subscription usage' },
  'usage.loading': { zh: '正在查询额度…', en: 'Checking usage…' },
  'usage.empty': { zh: '暂无额度信息', en: 'No usage info' },
  'usage.subtitle': { zh: '订阅周期内的用量', en: 'Usage within your subscription windows' },
  'usage.resetIn': { zh: '{t} 后重置', en: 'Resets in {t}' },
  'usage.win.5h': { zh: '5 小时用量', en: '5-hour usage' },
  'usage.win.weekly': { zh: '本周用量', en: 'Weekly usage' },
  'usage.win.weekly_opus': { zh: '本周 Opus 用量', en: 'Weekly Opus usage' },
  'usage.win.weekly_sonnet': { zh: '本周 Sonnet 用量', en: 'Weekly Sonnet usage' },
  'usage.dur.d': { zh: '{n} 天', en: '{n}d' },
  'usage.dur.h': { zh: '{n} 小时', en: '{n}h' },
  'usage.dur.m': { zh: '{n} 分钟', en: '{n}m' },

  // ── usage history (daily per-model ledger: heatmap / bar chart dialog) ──
  'detail.history': { zh: '📈 使用额度记录', en: '📈 Usage history' },
  'api.history': { zh: '用量记录', en: 'Usage history' },
  'uh.title': { zh: '使用额度记录', en: 'Usage history' },
  'uh.modeHeat': { zh: '方块图', en: 'Heatmap' },
  'uh.modeBars': { zh: '柱状图', en: 'Bar chart' },
  'uh.rangeHeat': { zh: '近半年', en: 'last 6 months' },
  'uh.rangeBars': { zh: '近 30 天', en: 'last 30 days' },
  'uh.total': { zh: '总用量', en: 'Total usage' },
  'uh.reqs': { zh: '{n} 次请求', en: '{n} req' },
  'uh.tokensN': { zh: '{n} tokens', en: '{n} tokens' },
  'uh.ttTotal': { zh: '合计', en: 'Total' },
  'uh.noUsage': { zh: '这一天没有用量', en: 'No usage this day' },
  'uh.empty': { zh: '这段时间还没有任何用量记录', en: 'Nothing recorded in this period yet' },
  'uh.unknownModel': { zh: '未知模型', en: 'Unknown model' },
  'uh.less': { zh: '少', en: 'Less' },
  'uh.more': { zh: '多', en: 'More' },
  'uh.dow.mon': { zh: '一', en: 'Mon' },
  'uh.dow.wed': { zh: '三', en: 'Wed' },
  'uh.dow.fri': { zh: '五', en: 'Fri' },

  // ── API (proxy) list ──
  'api.title': { zh: 'API 列表', en: 'APIs' },
  'api.new': { zh: '＋ 新建 API', en: '＋ New API' },
  'api.serverDown': { zh: 'API 服务器未运行，去「设置」里启动，或开启「开机自动启动」。', en: "The API server isn't running. Start it in Settings, or enable auto-start." },
  'api.empty': {
    zh: '还没有 API。点「＋ 新建 API」生成一个带独立地址 + Key 的端点，把它的地址 + Key 填进你的工具即可使用。',
    en: 'No APIs yet. Click "＋ New API" to create an endpoint with its own URL + key, then put them into your tool.'
  },
  'api.namePrompt': { zh: '给这个 API Key 起个名字', en: 'Name this API key' },
  'api.defaultName': { zh: 'API #{n}', en: 'API #{n}' },
  'api.created': { zh: '已创建 API Key', en: 'API key created' },
  'api.addr': { zh: '地址', en: 'URL' },
  'api.key': { zh: 'Key', en: 'Key' },
  'api.scope': { zh: '访问范围', en: 'Access' },
  'api.localOnly': { zh: '仅本机', en: 'Local only' },
  'api.lan': { zh: '允许局域网', en: 'Allow LAN' },
  'api.lanHint': { zh: '局域网内用上面的地址访问', en: 'Reachable on the LAN at the URL above' },
  'api.mReq': { zh: '请求', en: 'Reqs' },
  'api.mIn': { zh: '输入', en: 'Input' },
  'api.mOut': { zh: '输出', en: 'Output' },
  'api.mReason': { zh: '推理', en: 'Reason' },
  'api.mInTitle': { zh: '{t} tokens（含缓存 {c}）', en: '{t} tokens (incl. cached {c})' },
  'api.mTokensTitle': { zh: '{t} tokens', en: '{t} tokens' },
  'api.renameTitle': { zh: '点击重命名', en: 'Click to rename' },
  'api.copiedAddr': { zh: '已复制地址', en: 'URL copied' },
  'api.copiedKey': { zh: '已复制 Key', en: 'Key copied' },
  'api.renamePrompt': { zh: '重命名 API', en: 'Rename API' },
  'api.customKeyPrompt': { zh: '自定义 Key（留空取消）', en: 'Custom key (blank to cancel)' },
  'api.keyUpdated': { zh: '已更新 Key', en: 'Key updated' },
  'api.regenConfirm': { zh: '重新生成 Key？旧 Key 会立即失效', en: 'Regenerate key? The old key stops working immediately' },
  'api.regenerated': { zh: '已生成新 Key', en: 'New key generated' },
  'api.resetConfirm': { zh: '清零这个 API 的用量统计？', en: "Reset this API's usage stats?" },
  'api.limitPrompt': { zh: '总 tokens 上限（输入＋输出，留空或 0 = 不限）', en: 'Total token cap (in+out; blank or 0 = unlimited)' },
  'api.limitSet': { zh: '已设上限 {n} tokens', en: 'Cap set to {n} tokens' },
  'api.limitCleared': { zh: '已取消上限', en: 'Cap removed' },
  'api.deleteConfirm': { zh: '删除 API「{n}」？', en: 'Delete API "{n}"?' },
  'api.cap': { zh: '用量上限', en: 'Usage cap' },
  'api.capHit': { zh: '用量上限（已用尽）', en: 'Usage cap (used up)' },
  'api.setLimit': { zh: '设上限', en: 'Set cap' },
  'api.changeLimit': { zh: '改上限', en: 'Edit cap' },
  'api.customKey': { zh: '自定义 Key', en: 'Custom key' },
  'api.regen': { zh: '重新生成', en: 'Regenerate' },
  'api.resetUsage': { zh: '清零用量', en: 'Reset usage' },
  'api.delete': { zh: '删除', en: 'Delete' },

  // ── context menu ──
  'ctx.rename': { zh: '重命名', en: 'Rename' },
  'ctx.test': { zh: '测试连接', en: 'Test connection' },
  'ctx.delete': { zh: '删除', en: 'Delete' },

  // ── app shell / errors ──
  'app.loading': { zh: '正在铺开画纸…', en: 'Unrolling the canvas…' },
  'error.title': { zh: '出错了 😵', en: 'Something broke 😵' },
  'error.reload': { zh: '重新加载', en: 'Reload' }
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key]
  let s = entry ? entry[lang] : key
  if (vars) {
    for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]))
  }
  return s
}

/** Hook returning a translator bound to the current language. */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useStore((s) => s.lang)
  return (key, vars) => translate(lang, key, vars)
}
