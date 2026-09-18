/**
 * MCP 客户端（Inspector）的 IPC 编排。
 *
 * 与 `chat-ipc.ts` 同样的思路：宿主只注入 `emit`，编排逻辑因此可以被
 * `npm run smoke:mcpclient` 直接验证 —— 而且被测目标就是本仓库自己构建出来的
 * MCP 服务端，客户端与服务端互为验证。
 *
 * 约定：同一时刻只保留一条连接。换目标时先断开旧的，避免两个子进程互相抢状态。
 */
import { McpClient } from './mcpclient'
import type {
  McpCallOutcome,
  McpClientEvent,
  McpConnectResult,
  McpConnectSpec,
  McpPingResult,
} from '../../src/lib/mcpclient-types'

export interface McpClientHost {
  emit: (evt: McpClientEvent) => void
}

export interface McpClientController {
  connect: (spec: McpConnectSpec) => Promise<McpConnectResult>
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpCallOutcome>
  readResource: (uri: string) => Promise<McpCallOutcome>
  getPrompt: (name: string, args: Record<string, unknown>) => Promise<McpCallOutcome>
  ping: () => Promise<McpPingResult>
  disconnect: () => Promise<boolean>
  isConnected: () => boolean
}

export function createMcpClientController(
  host: McpClientHost,
  opts: { version?: string } = {},
): McpClientController {
  let client: McpClient | null = null

  /** 需要已连接的能力统一走这里，错误信息保持一致 */
  const active = (): McpClient => {
    if (!client || client.isClosed()) throw new Error('尚未连接 MCP 服务端')
    return client
  }

  const failed = (e: unknown): McpCallOutcome => ({
    ok: false,
    isError: false,
    text: '',
    raw: null,
    durationMs: 0,
    error: (e as Error).message,
  })

  return {
    async connect(spec: McpConnectSpec): Promise<McpConnectResult> {
      if (client) {
        await client.disconnect()
        client = null
      }
      const next = new McpClient(spec, { emit: host.emit, version: opts.version })
      client = next
      try {
        const info = await next.connect()
        const catalog = await next.loadCatalog()
        return { ok: true, info, catalog }
      } catch (e) {
        // 失败时把 client 置空：否则 isConnected() 会对一个已经废掉的连接说「是」
        client = null
        const detail = (e as Error).message
        host.emit({ type: 'status', id: spec.id, status: 'error', detail })
        return { ok: false, error: detail }
      }
    },

    async callTool(name, args) {
      try {
        return await active().callTool(name, args)
      } catch (e) {
        return failed(e)
      }
    },

    async readResource(uri) {
      try {
        return await active().readResource(uri)
      } catch (e) {
        return failed(e)
      }
    },

    async getPrompt(name, args) {
      try {
        return await active().getPrompt(name, args)
      } catch (e) {
        return failed(e)
      }
    },

    async ping(): Promise<McpPingResult> {
      try {
        return { ok: true, ms: await active().ping() }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },

    async disconnect(): Promise<boolean> {
      const c = client
      client = null
      if (!c) return false
      await c.disconnect()
      return true
    },

    isConnected: () => !!client && !client.isClosed(),
  }
}
