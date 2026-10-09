/**
 * HAR（HTTP Archive）解析 —— 渲染层与 MCP 端共用。
 *
 * 规范：http://www.softwareishard.com/blog/har-12-spec/
 *
 * 实测各导出工具的差异比规范大得多，这个文件大半篇幅在处理这些偏差：
 *   - Chrome 加 `_` 前缀私有字段：`_priority` / `_resourceType` / `_transferSize` / `_error`
 *   - `log.version`、`log.pages` 常常缺失（Firefox 某些版本）
 *   - `headers` / `queryString` / `timings` 可能是 null 而非数组/对象
 *   - `headersSize` / `bodySize` / 各 timings 用 **-1** 表示「未采集」，直接相加会得到负数
 *   - body 可能已解码成 text，也可能仍是 base64（`content.encoding === 'base64'`）
 *   - 失败请求 `status` 是 0，且信息在 `_error` 里
 *
 * 纯逻辑，无 DOM / React / electron / Node 内置依赖。
 */

/* ================= 类型 ================= */

/** 归一化后的一条请求 */
export interface HarEntry {
  /** 在 entries 数组里的下标 */
  index: number
  method: string
  url: string
  host: string
  path: string
  status: number
  statusText: string
  httpVersion: string
  mimeType: string
  /** Chrome 私有：document / stylesheet / xhr / script … */
  resourceType: string
  /** Chrome 私有：VeryHigh / High / Low … */
  priority: string
  /** 响应体大小（字节）；-1 表示未采集 */
  bodySize: number
  /** 实际传输量（含协议开销），优先取 Chrome 的 `_transferSize` */
  transferSize: number
  serverIP: string
  connection: string
  /** 请求头条数 */
  headerCount: number
  /** 响应头条数 */
  respHeaderCount: number
  queryCount: number
  /** 响应体文本；可能是 null（HAR 未记录 body） */
  body: string | null
  /** body 是否是已解码文本（false 表示是 base64，需要解码） */
  bodyEncoding: 'text' | 'base64'
  /** POST 请求体 */
  postData: string
  redirectURL: string
  isRedirect: boolean
  isFailed: boolean
  /** 失败原因（Chrome 放在 `_error`） */
  error: string
  /** 开始时间（Unix 毫秒） */
  startedMs: number
  /** 总耗时（毫秒） */
  time: number
  /** 各阶段耗时；-1 会被归一为 0 */
  dns: number
  connect: number
  ssl: number
  send: number
  wait: number
  receive: number
  blocked: number
}

/** 解析结果汇总 */
export interface HarSummary {
  version: string
  creator: string
  pageCount: number
  entries: HarEntry[]
  /** 至少有一条记录了 body 文本 */
  hasBody: boolean
}

/** 瀑布图的一行 */
export interface WaterfallRow {
  index: number
  /** 相对最早一条的偏移（毫秒） */
  offset: number
  method: string
  url: string
  host: string
  status: number
  mimeType: string
  resourceType: string
  time: number
  dns: number
  connect: number
  ssl: number
  send: number
  wait: number
  receive: number
  blocked: number
  isFailed: boolean
}

/** 按域名的汇总 */
export interface HostSummary {
  host: string
  count: number
  /** 传输字节数之和 */
  bytes: number
  /** 失败条数 */
  failed: number
}

/* ================= 工具 ================= */

/** HAR 用 -1 表示「未采集」，直接参与求和会得到负的总耗时 */
function t(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : -1
  return n < 0 ? 0 : n
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 从 URL 里拆出 host；解析失败时退回一个可读的占位 */
function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)
  if (m) return m[1]
  // 协议相对 URL 或畸形 URL：至少把第一段取出来
  const seg = url.replace(/^\/+/, '').split(/[/?#]/)[0]
  return seg || '(unknown)'
}

function pathOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(url)
  if (m) return m[1] || '/'
  return url.startsWith('/') ? url : '/'
}

/* ================= 解析 ================= */

/**
 * 解析 HAR（对象或 JSON 字符串）。
 *
 * @throws {Error} `BAD_HAR` —— 不是 HAR、缺 log、缺 entries
 */
export function parseHar(input: unknown): HarSummary {
  let root: unknown = input
  if (typeof input === 'string') {
    try {
      root = JSON.parse(input)
    } catch {
      throw new Error('BAD_HAR')
    }
  }
  if (!root || typeof root !== 'object') throw new Error('BAD_HAR')

  const log = (root as { log?: unknown }).log
  if (!log || typeof log !== 'object') throw new Error('BAD_HAR')

  const rawEntries = (log as { entries?: unknown }).entries
  if (!Array.isArray(rawEntries)) throw new Error('BAD_HAR')

  const creator = log as { creator?: { name?: unknown } }
  const entries: HarEntry[] = rawEntries.map((e, i) => normalizeEntry(e, i))

  return {
    // version/pages 缺失是常态（Firefox 某些版本），给空值而不是崩
    version: str((log as { version?: unknown }).version),
    creator: str(creator.creator?.name),
    pageCount: arr((log as { pages?: unknown }).pages).length,
    entries,
    hasBody: entries.some((e) => e.body !== null && e.body !== ''),
  }
}

function normalizeEntry(raw: unknown, index: number): HarEntry {
  const e = (raw ?? {}) as Record<string, unknown>
  const req = (e.request ?? {}) as Record<string, unknown>
  const res = (e.response ?? {}) as Record<string, unknown>
  const content = (res.content ?? {}) as Record<string, unknown>
  const timings = (e.timings ?? {}) as Record<string, unknown>

  const url = str(req.url)
  const status = num(res.status)

  // body 有三种可能：已解码文本、base64 文本、根本没记录
  const contentEncoding = str(content.encoding)
  const bodyText = typeof content.text === 'string' ? content.text : null
  const isB64 = contentEncoding === 'base64'

  // 总耗时：优先用 entry.time；没有就用各阶段之和
  const phases =
    t(timings.blocked) +
    t(timings.dns) +
    t(timings.connect) +
    t(timings.send) +
    t(timings.wait) +
    t(timings.receive)
  const time = num(e.time) > 0 ? num(e.time) : phases

  const error = str(e._error as string)

  return {
    index,
    method: str(req.method),
    url,
    host: hostOf(url),
    path: pathOf(url),
    status,
    statusText: str(res.statusText),
    httpVersion: str(req.httpVersion) || str(res.httpVersion),
    mimeType: str(content.mimeType),
    // Chrome 私有字段：缺失时给空串，不影响渲染
    resourceType: str(e._resourceType as string),
    priority: str(e._priority as string),
    bodySize: num(res.bodySize),
    // _transferSize 才是「含协议开销的真实传输量」，没有则退回 bodySize
    transferSize:
      typeof res._transferSize === 'number' ? num(res._transferSize) : num(res.bodySize),
    serverIP: str(e.serverIPAddress),
    connection: str(e.connection),
    headerCount: arr(req.headers).length,
    respHeaderCount: arr(res.headers).length,
    queryCount: arr(req.queryString).length,
    body: bodyText,
    bodyEncoding: isB64 ? 'base64' : 'text',
    postData: str((req.postData as Record<string, unknown> | undefined)?.text),
    redirectURL: str(res.redirectURL),
    isRedirect: status >= 300 && status < 400,
    // status 0 = 网络层没拿到响应；有 _error 时信息更具体
    isFailed: status === 0 || status >= 400,
    error,
    startedMs: Date.parse(str(e.startedDateTime)) || 0,
    time,
    dns: t(timings.dns),
    connect: t(timings.connect),
    ssl: t(timings.ssl),
    send: t(timings.send),
    wait: t(timings.wait),
    receive: t(timings.receive),
    blocked: t(timings.blocked),
  }
}

/* ================= 瀑布 ================= */

/**
 * 构造时序瀑布：按开始时间排序，每行带上相对第一条的偏移。
 *
 * 失败请求也要在列表里 —— 它同样占了时间，而且往往正是用户要找的那一条。
 */
export function buildWaterfall(entries: readonly HarEntry[]): WaterfallRow[] {
  const sorted = [...entries].sort((a, b) => a.startedMs - b.startedMs)
  const base = sorted.length ? sorted[0].startedMs : 0
  return sorted.map((e) => ({
    index: e.index,
    offset: Math.max(0, e.startedMs - base),
    method: e.method,
    url: e.url,
    host: e.host,
    status: e.status,
    mimeType: e.mimeType,
    resourceType: e.resourceType,
    time: e.time,
    dns: e.dns,
    connect: e.connect,
    ssl: e.ssl,
    send: e.send,
    wait: e.wait,
    receive: e.receive,
    blocked: e.blocked,
    isFailed: e.isFailed,
  }))
}

/* ================= 域名汇总 ================= */

/**
 * 按域名汇总条数与字节数，按字节数降序。
 *
 * 「哪些域名最占带宽」是看 HAR 最常见的诉求，先给这张表比给一堆原始 entry 更有用。
 */
export function summarizeByHost(entries: readonly HarEntry[]): HostSummary[] {
  const map = new Map<string, HostSummary>()
  for (const e of entries) {
    const cur = map.get(e.host) ?? { host: e.host, count: 0, bytes: 0, failed: 0 }
    cur.count++
    // 负数字节（-1 表示未采集）按 0 算，否则汇总会莫名变小
    cur.bytes += e.transferSize > 0 ? e.transferSize : 0
    if (e.isFailed) cur.failed++
    map.set(e.host, cur)
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes)
}

/* ================= 原始字段提取（供详情页用） ================= */

/** HAR 里的 name/value 对（headers / queryString / cookies 共用这个形状） */
export interface NameValue {
  name: string
  value: string
}

/**
 * 提取某个 entry 的请求头 / 响应头 / 查询参数。
 *
 * 详情页要显示这些，但解析逻辑必须留在 toolkit —— 组件里再写一遍遍历逻辑，
 * 两边就会慢慢走样（null 处理的差异最先暴露）。
 *
 * 原 entry 对象没有保留在归一化结果里（那样内存占用太大），
 * 所以这个函数接受**原始 HAR** 并按 index 取。
 */
export function extractEntryDetail(
  har: unknown,
  index: number,
): { requestHeaders: NameValue[]; responseHeaders: NameValue[]; queryString: NameValue[] } | null {
  const log = (har as { log?: { entries?: unknown } })?.log
  const entries = arr(log?.entries)
  const e = entries[index] as Record<string, unknown> | undefined
  if (!e) return null
  const req = (e.request ?? {}) as Record<string, unknown>
  const res = (e.response ?? {}) as Record<string, unknown>
  const nv = (list: unknown): NameValue[] =>
    arr(list).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      return { name: str(o.name), value: str(o.value) }
    })
  return {
    requestHeaders: nv(req.headers),
    responseHeaders: nv(res.headers),
    queryString: nv(req.queryString),
  }
}

/* ================= 展示辅助 ================= */

/**
 * 字节数格式化。
 *
 * 负数直接显示 `-`：HAR 用 -1 表示「未采集」，显示成 `-1 B` 会让用户以为
 * 真的传输了负数字节。
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
