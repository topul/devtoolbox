/**
 * DNS 查询结果规范化 —— 渲染进程与 MCP 服务端共用。
 *
 * 网络请求本身由调用方发起（桌面端走主进程 HTTP 内核，Web 端走 fetch 兜底），
 * 这里只负责把 DoH（RFC 8484，JSON 格式）的响应体整理成语言中立的结构。
 */

/** DNS 记录类型 → 显示名（RFC 1035 及常见扩展） */
export const DNS_RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SOA',
  'PTR',
  'SRV',
  'CAA',
] as const
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number]

export interface DohAnswer {
  name: string
  type: number
  TTL: number
  data: string
}

export interface DohResponse {
  Status: number
  TC?: boolean
  RD?: boolean
  RA?: boolean
  AD?: boolean
  CD?: boolean
  Question?: { name: string; type: number }[]
  Answer?: DohAnswer[]
  Authority?: DohAnswer[]
  Comment?: string
}

/** DNS RCODE → 语义（Google/Cloudflare DoH 都用这套） */
export const DNS_RCODES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
  6: 'YXDOMAIN',
  7: 'NXRRSET',
  8: 'NOTAUTH',
  9: 'NOTZONE',
}

/** 记录类型编号 → 字母（只列常用的，其余原样给数字） */
const TYPE_NUM_TO_NAME: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  257: 'CAA',
}

/** 记录类型字母 → 编号 */
const TYPE_NAME_TO_NUM: Record<string, number> = Object.fromEntries(
  Object.entries(TYPE_NUM_TO_NAME).map(([n, name]) => [name, Number(n)]),
)

export function dnsTypeName(n: number): string {
  return TYPE_NUM_TO_NAME[n] ?? `TYPE${n}`
}

export function dnsTypeNum(name: string): number | undefined {
  return TYPE_NAME_TO_NUM[name.toUpperCase()]
}

export interface DnsRecord {
  name: string
  type: string
  ttl: number
  data: string
}

export interface DnsResult {
  question: { name: string; type: string } | null
  /** rcode 编号，0 = 正常 */
  status: number
  /** rcode 名称，如 NXDOMAIN */
  statusText: string
  truncated: boolean
  records: DnsRecord[]
  authority: DnsRecord[]
  comment: string | null
}

/** 解析 DoH JSON 响应体（字符串或已解析对象都接受） */
export function parseDohResponse(body: string | unknown): DnsResult {
  let json: DohResponse
  if (typeof body === 'string') {
    try {
      json = JSON.parse(body) as DohResponse
    } catch {
      throw new Error('BAD_DOH_JSON')
    }
  } else if (body && typeof body === 'object') {
    json = body as DohResponse
  } else {
    throw new Error('BAD_DOH_JSON')
  }
  if (typeof json.Status !== 'number') throw new Error('BAD_DOH_JSON')
  const mapRec = (a: DohAnswer): DnsRecord => ({
    name: String(a.name ?? ''),
    type: dnsTypeName(Number(a.type)),
    ttl: Number(a.TTL ?? 0),
    data: String(a.data ?? ''),
  })
  const q = json.Question?.[0]
  return {
    question: q ? { name: String(q.name), type: dnsTypeName(Number(q.type)) } : null,
    status: json.Status,
    statusText: DNS_RCODES[json.Status] ?? `RCODE${json.Status}`,
    truncated: !!json.TC,
    records: (json.Answer ?? []).map(mapRec),
    authority: (json.Authority ?? []).map(mapRec),
    comment: json.Comment ?? null,
  }
}

export interface DohEndpoint {
  id: string
  /** URL 模板，{name} 与 {type} 占位 */
  url: string
}

/** 内置公共 DoH 端点（JSON 媒体类型，RFC 8484 §4.1 之外的事实标准） */
export const DOH_ENDPOINTS: DohEndpoint[] = [
  { id: 'google', url: 'https://dns.google/resolve?name={name}&type={type}' },
  { id: 'cloudflare', url: 'https://cloudflare-dns.com/dns-query?name={name}&type={type}' },
  { id: 'aliyun', url: 'https://dns.alidns.com/resolve?name={name}&type={type}' },
  { id: 'dnspod', url: 'https://doh.pub/dns-query?name={name}&type={type}' },
]

/** 拼出查询 URL（name 需已做 encodeURIComponent） */
export function dohQueryUrl(endpoint: string, name: string, type: DnsRecordType): string {
  const tpl = DOH_ENDPOINTS.find((e) => e.id === endpoint)?.url
  if (!tpl) throw new Error('BAD_DOH_ENDPOINT')
  return tpl
    .replace('{name}', encodeURIComponent(name.trim()))
    .replace('{type}', encodeURIComponent(type))
}

/** 裸域名合法性：字母数字连字符，点分，总长 ≤ 253 */
export function isValidDomain(name: string): boolean {
  const t = name.trim().replace(/\.$/, '')
  if (!t || t.length > 253) return false
  const labels = t.split('.')
  return labels.every((l) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(l))
}
