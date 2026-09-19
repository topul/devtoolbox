# DevOps Toolbox

> 面向开发者与安全研究员的本地 AI 优先工具箱，基于 Electron + React + TypeScript 构建。

[🇺🇸 English](./README.md)

DevOps Toolbox 打开即进入 AI 对话。用自然语言提问，它即可调用内置工具——HTTP 客户端、流量抓包、编解码/哈希、JWT、侦察等——真正把事办成。除对话外，它本身也是一套**覆盖 11 大类、53 个工具**的独立工具箱。

## 功能特性

- **带工具调用的 AI 对话** — 流式回复、思考过程（思维链）区块在本轮结束后自动折叠、输入框工具栏内直接切换多模型。
- **原生 Markdown 渲染** — 表格、带语法高亮的代码块、任务列表开箱即用；链接用系统浏览器打开。
- **本地优先** — 对话历史存于本机，工具本身不依赖任何服务器。
- **HTTP 客户端与流量代理** — 自定义请求头/体的请求构造，以及带 MITM、改写规则、系统代理接管的流量抓包；出站支持 HTTP(S) 与 SOCKS5 代理。
- **编解码与安全工具集** — Base64、哈希、JWT、JSON/YAML、CIDR/子网计算，以及攻防与参考辅助。
- **MCP 服务端** — 将工具箱能力暴露给任意兼容 MCP 的客户端。
- **双语界面** — 默认中文，可切换英文。

## 快速开始

### 下载

从 [GitHub Releases](https://github.com/topul/devtoolbox/releases) 获取最新安装包。提供以下平台：

| 平台 | 格式 |
| --- | --- |
| Windows | Setup、Portable、MSI |
| macOS | DMG、ZIP（Intel 与 Apple Silicon） |
| Linux | AppImage、DEB |

### 从源码构建

环境要求：**Node.js 20+** 与 npm。

```bash
npm install
npm run build          # 构建渲染层、主进程、预加载及 MCP 产物
npm run package:all    # 打包 macOS、Windows、Linux 安装包
```

开发模式：

```bash
npm run dev
```

### 配置 AI 模型

打开对话，点击输入框中的模型菜单（或打开设置抽屉），添加一条模型档案：

- **接口地址（Base URL）** — 如 `https://api.openai.com/v1`
- **API Key**
- **模型** — 如 `gpt-4o-mini`

可添加多个档案并在对话中随时切换。

## 架构

```
src/                  渲染层（React）：应用外壳、工具、对话视图、UI 原语
electron/main/        主进程：对话 SSE 引擎、agent 循环、代理、MCP 客户端、IPC
electron/mcp/         MCP 能力服务端（打包为单文件零依赖产物）
src/lib/toolkit/      渲染层与 MCP 共用的与框架无关的纯函数
scripts/              冒烟测试与真机截图 / 布局体检脚本
```

流式对话走自定义 IPC transport（AI SDK 的 `useChat` 接到主进程），渲染层不直接连接模型服务商，从而保留主进程的代理、TLS 与自定义请求头能力。

## 开发

```bash
npm run typecheck       # 渲染层与主进程两侧类型检查
npm run i18n:check      # 校验中英文词条键结构一致
npm run smoke:render    # 全部工具的 SSR 冒烟（双语）
npm run smoke:chat      # 流式对话
npm run smoke:chatagent # 对话内工具调用
npm run smoke:mcp       # MCP 服务端
npm run smoke:proxy     # HTTP / 抓包内核
npm run build           # 生产构建
```

## 国际化

界面提供中文（默认）与英文。译文集中于 `src/lib/locales/`，按工具分文件，另有共享的 `registry` 与 `ui` 模块。本文档亦提供双语版本：[中文](./README.zh-CN.md) · [English](./README.md)。

## 许可证

基于 [MIT 许可证](./LICENSE) 发布。
