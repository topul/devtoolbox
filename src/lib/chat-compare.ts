/**
 * 多模型对比 —— 事件归组与规格构建（纯逻辑，node 可直接测）。
 *
 * 同一个问题 fan-out 给 N 个模型档案：每条流一个 requestId，
 * 全局事件流按 requestId 归到各自的列。对比页只关心文本与指标，
 * 工具相关事件（toolsReady/round/toolCall/toolResult）直接忽略 ——
 * 列间可比的前提是纯文本路径，工具循环会让轮次与耗时失去可比性。
 */
import { profileName, profileReady, type ModelProfile } from './chat-config'
import type { ChatEvent, ChatSendSpec, ChatUsage } from './chat-types'

export type CompareStatus = 'pending' | 'streaming' | 'done' | 'error' | 'aborted'

export interface CompareColumn {
  requestId: string
  /** 显示名（profileName） */
  label: string
  model: string
  text: string
  reasoningChars: number
  status: CompareStatus
  error: string
  startedAt: number | null
  firstTokenMs: number | null
  totalMs: number | null
  usage: ChatUsage | null
}

export function newColumn(requestId: string, label: string, model: string): CompareColumn {
  return { requestId, label, model, text: '', reasoningChars: 0, status: 'pending', error: '', startedAt: null, firstTokenMs: null, totalMs: null, usage: null }
}

/** 纯文本对比规格：不带工具、不带系统提示 —— 列间唯一变量是模型 */
export function buildCompareSpec(p: ModelProfile, question: string, requestId: string): ChatSendSpec {
  return {
    requestId,
    baseUrl: p.baseUrl.trim(),
    apiKey: p.apiKey.trim(),
    model: p.model.trim(),
    messages: [{ role: 'user', content: question }],
    proxy: null,
    rejectUnauthorized: true,
    includeUsage: true,
    tools: null,
  }
}

/** 把一条事件归进对应的列；返回新数组（不可变更新，方便直接当 React state） */
export function applyCompareEvent(cols: CompareColumn[], evt: ChatEvent): CompareColumn[] {
  const i = cols.findIndex((c) => c.requestId === evt.requestId)
  if (i < 0) return cols
  const c = cols[i]
  const now = Date.now()

  const next = (): CompareColumn => ({ ...c })

  switch (evt.type) {
    case 'start': {
      const n = next()
      n.status = 'streaming'
      n.startedAt = now
      cols[i] = n
      return [...cols]
    }
    case 'delta': {
      const n = next()
      if (evt.kind === 'content') {
        n.text += evt.text
        if (n.firstTokenMs === null && n.startedAt !== null) n.firstTokenMs = now - n.startedAt
      } else {
        n.reasoningChars += evt.text.length
      }
      cols[i] = n
      return [...cols]
    }
    case 'done': {
      const n = next()
      n.status = 'done'
      n.totalMs = evt.meta.totalMs ?? (n.startedAt !== null ? now - n.startedAt : null)
      n.firstTokenMs = n.firstTokenMs ?? evt.meta.firstTokenMs ?? null
      n.usage = evt.meta.usage
      cols[i] = n
      return [...cols]
    }
    case 'error': {
      const n = next()
      // 取消不是失败：界面显示「已停止」，跟出错区分开
      n.status = evt.code === 'ABORTED' ? 'aborted' : 'error'
      n.error = evt.message
      n.totalMs = n.startedAt !== null ? now - n.startedAt : null
      cols[i] = n
      return [...cols]
    }
    default:
      return cols
  }
}

/** 一列的指标行文本片段（界面拼装用；空值跳过） */
export function columnMetrics(c: CompareColumn): { firstToken: number | null; totalMs: number | null; tokens: number | null } {
  return {
    firstToken: c.firstTokenMs,
    totalMs: c.totalMs,
    tokens: c.usage?.totalTokens ?? null,
  }
}

/** 发送前的可发性检查：全部档案就绪才允许 fan-out */
export function allReady(profiles: ModelProfile[]): boolean {
  return profiles.length > 0 && profiles.every(profileReady)
}

/** 显示名统一走 profileName，保持与主对话页一致 */
export function columnLabel(p: ModelProfile): string {
  return profileName(p)
}
