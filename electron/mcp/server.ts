/**
 * MCP 协议实现（JSON-RPC 2.0 over stdio）。
 *
 * 为什么手写而不引 @modelcontextprotocol/sdk：
 *   1. 产物要打成单文件、零运行时依赖，客户端 spawn 时不该再去解析 node_modules；
 *   2. MCP 的 tools 子集只有 initialize / tools/list / tools/call / ping 四个方法，
 *      协议面很小，自己实现比跟 SDK 版本变更省心；
 *   3. 本项目已有过一次「ESM 主进程 + CJS 依赖具名导出」踩坑，少一个依赖少一处雷。
 *
 * 传输方式：换行分隔的 JSON-RPC（LSP 风格），单条消息内不得出现裸换行。
 */
import { MCP_TOOLS, toProtocolTools } from '../../src/lib/mcp-catalog'
import { HANDLERS, type ToolArgs, type ToolResult } from './tools'

/** 声明支持的协议版本，按新到旧排列；首项即服务端默认版本 */
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL: string = SUPPORTED_PROTOCOLS[0]

export const SERVER_NAME = 'devtoolbox'

export interface ServerMeta {
  name: string
  version: string
}

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const

function ok(id: string | number | null, result: unknown): JsonRpcMessage {
  return { jsonrpc: '2.0', id, result }
}

function fail(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcMessage {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/** tools/list 的结果：只发协议认识的字段 */
function listTools(): { tools: ReturnType<typeof toProtocolTools> } {
  return { tools: toProtocolTools() }
}

function contentText(text: string, isError = false): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] }
}

function stringify(result: ToolResult): string {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

/**
 * 处理一条原始消息，返回要写回的响应（通知类消息返回 null，按协议不得回包）。
 * 抽成纯函数是为了让 `scripts/smoke-mcp.ts` 能直接断言协议行为，不必起进程。
 */
export async function handleMessage(raw: string, meta: ServerMeta): Promise<JsonRpcMessage | null> {
  let msg: JsonRpcMessage
  try {
    msg = JSON.parse(raw) as JsonRpcMessage
  } catch {
    return fail(null, ERR.PARSE, '消息不是合法 JSON')
  }
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
    return fail(msg?.id ?? null, ERR.INVALID_REQUEST, '缺少 method 字段')
  }

  const id = msg.id ?? null
  const isNotification = msg.id === undefined

  switch (msg.method) {
    case 'initialize': {
      const params = msg.params ?? {}
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested)
        ? requested
        : LATEST_PROTOCOL
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: meta,
        instructions:
          'DevOps Toolbox 本地能力集：编解码、哈希与签名、JSON/YAML、文本与正则、时间与 cron、IP 与子网、随机标识生成，以及一个支持上游代理与 TLS 开关的 HTTP 请求器。全部在本机执行，不联网、不上传内容。',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      return ok(id, listTools())

    case 'tools/call': {
      const params = msg.params ?? {}
      const name = params.name
      if (typeof name !== 'string' || !name) {
        return fail(id, ERR.INVALID_PARAMS, 'tools/call 需要 params.name')
      }
      const handler = HANDLERS[name]
      if (!handler) {
        return fail(id, ERR.INVALID_PARAMS, `未知工具：${name}`)
      }
      const args = (params.arguments ?? {}) as ToolArgs
      if (typeof args !== 'object' || Array.isArray(args)) {
        return fail(id, ERR.INVALID_PARAMS, 'params.arguments 必须是对象')
      }
      try {
        const result = await handler(args)
        return ok(id, contentText(stringify(result)))
      } catch (e) {
        // 工具执行失败按 MCP 规范走 isError 结果，而不是协议错误 —— 客户端才能把报错内容喂回模型
        return ok(id, contentText(`${name} 执行失败：${(e as Error).message}`, true))
      }
    }

    default:
      if (isNotification) return null
      return fail(id, ERR.METHOD_NOT_FOUND, `不支持的方法：${msg.method}`)
  }
}

/** 把一条消息序列化成单行（MCP stdio 传输不允许消息内出现裸换行） */
export function encodeMessage(msg: JsonRpcMessage): string {
  return JSON.stringify(msg)
}

/** 供 CLI 与烟雾脚本复用：直接调用某个工具 */
export async function callTool(name: string, args: ToolArgs): Promise<string> {
  const handler = HANDLERS[name]
  if (!handler) throw new Error(`未知工具：${name}`)
  return stringify(await handler(args))
}
