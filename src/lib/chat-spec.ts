/**
 * 对话发送规格的构建（纯逻辑，node 可直接测）。
 *
 * 从 chat.tsx 抽离：它只依赖「当前档案 + 设置 + 工具源 + 两条提示语」，
 * 不含任何 React 状态。提示语以字符串注入，保持语言中立可测。
 */
import {
  numOrUndefined,
  parseAllowList,
  parseHeaderLines,
  profileReady,
  toChatToolServers,
  type ChatSettings,
  type CustomServer,
  type ModelProfile,
} from './chat-config'
import type { ChatMessage, ChatMeta, ChatSendSpec } from './chat-types'
import { costOf, findPrice, type ModelPrice } from './toolkit'

export interface ChatSpecCtx {
  active: ModelProfile | null
  settings: ChatSettings
  servers: CustomServer[]
  toolServer: { command: string; args: string[]; env: Record<string, string> } | null
  /** 档案不可用时的报错文案（locale 注入） */
  noModel: string
  /** 内置工具源的自名（locale 注入） */
  toolSelfLabel: string
}

/** 组一条待发请求：档案三件套 + 设置参数 + 工具源组装；档案未就绪直接抛 */
export function buildChatSendSpec(
  c: ChatSpecCtx,
  history: ChatMessage[],
  requestId: string,
): ChatSendSpec {
  const prof = c.active
  if (!prof || !profileReady(prof)) throw new Error(c.noModel)
  const custom = toChatToolServers(c.servers)
  const maxRounds = Math.max(1, Math.min(parseInt(c.settings.maxRounds) || 8, 20))
  const useTools = c.settings.toolsEnabled && (!!c.toolServer || custom.length > 0)
  return {
    requestId,
    baseUrl: prof.baseUrl.trim(),
    apiKey: prof.apiKey.trim(),
    model: prof.model.trim(),
    messages: history,
    temperature: numOrUndefined(c.settings.temperature),
    maxTokens: numOrUndefined(c.settings.maxTokens),
    topP: numOrUndefined(c.settings.topP),
    extraHeaders: parseHeaderLines(c.settings.extraHeaders),
    proxy: c.settings.proxy.trim() || null,
    rejectUnauthorized: c.settings.tlsVerify,
    includeUsage: c.settings.includeUsage,
    tools: useTools
      ? {
          servers: [
            ...(c.toolServer
              ? [
                  {
                    label: c.toolSelfLabel,
                    command: c.toolServer.command,
                    args: c.toolServer.args,
                    env: c.toolServer.env,
                  },
                ]
              : []),
            ...custom,
          ],
          maxRounds,
          ...(parseAllowList(c.settings.toolAllow).length
            ? { allow: parseAllowList(c.settings.toolAllow) }
            : {}),
        }
      : null,
  }
}

/**
 * 最近一条助手回复的估算费用：无 meta / 价格表缺模型 → null。
 * 输出 tokens 缺 usage 时按字符数粗估（÷3.2）。
 */
export function lastReplyCost(
  meta: ChatMeta | undefined,
  fallbackModel: string,
  prices: ModelPrice[],
): number | null {
  if (!meta) return null
  const price = findPrice(meta.model ?? fallbackModel, prices)
  if (!price) return null
  const tokens = meta.usage?.completionTokens ?? Math.ceil(meta.chars / 3.2)
  return costOf(price, {
    promptTokens: meta.usage?.promptTokens ?? 0,
    completionTokens: tokens,
    cachedTokens: meta.usage?.cachedTokens ?? 0,
  }).total
}
