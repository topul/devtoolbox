/**
 * MCP 客户端（Inspector）的类型契约 —— 主进程与渲染进程共用。
 *
 * 主进程侧 `electron/main/mcpclient.ts` 用 `import type` 引入；改动这里等于改 IPC 协议。
 */

export type McpTransportKind = 'stdio' | 'http'

export interface McpConnectSpec {
  /** 连接 id，由渲染层生成（事件靠它归属，避免错配） */
  id: string
  /** 展示名，仅用于界面 */
  label?: string
  transport: McpTransportKind

  /* ---- stdio ---- */
  /** 可执行文件；本机 DevToolbox 用自身可执行文件 + ELECTRON_RUN_AS_NODE=1 */
  command?: string
  args?: string[]
  /** 追加/覆盖的环境变量 */
  env?: Record<string, string>
  cwd?: string

  /* ---- http（Streamable HTTP） ---- */
  url?: string
  headers?: [string, string][]

  /** 单次请求超时（毫秒），默认 30s；initialize 也用这个值 */
  timeoutMs?: number
}

export interface McpServerInfo {
  name: string
  version: string
  protocolVersion: string
  instructions?: string
  /** 原始 capabilities，原样展示，便于确认服务端声明了什么 */
  capabilities: Record<string, unknown>
}

export interface McpToolInfo {
  name: string
  description?: string
  /** 原始 inputSchema，界面直接渲染成参数提示 */
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] }
}

export interface McpResourceInfo {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export interface McpPromptInfo {
  name: string
  description?: string
  arguments?: { name: string; description?: string; required?: boolean }[]
}

export interface McpCatalog {
  tools: McpToolInfo[]
  resources: McpResourceInfo[]
  prompts: McpPromptInfo[]
  /** 服务端未声明对应能力时该列表为空，界面据此提示「未声明」 */
  declared: { tools: boolean; resources: boolean; prompts: boolean }
}

export interface McpCallOutcome {
  ok: boolean
  /** 工具自己报的错（isError: true），与协议层失败区分开 */
  isError: boolean
  /** content 里的文本块拼接结果 */
  text: string
  /** 原始 result，界面上可展开看全貌 */
  raw: unknown
  durationMs: number
  /** 协议层错误（超时、连接断了、方法不存在……） */
  error?: string
}

export type McpConnectStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export type McpClientEvent =
  | { type: 'status'; id: string; status: McpConnectStatus; detail?: string }
  | { type: 'serverInfo'; id: string; info: McpServerInfo }
  | { type: 'catalog'; id: string; catalog: McpCatalog }
  /** 原始 JSON-RPC 帧；ok=false 表示这一行不是合法 JSON（服务端往 stdout 打日志了）*/
  | { type: 'frame'; id: string; dir: 'send' | 'recv'; payload: string; ok: boolean }
  /** 诊断日志：子进程 stderr，或 http 传输自己的说明 */
  | { type: 'log'; id: string; source: 'stderr' | 'info'; text: string }
  /** 服务端主动推的通知（notifications/*） */
  | { type: 'notification'; id: string; method: string; params?: unknown }
  | { type: 'exit'; id: string; code: number | null; signal: string | null }

export interface McpConnectResult {
  ok: boolean
  info?: McpServerInfo
  /** 连上后顺手拉一次能力清单，省得界面还要等事件 */
  catalog?: McpCatalog
  error?: string
}

export interface McpPingResult {
  ok: boolean
  ms?: number
  error?: string
}
