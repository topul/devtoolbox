/**
 * 对话的本机配置：模型清单、其余参数、自定义工具源、价格表。
 *
 * 与旧版最大的差别是**模型清单成了唯一来源**：以前 baseUrl / apiKey / model 三个字段
 * 散在配置里，再靠「用过的自动记一条」拼出一份档案列表 —— 结果是列表越攒越乱
 * （试错留下的半截记录删不掉，改名无处可改）。现在选中哪个模型，就由哪条档案提供这三件套。
 *
 * 旧数据仍能读：第一次加载时把老配置里的三件套搬成一条档案，
 * 老的 profiles（没有名字字段）自动用模型名当名字。迁移只做一次，之后写回新结构。
 *
 * 纯 localStorage + 纯函数，不 import React / electron。
 */
import type { ModelPrice } from './toolkit'
import type { ChatToolServer } from './chat-types'
import { uuidV4 } from './toolkit'

/* ==================== 模型清单 ==================== */

export interface ModelProfile {
  id: string
  /** 显示名；留空时界面回落显示模型名 */
  label: string
  baseUrl: string
  apiKey: string
  model: string
}

export const PROFILES_KEY = 'devtoolbox-chat-profiles'
export const ACTIVE_KEY = 'devtoolbox-chat-active-profile'

interface LegacyConfigShape {
  baseUrl?: unknown
  apiKey?: unknown
  model?: unknown
}

/** id 白名单与对话存储层一致：字母数字，够长 */
export function newId(prefix: string): string {
  return `${prefix}${uuidV4().replace(/-/g, '')}`
}

function coerceProfile(raw: unknown): ModelProfile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl : ''
  const model = typeof o.model === 'string' ? o.model : ''
  if (!baseUrl || !model) return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newId('m'),
    label: typeof o.label === 'string' ? o.label : '',
    baseUrl,
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    model,
  }
}

/**
 * 读模型清单。
 * - 新结构：直接用；
 * - 老结构（有剖面但没名字）：用模型名兜个名字；
 * - 什么都没有但有老配置里的三件套：搬成一条档案；
 * - 解析失败：返回空，让用户重配（**不清空**磁盘上的原文，用户可能还想手工抢救）。
 */
export function loadProfiles(): ModelProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const list = parsed.map(coerceProfile).filter((p): p is ModelProfile => !!p)
        if (list.length) return list
      }
    }
  } catch {
    /* 落到下面用老配置兜底 */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_CFG_KEY)
    if (!legacy) return []
    const cfg = JSON.parse(legacy) as LegacyConfigShape
    const migrated = coerceProfile({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model })
    return migrated ? [migrated] : []
  } catch {
    return []
  }
}

export function saveProfiles(list: ModelProfile[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list))
  } catch {
    /* 存不下就算了，不影响本次会话 */
  }
}

export function loadActiveProfileId(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveActiveProfileId(id: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    /* ignore */
  }
}

export function findProfile(list: ModelProfile[], id: string): ModelProfile | null {
  return list.find((p) => p.id === id) ?? null
}

/** 清单里显示的名字：用户没起名就用模型名 */
export function profileName(p: ModelProfile): string {
  return p.label.trim() || p.model.trim() || '—'
}

/** 一个模型算配好了没有 —— 三件套缺一不可 */
export function profileReady(p: ModelProfile | null): boolean {
  return !!p && !!p.baseUrl.trim() && !!p.model.trim() && !!p.apiKey.trim()
}

/** 加一条空档案并返回它（调用方负责放进列表并选中） */
export function blankProfile(baseUrl = '', model = ''): ModelProfile {
  return { id: newId('m'), label: '', baseUrl, apiKey: '', model }
}

/* ==================== 其余参数 ==================== */

/** 与模型无关的请求参数（三件套见模型清单） */
export interface ChatSettings {
  system: string
  temperature: string
  maxTokens: string
  topP: string
  proxy: string
  tlsVerify: boolean
  includeUsage: boolean
  extraHeaders: string
  toolsEnabled: boolean
  maxRounds: string
}

export const DEFAULT_SETTINGS: ChatSettings = {
  system: '',
  temperature: '',
  maxTokens: '',
  topP: '',
  proxy: '',
  tlsVerify: true,
  includeUsage: true,
  extraHeaders: '',
  toolsEnabled: true,
  maxRounds: '8',
}

/** 老配置的键名，保留只读兼容（迁移后不再写它） */
export const LEGACY_CFG_KEY = 'devtoolbox-chat-config'
export const SETTINGS_KEY = 'devtoolbox-chat-settings'

export function loadSettings(): ChatSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS
  for (const key of [SETTINGS_KEY, LEGACY_CFG_KEY]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as Partial<ChatSettings>
      if (typeof parsed !== 'object' || parsed === null) continue
      const out = { ...DEFAULT_SETTINGS }
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof ChatSettings)[]) {
        const v = parsed[k]
        if (typeof v === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = v
      }
      return out
    } catch {
      /* 换下一个键 */
    }
  }
  return DEFAULT_SETTINGS
}

export function saveSettings(s: ChatSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/* ==================== 自定义工具源 ==================== */

export interface CustomServer {
  id: string
  label: string
  kind: 'stdio' | 'http'
  command: string
  args: string
  env: string
  url: string
  headers: string
}

export const SRV_KEY = 'devtoolbox-chat-servers'

export function loadServers(): CustomServer[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(SRV_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        id: typeof x.id === 'string' ? x.id : newId('s'),
        label: typeof x.label === 'string' ? x.label : '',
        kind: x.kind === 'http' ? ('http' as const) : ('stdio' as const),
        command: typeof x.command === 'string' ? x.command : '',
        args: typeof x.args === 'string' ? x.args : '',
        env: typeof x.env === 'string' ? x.env : '',
        url: typeof x.url === 'string' ? x.url : '',
        headers: typeof x.headers === 'string' ? x.headers : '',
      }))
  } catch {
    return []
  }
}

export function saveServers(list: CustomServer[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SRV_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/* ==================== 文本解析 ==================== */

/**
 * 界面里的自定义工具源 → agent 能吃的形态。
 * 填了一半的条目直接跳过，别把残稿发给模型。
 */
export function toChatToolServers(list: CustomServer[]): ChatToolServer[] {
  return list
    .map((s): ChatToolServer | null => {
      const label = s.label.trim() || undefined
      if (s.kind === 'http') {
        return s.url.trim() ? { label, url: s.url.trim(), headers: parseHeaderLines(s.headers) } : null
      }
      return s.command.trim()
        ? { label, command: s.command.trim(), args: s.args.split('\n').map((x) => x.trim()).filter(Boolean), env: parseEnvText(s.env) }
        : null
    })
    .filter((x): x is ChatToolServer => !!x)
}

/** `KEY=VALUE` 每行一条；解析不动的地方直接跳过，别让一个错行毁掉整个环境表 */
export function parseEnvText(t: string): Record<string, string> {  const out: Record<string, string> = {}
  for (const line of t.split('\n')) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

export function parseHeaderLines(raw: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf(':')
    if (i > 0) out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()])
  }
  return out
}

/** 数字输入留空表示「用服务端默认」，所以空串要保持空串 */
export function numOrUndefined(v: string): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/* ==================== 预设与价格 ==================== */

export const PRESET_BASE_URLS: [string, string][] = [
  ['DeepSeek', 'https://api.deepseek.com/v1'],
  ['OpenAI', 'https://api.openai.com/v1'],
  ['Qwen / DashScope', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
  ['Zhipu GLM', 'https://open.bigmodel.cn/api/paas/v4'],
  ['Moonshot', 'https://api.moonshot.cn/v1'],
  ['Ollama', 'http://127.0.0.1:11434/v1'],
  ['LM Studio', 'http://127.0.0.1:1234/v1'],
]

/**
 * 价格表只是本机参考值：单价变动频繁，工具不该硬编码「权威价格」。
 * 单位统一为「元 / 百万 token」，以服务商官网为准。
 */
export const DEFAULT_PRICES: ModelPrice[] = [
  { model: 'deepseek-chat', inPerM: 2, outPerM: 8, cacheInPerM: 0.5 },
  { model: 'deepseek-reasoner', inPerM: 4, outPerM: 16, cacheInPerM: 1 },
]

export const PRICE_KEY = 'devtoolbox-chat-prices'

export function loadPrices(): ModelPrice[] {
  if (typeof localStorage === 'undefined') return DEFAULT_PRICES
  try {
    const raw = localStorage.getItem(PRICE_KEY)
    if (!raw) return DEFAULT_PRICES
    const parsed = JSON.parse(raw) as ModelPrice[]
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PRICES
  } catch {
    return DEFAULT_PRICES
  }
}

export function savePrices(list: ModelPrice[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PRICE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** 配置摘要里只显示主机名，完整地址太长 */
export function shortHost(u: string): string {
  const t = u.trim()
  if (!t) return '—'
  try {
    return new URL(t).host
  } catch {
    return t.replace(/^https?:\/\//, '').split('/')[0] || t
  }
}
