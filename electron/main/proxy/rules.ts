/**
 * 抓包代理的拦截规则：匹配、改写、持久化
 *
 * 规则语义（保持简单且可预期）：
 *   - 命中判定：method / 主机 glob / 路径 glob / 协议 四个维度同时满足
 *   - 改写类动作（头、体）按规则顺序累加执行
 *   - 阻断 / 伪造响应 / 断点：取第一条命中的规则
 *   - 延迟：所有命中规则里取最大值
 */
import fs from 'node:fs'
import path from 'node:path'
import type { HeaderOp, ProxyRule } from '../../../src/lib/proxy-types'

export interface RequestFacts {
  method: string
  host: string
  path: string
  scheme: 'http' | 'https' | 'tunnel'
}

/** glob → 正则：* 匹配任意字符，? 匹配单字符，其余字面量 */
export function globToRegExp(pattern: string): RegExp {
  const p = pattern.trim()
  if (!p || p === '*') return /^.*$/i
  const body = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${body}$`, 'i')
}

export function matchesHost(ruleHost: string, host: string): boolean {
  const pattern = ruleHost.trim()
  if (!pattern) return true
  if (globToRegExp(pattern).test(host)) return true
  // 无通配符时按后缀匹配，方便用 example.com 覆盖 api.example.com
  if (!/[*?]/.test(pattern)) return host.toLowerCase().endsWith(pattern.toLowerCase())
  return false
}

export function ruleMatches(rule: ProxyRule, facts: RequestFacts): boolean {
  if (!rule.enabled) return false
  if (rule.scheme !== 'any' && rule.scheme !== facts.scheme) return false
  const m = (rule.method || 'ANY').toUpperCase()
  if (m !== 'ANY' && m !== facts.method.toUpperCase()) return false
  if (!matchesHost(rule.host, facts.host)) return false
  if (rule.path && !globToRegExp(rule.path).test(facts.path)) return false
  return true
}

/** 头改写：set 覆盖同名（保留原位置）、add 追加、remove 删除 */
export function applyHeaderOps(headers: [string, string][], ops: HeaderOp[]): [string, string][] {
  let out = headers.map(([k, v]) => [k, v] as [string, string])
  for (const op of ops ?? []) {
    const name = String(op.name ?? '').trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (op.action === 'remove') {
      out = out.filter(([k]) => k.toLowerCase() !== lower)
    } else if (op.action === 'add') {
      out.push([name, op.value ?? ''])
    } else {
      let replaced = false
      out = out.map(([k, v]) => {
        if (k.toLowerCase() === lower) {
          replaced = true
          return [k, op.value ?? ''] as [string, string]
        }
        return [k, v] as [string, string]
      })
      if (!replaced) out.push([name, op.value ?? ''])
    }
  }
  return out
}

/** 文本体查找替换；find 为空表示不改写 */
export function replaceText(text: string, find?: string, replace?: string, isRegex?: boolean): string {
  const from = find ?? ''
  if (!from) return text
  const to = replace ?? ''
  if (isRegex) {
    try {
      return text.replace(new RegExp(from, 'g'), to)
    } catch {
      return text
    }
  }
  return text.split(from).join(to)
}

export function createRule(partial: Partial<ProxyRule> = {}): ProxyRule {
  return {
    id: partial.id ?? `r_${Math.random().toString(36).slice(2, 10)}`,
    name: partial.name ?? '',
    enabled: partial.enabled ?? true,
    method: partial.method ?? 'ANY',
    host: partial.host ?? '',
    path: partial.path ?? '',
    scheme: partial.scheme ?? 'any',
    breakpoint: partial.breakpoint ?? false,
    delayMs: partial.delayMs ?? 0,
    block: partial.block ?? false,
    mock: partial.mock ?? null,
    reqHeaderOps: partial.reqHeaderOps ?? [],
    reqBodyFind: partial.reqBodyFind ?? '',
    reqBodyReplace: partial.reqBodyReplace ?? '',
    reqBodyRegex: partial.reqBodyRegex ?? false,
    resHeaderOps: partial.resHeaderOps ?? [],
    resBodyFind: partial.resBodyFind ?? '',
    resBodyReplace: partial.resBodyReplace ?? '',
    resBodyRegex: partial.resBodyRegex ?? false,
  }
}

/** 规则集合，落盘为 userData 下的 JSON */
export class RuleSet {
  private file: string
  private rules: ProxyRule[] = []

  constructor(file: string) {
    this.file = file
    this.load()
  }

  load(): void {
    try {
      if (!fs.existsSync(this.file)) return
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (Array.isArray(parsed)) this.rules = parsed.map((r) => createRule(r))
    } catch {
      this.rules = []
    }
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.rules, null, 2))
    } catch { /* 落盘失败不影响运行 */ }
  }

  list(): ProxyRule[] {
    return this.rules.map((r) => ({ ...r }))
  }

  replaceAll(rules: Partial<ProxyRule>[]): ProxyRule[] {
    this.rules = (rules ?? []).map((r) => createRule(r))
    this.save()
    return this.list()
  }

  upsert(rule: Partial<ProxyRule>): ProxyRule[] {
    const next = createRule(rule)
    const idx = this.rules.findIndex((r) => r.id === next.id)
    if (idx >= 0) this.rules[idx] = next
    else this.rules.push(next)
    this.save()
    return this.list()
  }

  remove(id: string): ProxyRule[] {
    this.rules = this.rules.filter((r) => r.id !== id)
    this.save()
    return this.list()
  }

  clear(): ProxyRule[] {
    this.rules = []
    this.save()
    return this.list()
  }

  match(facts: RequestFacts): ProxyRule[] {
    return this.rules.filter((r) => ruleMatches(r, facts))
  }
}
