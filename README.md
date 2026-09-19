# DevOps Toolbox

> A local, AI-first toolkit for developers and security researchers. Built with Electron + React + TypeScript.

[🇨🇳 中文文档](./README.zh-CN.md)

DevOps Toolbox opens straight into an AI chat. Ask in plain language and it can call its built-in tools — HTTP client, traffic capture, encoding/hashing, JWT, recon, and more — to actually get the job done. Beyond the chat, it also ships as a standalone toolbox of **53 utilities across 11 categories**.

## Features

- **AI chat with tool calling** — streaming replies, reasoning (thinking) blocks that auto-collapse when a turn ends, and a multi-model switcher right in the composer.
- **Markdown-native replies** — tables, syntax-highlighted code, and task lists render out of the box; links open in your system browser.
- **Local-first** — chat history is stored on your machine; the tools themselves need no server.
- **HTTP client & traffic proxy** — craft requests with custom headers/bodies, and capture traffic with MITM, rewrite rules, and system-proxy takeover. Egress supports HTTP(S) and SOCKS5 proxies.
- **Encoding & security toolkit** — Base64, hashes, JWT, JSON/YAML, CIDR/subnet math, plus offsec and reference helpers.
- **MCP server** — expose the toolbox's capabilities to any MCP-compatible client.
- **Bilingual UI** — Chinese by default, switchable to English.

## Getting started

### Download

Grab the latest installer from [GitHub Releases](https://github.com/topul/devtoolbox/releases). Builds are provided for:

| Platform | Formats |
| --- | --- |
| Windows | Setup, Portable, MSI |
| macOS | DMG, ZIP (Intel & Apple Silicon) |
| Linux | AppImage, DEB |

### Build from source

Requirements: **Node.js 20+** and npm.

```bash
npm install
npm run build          # builds renderer, main, preload, and the MCP bundle
npm run package:all    # packages installers for macOS, Windows and Linux
```

Run in development mode:

```bash
npm run dev
```

### Add an AI model

Open the chat, click the model menu in the composer (or open the settings drawer), then add a profile with:

- **Base URL** — e.g. `https://api.openai.com/v1`
- **API Key**
- **Model** — e.g. `gpt-4o-mini`

You can add several profiles and switch between them on the fly.

## Architecture

```
src/                  Renderer (React): app shell, tools, chat views, UI primitives
electron/main/        Main process: chat SSE engine, agent loop, proxy, MCP client, IPC
electron/mcp/         MCP capability server (bundled as a single zero-dependency file)
src/lib/toolkit/      Framework-agnostic pure functions shared by the renderer and MCP
scripts/              Smoke tests and the screenshot / layout harness
```

The streaming chat runs on a custom IPC transport (the AI SDK's `useChat` wired to the main process), so the renderer never talks to model providers directly — preserving the main process's proxy, TLS, and custom-header handling.

## Development

```bash
npm run typecheck       # type-check the renderer and node sides
npm run i18n:check      # ensure zh/en locale keys stay in sync
npm run smoke:render    # SSR smoke test for every tool (both languages)
npm run smoke:chat      # streaming chat
npm run smoke:chatagent # in-chat tool calling
npm run smoke:mcp       # MCP server
npm run smoke:proxy     # HTTP / traffic-proxy core
npm run build           # production build
```

## Internationalization

The UI ships in Chinese (default) and English. Translations live in `src/lib/locales/` and are keyed per tool plus shared `registry` / `ui` modules. This README is bilingual too: [English](./README.md) · [中文](./README.zh-CN.md).

## License

Released under the [MIT License](./LICENSE).
