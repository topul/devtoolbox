/**
 * 流式对话的类型契约 —— 主进程与渲染进程共用。
 *
 * 主进程侧 `electron/main/chat.ts` 用 `import type` 引入（编译后不产生运行时代码），
 * 渲染进程侧直接引入用于界面状态标注。改动这里等于改 IPC 协议，两端需同步。
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** 模型要求调用某个工具（arguments 是**原始 JSON 文本**，可能不合法，交给调用方处理） */
export interface ChatToolCall {
  id: string
  name: string
  args: string
}

export interface ChatToolResult {
  id: string
  name: string
  /** 工具是否正常返回（协议层） */
  ok: boolean
  /** 工具自己报错（MCP 的 isError） */
  isError: boolean
  text: string
  durationMs: number
  error?: string
}

/** 一个工具来源：本机内置，或用户自定义的 MCP 服务端（stdio / Streamable HTTP） */
export interface ChatToolServer {
  /** 展示名（界面与日志用） */
  label?: string
  /* ---- stdio ---- */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  /* ---- http ---- */
  url?: string
  headers?: [string, string][]
}

/** 启用工具调用时，客户端要用的 MCP 服务端配置 */
export interface ChatToolsSpec {
  /** 允许的工具名白名单（按原始名匹配）；空数组 = 全部允许 */
  allow?: string[]
  /** 单次对话最多几轮工具调用，防止模型停不下来 */
  maxRounds?: number
  /** 旧字段：单个 stdio 服务端（保留兼容，agent 会把它并进 servers） */
  server?: {
    command: string
    args: string[]
    env?: Record<string, string>
    cwd?: string
    label?: string
  }
  /**
   * 多工具源。**顺序有语义**：先连的拿干净的工具名，后面的源撞名时自动加 `_2`、`_3` 后缀 ——
   * 模型看到的名字一旦给出就不能变，所以顺序要稳定。
   */
  servers?: ChatToolServer[]
}

/** 发送一次对话所需的一切参数（不含界面状态） */
export interface ChatSendSpec {
  /**
   * 由**调用方**生成并在事件里沿用。
   * 这样即使主进程在 `chat:send` 返回之前就抛出错误（例如接口地址为空），
   * 界面也能凭自己已经知道的 id 认出这条事件 —— 否则会收到一个「不认识的 requestId」。
   */
  requestId?: string
  /** 形如 https://api.deepseek.com/v1；也可直接给完整的 /chat/completions */
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  /** 附加请求头，每项 [名, 值]；有的网关用 api-key 而非 Bearer */
  extraHeaders?: [string, string][]
  /** 上游代理，如 http://127.0.0.1:7890 或 socks5://user:pass@host:1080 */
  proxy?: string | null
  /** 是否校验 TLS 证书（内网自签可关） */
  rejectUnauthorized?: boolean
  /** 空闲超时毫秒：流中途长时间无数据按超时处理 */
  timeoutMs?: number
  /** 是否请求服务端返回 usage（极少数网关不支持，可关掉） */
  includeUsage?: boolean
  /** 存在即启用工具调用：模型可以自己决定调用本机（或指定）MCP 服务端的工具 */
  tools?: ChatToolsSpec | null
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 命中缓存的输入 token（服务端给了才有） */
  cachedTokens?: number
}

export type ChatDeltaKind = 'content' | 'reasoning'

export interface ChatMeta {
  /** 响应头到达耗时 */
  ttfbMs: number
  /** 首个正文片段耗时（真正的「首字延迟」） */
  firstTokenMs: number
  totalMs: number
  /** 收到多少个增量片段 */
  chunks: number
  chars: number
  reasoningChars: number
  usage: ChatUsage | null
  finishReason: string | null
  /** 服务端实际返回的模型名 */
  model: string | null
  /** 本轮流式过程中拼出来的工具调用（arguments 是原始 JSON 文本） */
  toolCalls: ChatToolCall[]
}

export type ChatEvent =
  | { type: 'start'; requestId: string }
  | { type: 'delta'; requestId: string; text: string; kind: ChatDeltaKind; atMs: number }
  | { type: 'done'; requestId: string; meta: ChatMeta; rounds?: number }
  | { type: 'error'; requestId: string; message: string; code?: string }
  /** 工具调用相关的四条，仅在启用工具时出现 */
  | { type: 'toolsReady'; requestId: string; tools: { name: string; description: string }[] }
  | { type: 'round'; requestId: string; round: number; maxRounds: number }
  | { type: 'notice'; requestId: string; text: string }
  | { type: 'toolCall'; requestId: string; round: number; call: ChatToolCall }
  | { type: 'toolResult'; requestId: string; round: number; result: ChatToolResult }

export interface ChatSendResult {
  ok: boolean
  requestId?: string
  error?: string
}
