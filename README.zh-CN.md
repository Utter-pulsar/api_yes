<div align="center">
  <img src="./assets/logo.png" alt="API YES" width="120" />

  <h1>API&nbsp;YES</h1>

  <h3>给你的 AI 订阅用的手绘风网关。</h3>
  <p>登录 ChatGPT 或 Claude（或粘贴 API Key），一键开出可计量的本地反向代理端点 —— 全程在一个温暖的涂鸦风窗口里完成。</p>

  <p>
    <a href="./LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-5B8DEF.svg" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-win%20%7C%20mac%20%7C%20linux-2B2B2B.svg" />
    <img alt="Electron 34" src="https://img.shields.io/badge/Electron-34-47848F.svg?logo=electron&logoColor=white" />
    <img alt="持续更新中" src="https://img.shields.io/badge/状态-持续更新中-D97757.svg" />
  </p>

  <h4>
    <a href="./README.md">English</a> &nbsp;|&nbsp; 简体中文
  </h4>
</div>

<br />

<div align="center">
  <img src="./img/app.png" alt="API YES 截图" width="820" />
</div>

<br />

API YES 是一个小小的桌面应用，把「我登录了 ChatGPT / Claude」变成「这是一个我的工具能直接用的 localhost 端点」—— 并实时告诉你每个端点烧了多少 token。这里的一切都是手绘的 —— Rough.js 抖动的线条、Excalifont 手写字体、温暖的纸张网格 —— 让一件本该是冰冷仪表盘的事，变得像在本子角落里涂鸦。

## 功能特性

- 🎨&nbsp;&nbsp;**处处手绘** —— Rough.js 手绘线框、Excalifont + 小赖字体、暖色纸张网格画布。
- 🔑&nbsp;&nbsp;**两种连接方式** —— 通过 OAuth 登录 **ChatGPT**（Plus / Pro / Team）或 **Claude**（Pro / Max）订阅，或直接粘贴 **OpenAI / Anthropic 的 API Key**（支持自建 / 中转地址）。
- 🔌&nbsp;&nbsp;**你自己的本地端点** —— 每个授权都能开出**任意多个**反向代理端点，各有独立的地址 + Key。把工具的 base URL 指过去就能用。
- 📊&nbsp;&nbsp;**按 Key 计量** —— 请求数、输入 / 输出 / 缓存 / 推理 tokens，可按模型细分、随时清零。
- 🚦&nbsp;&nbsp;**用量上限** —— 给每个 Key 设总 token 上限，用尽即返回 429。
- 🌐&nbsp;&nbsp;**按 Key 控制访问范围** —— 某个 Key 可设为「仅本机」，也可改成「允许局域网」。只有当某个 Key 开了局域网，服务器才会绑定 `0.0.0.0`；仅本机的 Key 依然有 403 兜底。
- 🧠&nbsp;&nbsp;**格式保真转发** —— OpenAI 进 → OpenAI 出，Anthropic 进 → Anthropic 出（`thinking` / beta 参数不会丢）。ChatGPT/Codex 订阅会自动把 `/chat/completions` 翻译成 `/responses`，并提供一份内置 `/models`。
- 🌍&nbsp;&nbsp;**双语界面** —— **中文 / English** 全局一键实时切换。
- 🌓&nbsp;&nbsp;**白天 / 夜间**纸张主题。
- 🖥️&nbsp;&nbsp;**后台运行** —— 关闭收进系统托盘、开机自动启动服务、开机自启。
- 🔄&nbsp;&nbsp;**静默自动更新** —— 有新版会自动下载、安装并重启（Windows / Linux）。
- 🔒&nbsp;&nbsp;**本地优先、加密存储** —— 所有数据都在本地的单个文件里；OAuth 令牌与 Key 用系统钥匙串（`safeStorage`）加密。除了你主动发起的上游调用，没有任何东西离开你的电脑。
- 🖥️&nbsp;&nbsp;**跨平台** —— Windows、macOS、Linux（基于 Electron）。
- ⚒️&nbsp;&nbsp;**可扩展内核** —— 带类型的 query / command / event 契约驱动整个应用。

## 我为什么要做 API YES？

我手上有几个 AI 订阅，但我那些小脚本、小工具只认一个朴素的 **base URL + Key**。我想要一个待在桌面上的温暖小面板：把一次登录变成工具能直接用的 localhost 端点，还能一眼看清每个端点吃了多少 token。大多数网关工具都是灰扑扑的仪表盘和死板的表单；而我想要的，是戳一下会弹一弹、边角还会涂鸦的那种东西。

于是我就先为自己做了它。**这是一个个人项目**，现在这一版我自己用着挺顺手了，之后只要有空我就会继续打磨。如果你有任何想法、心愿，或者发现了 bug —— **欢迎在 [issues](../../issues) 里告诉我！** 💛

## 快速上手 —— 怎么用反代

1. 在「**设置**」里确认 **API 服务器**已启动（默认 `127.0.0.1:8788`，端口可改，默认开机自动启动）。
2. **添加一个授权** → 点开它 → **新建 API** → 复制它的地址和 Key。
3. 把你工具里的 base URL 指过去：
   - **OpenAI** 客户端 → `http://127.0.0.1:8788/v1`，API Key 填反代的 Key。
   - **Anthropic** 客户端 → `http://127.0.0.1:8788`，API Key 填反代的 Key。
4. 正常调用即可 —— 消耗会实时累计到这个端点上。

> 小技巧：在左侧列表的授权上**右击**，可以快速「测试连接 / 重命名 / 删除」。

## 开始使用（开发）

API YES 基于 Electron + Vite + React 构建。

```bash
# 安装依赖
npm install

# 开发模式运行（热更新，使用独立的开发数据目录）
npm run dev

# 类型检查
npm run typecheck

# 生产构建 → out/
npm run build

# 为你的系统打包安装程序
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

数据保存在系统的应用数据目录里（OAuth 令牌与 API Key 经系统钥匙串加密）：

- **Windows** —— `%APPDATA%\API-YES\api-yes.json`
- **macOS** —— `~/Library/Application Support/API-YES/api-yes.json`
- **Linux** —— `~/.config/API-YES/api-yes.json`

**macOS** 上由于安装包未签名，把 `API-YES.app` 拖进「应用程序」后，打开终端运行：

```bash
sudo xattr -cr /Applications/API-YES.app
# 如果还是提示「已损坏」，再补一条本地 ad-hoc 签名：
sudo codesign --force --deep --sign - /Applications/API-YES.app
```

**Linux（deb）** 上如果沙箱报错，给 `chrome-sandbox` 设置 setuid 位：

```bash
sudo apt install -y ./API-YES_*_amd64.deb
sudo chmod 4755 /opt/API-YES/chrome-sandbox
```

## 技术栈

Electron · electron-vite · React 19 · Zustand · Tailwind CSS · framer-motion · Rough.js · TypeScript。

## 说明与已知限制

- **ChatGPT 订阅 (OAuth)** 的令牌只能访问 **Codex 后端**（`/responses`），不支持直接调 `/chat/completions`。应用会自动把 Chat Completions 翻译成 Responses，并内置一份「当前可用 Codex 模型」清单（在 `src/main/services/provider/upstream.ts` 的 `CODEX_CHATGPT_MODELS`）；「测试连接」会逐个探测并报告第一个可用的模型。官方上新模型后这份清单需要更新。
- **Claude 订阅 (OAuth)** 转发 `/v1/messages` 时会自动注入 Claude Code 系统前缀与 `anthropic-beta` oauth 头（否则订阅令牌会被拒）。
- 用量统计对超大（> 16MB）的流式响应会跳过计量（仍正常转发）。
- 反代服务器默认只监听 `127.0.0.1`；只有当某个 Key 设为「允许局域网」时才会绑定 `0.0.0.0`，暴露前请自行评估风险。

## 许可证

API YES 基于 [GNU GPLv3](./LICENSE) 开源。

任何修改版或衍生版 —— 无论是以**分发**还是**网络服务**的形式提供 —— 都必须：

- 继续以 **GPLv3 / AGPLv3** 许可，
- **保留原始版权声明**，
- **明确标注所做的修改**。
