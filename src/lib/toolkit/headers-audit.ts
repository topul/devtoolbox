/**
 * HTTP 安全响应头审计 —— 渲染进程与 MCP 服务端共用。
 *
 * 输入是响应头数组（主进程 HTTP 内核给的就是 `[name, value][]`，保留原始顺序
 * 与重复项），输出语言中立的 findings：界面负责把 level / id 映射成双语文案。
 */

export type FindingLevel = 'ok' | 'warn' | 'missing' | 'bad'

export interface HeaderFinding {
  /** 稳定标识，界面据此查本地化文案 */
  id: string
  level: FindingLevel
  /** 实际值（缺失时为 null） */
  value: string | null
  /** 给界面补充展示的说明性数值（如 max-age 秒数），没有则为空 */
  detail: string | null
}

export interface AuditResult {
  findings: HeaderFinding[]
  /** warn / bad / missing 的数量 */
  issues: number
}

/** 大小写不敏感地取头（同名多值合并为逗号分隔，Set-Cookie 除外——审计不涉及） */
function headerMap(headers: [string, string][]): Map<string, string> {
  const m = new Map<string, string>()
  for (const [k, v] of headers) {
    const key = k.toLowerCase()
    const prev = m.get(key)
    m.set(key, prev === undefined ? v : `${prev}, ${v}`)
  }
  return m
}

/* ---- 各头审计规则 ---- */

/** HSTS：仅 https 站点有意义；max-age 至少 15552000（180 天） */
function auditHsts(h: Map<string, string>, isHttps: boolean): HeaderFinding[] {
  const raw = h.get('strict-transport-security')
  if (!raw) {
    return [
      {
        id: isHttps ? 'hsts.missing' : 'hsts.absent',
        level: isHttps ? 'missing' : 'ok',
        value: null,
        detail: null,
      },
    ]
  }
  const m = raw.match(/max-age\s*=\s*(\d+)/i)
  if (!m) return [{ id: 'hsts.noMaxAge', level: 'bad', value: raw, detail: null }]
  const maxAge = parseInt(m[1])
  const level = maxAge >= 15552000 ? 'ok' : 'warn'
  return [
    {
      id: level === 'ok' ? 'hsts.ok' : 'hsts.weakMaxAge',
      level,
      value: raw,
      detail: String(maxAge),
    },
  ]
}

/** CSP：缺失或含 unsafe-inline / unsafe-eval / 通配 * 都要提示 */
function auditCsp(h: Map<string, string>): HeaderFinding[] {
  const raw = h.get('content-security-policy')
  if (!raw) return [{ id: 'csp.missing', level: 'missing', value: null, detail: null }]
  const problems: string[] = []
  if (/'unsafe-inline'|"unsafe-inline"/.test(raw)) problems.push('unsafe-inline')
  if (/'unsafe-eval'|"unsafe-eval"/.test(raw)) problems.push('unsafe-eval')
  if (/default-src[^;]*\s\*|\*/.test(raw) && /\s\*/.test(raw)) problems.push('*')
  if (problems.length) {
    return [{ id: 'csp.weak', level: 'warn', value: raw, detail: problems.join(', ') }]
  }
  return [{ id: 'csp.ok', level: 'ok', value: raw, detail: null }]
}

/** X-Frame-Options / frame-ancestors：点击劫持防护 */
function auditFrameOptions(h: Map<string, string>): HeaderFinding[] {
  const xfo = h.get('x-frame-options')
  const csp = h.get('content-security-policy')
  const hasFrameAncestors = !!csp && /frame-ancestors/i.test(csp)
  if (!xfo && !hasFrameAncestors) {
    return [{ id: 'frame.missing', level: 'missing', value: null, detail: null }]
  }
  if (xfo && !/^(DENY|SAMEORIGIN|ALLOW-FROM\s+\S+)$/i.test(xfo.trim())) {
    return [{ id: 'frame.bad', level: 'bad', value: xfo, detail: null }]
  }
  if (!xfo && hasFrameAncestors) {
    return [{ id: 'frame.viaCsp', level: 'ok', value: null, detail: 'frame-ancestors' }]
  }
  // 走到这里 xfo 必然存在（前面已排除「没有 xfo」的两支）
  return [{ id: 'frame.ok', level: 'ok', value: xfo ?? null, detail: null }]
}

/** X-Content-Type-Options：必须是 nosniff */
function auditContentTypeOptions(h: Map<string, string>): HeaderFinding[] {
  const raw = h.get('x-content-type-options')
  if (!raw) return [{ id: 'nosniff.missing', level: 'missing', value: null, detail: null }]
  if (raw.trim().toLowerCase() !== 'nosniff') {
    return [{ id: 'nosniff.bad', level: 'bad', value: raw, detail: null }]
  }
  return [{ id: 'nosniff.ok', level: 'ok', value: raw, detail: null }]
}

/** Referrer-Policy：缺失或 unsafe-url 视为风险 */
function auditReferrerPolicy(h: Map<string, string>): HeaderFinding[] {
  const raw = h.get('referrer-policy')
  if (!raw) return [{ id: 'referrer.missing', level: 'warn', value: null, detail: null }]
  if (/unsafe-url/i.test(raw))
    return [{ id: 'referrer.unsafe', level: 'warn', value: raw, detail: null }]
  return [{ id: 'referrer.ok', level: 'ok', value: raw, detail: null }]
}

/** Permissions-Policy：特性过多时提示 */
function auditPermissionsPolicy(h: Map<string, string>): HeaderFinding[] {
  const raw = h.get('permissions-policy')
  if (!raw) return [{ id: 'permissions.missing', level: 'warn', value: null, detail: null }]
  return [{ id: 'permissions.ok', level: 'ok', value: raw, detail: String(raw.split(',').length) }]
}

/** COOP：跨源隔离（Spectre 类攻击缓解） */
function auditCoop(h: Map<string, string>): HeaderFinding[] {
  const raw = h.get('cross-origin-opener-policy')
  if (!raw) return [{ id: 'coop.missing', level: 'warn', value: null, detail: null }]
  if (/^same-origin(-allow-popups)?$/i.test(raw.trim())) {
    return [{ id: 'coop.ok', level: 'ok', value: raw, detail: null }]
  }
  return [{ id: 'coop.weak', level: 'warn', value: raw, detail: null }]
}

/** 信息泄露类头：X-Powered-By / Server 版本号 */
function auditInfoLeak(h: Map<string, string>): HeaderFinding[] {
  const out: HeaderFinding[] = []
  const powered = h.get('x-powered-by')
  if (powered) out.push({ id: 'leak.poweredBy', level: 'warn', value: powered, detail: null })
  const server = h.get('server')
  if (server && /\d/.test(server)) {
    out.push({ id: 'leak.serverVersion', level: 'warn', value: server, detail: null })
  }
  return out
}

/** Set-Cookie 的 Secure / HttpOnly / SameSite 属性（同名多值逐条审计） */
function auditCookies(headers: [string, string][]): HeaderFinding[] {
  const out: HeaderFinding[] = []
  const cookies = headers.filter(([k]) => k.toLowerCase() === 'set-cookie')
  if (!cookies.length) return out
  let insecure = 0
  for (const [, v] of cookies) {
    const lower = v.toLowerCase()
    if (!lower.includes('secure')) insecure++
    else if (!lower.includes('httponly')) insecure++
  }
  if (insecure > 0) {
    out.push({
      id: 'cookie.weak',
      level: 'warn',
      value: String(insecure),
      detail: String(cookies.length),
    })
  } else {
    out.push({ id: 'cookie.ok', level: 'ok', value: null, detail: String(cookies.length) })
  }
  return out
}

/**
 * 审计入口。headers 为主进程 HTTP 内核返回的原始 `[name, value][]`；
 * isHttps 决定 HSTS 缺失算不算问题（http 站点上 HSTS 本来就不该有）。
 */
export function auditSecurityHeaders(headers: [string, string][], isHttps: boolean): AuditResult {
  const h = headerMap(headers)
  const findings: HeaderFinding[] = [
    ...auditHsts(h, isHttps),
    ...auditCsp(h),
    ...auditFrameOptions(h),
    ...auditContentTypeOptions(h),
    ...auditReferrerPolicy(h),
    ...auditPermissionsPolicy(h),
    ...auditCoop(h),
    ...auditInfoLeak(h),
    ...auditCookies(headers),
  ]
  return {
    findings,
    issues: findings.filter((f) => f.level === 'warn' || f.level === 'bad' || f.level === 'missing')
      .length,
  }
}
