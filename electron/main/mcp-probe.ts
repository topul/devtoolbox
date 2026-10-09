/**
 * 工具源探测：配置对话的自定义 MCP 服务端时，先验证「能不能连上、有什么工具」。
 *
 * 与 agent 路径的区别：agent 是模型自主触发的长会话连接，这里是用户手动点一下
 * 「测试」的一次性连接 —— 连上、拉目录、立刻断开，绝不留驻进程。
 *
 * 不 import electron：smoke 可以直接驱动本文件做端到端（真实 spawn 内置 server）。
 */
import { McpClient } from './mcpclient'
import type { ChatToolServer, McpProbeResult } from '../../src/lib/chat-types'

/** 探测默认超时：比 agent 的 30s 短 —— 用户在等一个按钮的结果，别让他等太久 */
const PROBE_TIMEOUT_MS = 15_000

/** 工具描述在结果里截断：探测只是预览，完整 schema 归 Inspector */
const DESC_MAX = 200

function probeError(message: string): McpProbeResult {
  return { ok: false, error: message }
}

/**
 * 探测一个工具源。输入与 agent 吃的形态一致（ChatToolServer），
 * 渲染层先用 toChatToolServers 把草稿转好再传进来。
 */
export async function probeServer(
  src: ChatToolServer,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<McpProbeResult> {
  const url = src.url?.trim()
  const command = src.command?.trim()
  if (!url && !command) return probeError('没有配置地址或启动命令')

  const client = new McpClient(
    url
      ? {
          id: `probe-${Date.now()}`,
          transport: 'http' as const,
          url,
          ...(src.headers ? { headers: src.headers } : {}),
          timeoutMs,
        }
      : {
          id: `probe-${Date.now()}`,
          transport: 'stdio' as const,
          command: command ?? '',
          args: src.args ?? [],
          ...(src.env ? { env: src.env } : {}),
          ...(src.cwd ? { cwd: src.cwd } : {}),
          timeoutMs,
        },
    // 探测过程不产生事件流；结果一次性返回
    {
      emit: () => {
        /* 静默 */
      },
    },
  )

  // 总保险：McpClient 内部超时覆盖单次请求，这里再兜一层（含 disconnect 卡死的情况）
  let timer: ReturnType<typeof setTimeout> | null = null
  const guard = new Promise<McpProbeResult>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`探测超时（${Math.round(timeoutMs / 1000)}s）`)),
      timeoutMs + 5_000,
    )
  })

  try {
    const run = (async (): Promise<McpProbeResult> => {
      const info = await client.connect()
      const catalog = await client.loadCatalog()
      return {
        ok: true,
        serverName: info.name,
        serverVersion: info.version,
        tools: catalog.tools.map((t) => ({
          name: t.name,
          description: (t.description ?? '').slice(0, DESC_MAX),
        })),
        resources: catalog.resources.length,
        prompts: catalog.prompts.length,
      }
    })()

    return await Promise.race([run, guard])
  } catch (e) {
    return probeError((e as Error).message || '连接失败')
  } finally {
    if (timer) clearTimeout(timer)
    try {
      await client.disconnect()
    } catch {
      /* 断开失败不影响结果 */
    }
  }
}
