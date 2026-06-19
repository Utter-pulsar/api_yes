<div align="center">
  <img src="./assets/logo.png" alt="API YES" width="120" />

  <h1>API&nbsp;YES</h1>

  <h3>A hand-drawn gateway for your AI subscriptions.</h3>
  <p>Sign in to ChatGPT or Claude (or paste an API key), then spin up metered, local reverse-proxy endpoints — all in a warm, doodle-style window.</p>

  <p>
    <a href="./LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-5B8DEF.svg" /></a>
    <img alt="Platforms" src="https://img.shields.io/badge/platform-win%20%7C%20mac%20%7C%20linux-2B2B2B.svg" />
    <img alt="Electron 34" src="https://img.shields.io/badge/Electron-34-47848F.svg?logo=electron&logoColor=white" />
    <img alt="Status: actively tinkered on" src="https://img.shields.io/badge/status-actively%20tinkered%20on-D97757.svg" />
  </p>

  <h4>
    English &nbsp;|&nbsp; <a href="./README.zh-CN.md">简体中文</a>
  </h4>
</div>

<br />

<div align="center">
  <img src="./img/app.png" alt="API YES screenshot" width="820" />
</div>

<br />

API YES is a tiny desktop app that turns _"I'm signed in to ChatGPT / Claude"_ into _"here's a localhost endpoint my tools can use"_ — and shows you exactly how many tokens each one is burning. Everything is hand-drawn — wobbly Rough.js borders, the Excalifont typeface, a warm paper grid — so a job that's usually a sterile dashboard feels like scribbling in the corner of a notebook.

## Features

- 🎨&nbsp;&nbsp;**Hand-drawn, everywhere** — sketchy Rough.js borders, Excalifont + Xiaolai (小赖), a warm paper-grid canvas.
- 🔑&nbsp;&nbsp;**Two ways to connect** — sign in to a **ChatGPT** (Plus / Pro / Team) or **Claude** (Pro / Max) subscription via OAuth, or paste an **OpenAI / Anthropic API key** (custom & relay base URLs welcome).
- 🔌&nbsp;&nbsp;**Your own local endpoints** — every credential can spawn _any number_ of reverse-proxy endpoints, each with its own URL + key. Point your tool's base URL at it and go.
- 📊&nbsp;&nbsp;**Per-key metering** — requests, input / output / cached / reasoning tokens, broken down by model and resettable any time.
- 🚦&nbsp;&nbsp;**Token caps** — set a total-token ceiling per key; it returns 429 once it's used up.
- 🌐&nbsp;&nbsp;**Per-key access scope** — keep a key loopback-only, or flip it to **Allow LAN**. The server binds `0.0.0.0` only when some key opts in; loopback-only keys are still 403-gated.
- 🧠&nbsp;&nbsp;**Format-faithful forwarding** — OpenAI in → OpenAI out, Anthropic in → Anthropic out (so `thinking` / beta params survive). ChatGPT/Codex subscriptions get `/chat/completions` → `/responses` translation plus a curated `/models`.
- 🌍&nbsp;&nbsp;**Bilingual UI** — switch the _entire_ app between **English** and **中文** on the fly.
- 🌓&nbsp;&nbsp;**Light / dark paper** themes.
- 🖥️&nbsp;&nbsp;**Run in background** — minimize to a tray, auto-start the server on launch, launch at login.
- 🔄&nbsp;&nbsp;**Silent auto-update** — new versions download, install, and relaunch on their own (Windows / Linux).
- 🔒&nbsp;&nbsp;**Local-first & encrypted** — everything lives in one local file; OAuth tokens and keys are encrypted with the OS keychain (`safeStorage`). Nothing leaves your machine except the upstream calls you make.
- 🖥️&nbsp;&nbsp;**Cross-platform** — Windows, macOS and Linux (Electron).
- ⚒️&nbsp;&nbsp;**Hackable core** — a typed query / command / event contract drives the whole app.

## Why API YES?

I have a couple of AI subscriptions, but all my little scripts and tools just want a plain **base URL + key**. I wanted a warm little control panel that lives on my desktop, turns a sign-in into a localhost endpoint my tools can actually use, and shows me — at a glance — how many tokens each one is eating. Most gateway tools are grey dashboards and rigid forms; I wanted something that bounces when you poke it and doodles in the margins.

So I started building it for myself. **This is a personal project**, and now that this version feels good, I'll keep polishing it in my spare time. If you have an idea, a wish, or you hit a bug, **please open an [issue](../../issues)!** 💛

## Quick start — using the proxy

1. In **Settings**, make sure the **API server** is running (default `127.0.0.1:8788`; the port is editable and it auto-starts by default).
2. **Add a credential** → open it → **New API** → copy its URL + key.
3. Point your tool's base URL at it:
   - **OpenAI** clients → `http://127.0.0.1:8788/v1`, API key = the proxy key.
   - **Anthropic** clients → `http://127.0.0.1:8788`, API key = the proxy key.
4. Call as usual — usage tallies live on that endpoint.

> Tip: right-click a credential in the left list for a quick **test / rename / delete** menu.

## Getting started (development)

API YES is built with Electron + Vite + React.

```bash
# install dependencies
npm install

# run in dev mode (hot reload, uses a separate dev data folder)
npm run dev

# type-check
npm run typecheck

# production build → out/
npm run build

# package an installer for your OS
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

Your data is stored locally in your OS app-data folder (OAuth tokens & API keys encrypted via the OS keychain):

- **Windows** — `%APPDATA%\API-YES\api-yes.json`
- **macOS** — `~/Library/Application Support/API-YES/api-yes.json`
- **Linux** — `~/.config/API-YES/api-yes.json`

On **macOS**, because the build is unsigned, drag `API-YES.app` into `/Applications` and then run:

```bash
sudo xattr -cr /Applications/API-YES.app
# if it still says "damaged", add a local ad-hoc signature:
sudo codesign --force --deep --sign - /Applications/API-YES.app
```

On **Linux (deb)**, if the sandbox complains, give `chrome-sandbox` the setuid bit:

```bash
sudo apt install -y ./API-YES_*_amd64.deb
sudo chmod 4755 /opt/API-YES/chrome-sandbox
```

## Tech stack

Electron · electron-vite · React 19 · Zustand · Tailwind CSS · framer-motion · Rough.js · TypeScript.

## Notes & known limits

- **ChatGPT subscription (OAuth)** tokens reach only the **Codex backend** (`/responses`), not `/chat/completions` directly. The app translates Chat Completions → Responses and serves a curated model list (kept in `src/main/services/provider/upstream.ts` → `CODEX_CHATGPT_MODELS`); **Test connection** probes the candidates and reports the first that answers. When OpenAI ships new models, that list needs a refresh.
- **Claude subscription (OAuth)** requests to `/v1/messages` get the Claude Code system prefix + an `anthropic-beta` oauth header injected automatically (subscription tokens are rejected otherwise).
- Usage metering skips very large (> 16 MB) streamed responses — they're still forwarded, just not billed.
- The proxy server defaults to loopback only; it binds `0.0.0.0` (LAN) **only** when some key is set to **Allow LAN** — evaluate the risk yourself before exposing keys.

## License

API YES is released under the [GNU GPLv3](./LICENSE).

Any modified or derivative version — whether **distributed** or **offered as a network service** — must:

- stay licensed under **GPLv3 / AGPLv3**,
- **keep the original copyright notice**,
- **clearly state what was changed**.
