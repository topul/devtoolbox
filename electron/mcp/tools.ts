/**
 * MCP 工具执行体 —— 把 `src/lib/mcp-catalog.ts` 里的声明绑定到具体实现。
 *
 * 实现全部复用 `src/lib/toolkit`（与界面同一份代码）和 `electron/main/http.ts`
 * 的请求引擎，因此这里只做「参数解析 + 结果整形」，不重新实现任何算法。
 *
 * 不允许 import electron：产物要能作为纯 Node 进程被客户端的 MCP 客户端 spawn。
 */
import {
  applyLineOp,
  base64ToUtf8,
  chainDecode,
  chainEncode,
  chmodConvert,
  cidrInfo,
  convertCase,
  convertCaseAll,
  cronNextRuns,
  dateDiff,
  dateToTimestamp,
  diffAsText,
  digest,
  digestAll,
  estimateMessages,
  estimateTokens,
  evalJsonPath,
  fakeRowsToCsv,
  formatLocal,
  generateFakeRows,
  generatePassword,
  generateUuids,
  hmacDigest,
  aesDecrypt,
  aesEncrypt,
  htmlEntityDecode,
  htmlEntityEncode,
  htmlEntityEncodeNumeric,
  ipConvert,
  jsonFormat,
  jsonSortKeys,
  jsonValidate,
  jsonToYaml,
  jwtDecode,
  jwtIsExpired,
  lineDiff,
  parseCookie,
  parseToolSchema,
  parseUrl,
  parseUserAgent,
  radixConvert,
  regexTest,
  renderSchema,
  SCHEMA_TARGETS,
  summarizeIssues,
  textStats,
  timestampToDate,
  utf8ToBase64,
  yamlToJson,
  type CaseStyle,
  type ChainCodec,
  type HashAlgo,
  type HmacAlgo,
  type LineOp,
  type SchemaTarget,
} from '../../src/lib/toolkit'
import { genL } from '../../src/lib/locales/generators'
import { performRequest } from '../main/http'

export type ToolArgs = Record<string, unknown>
export type ToolResult = string | Record<string, unknown>
export type ToolHandler = (args: ToolArgs) => Promise<ToolResult> | ToolResult

/* ================= 参数解析 ================= */

function str(args: ToolArgs, key: string, required = true): string {
  const v = args[key]
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`缺少参数 ${key}`)
    return ''
  }
  if (typeof v === 'object') throw new Error(`参数 ${key} 应为字符串`)
  return String(v)
}

function optStr(args: ToolArgs, key: string, fallback: string): string {
  return str(args, key, false) || fallback
}

function num(args: ToolArgs, key: string, fallback: number): number {
  const v = args[key]
  if (v === undefined || v === null || v === '') return fallback
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (Number.isNaN(n)) throw new Error(`参数 ${key} 应为数字`)
  return n
}

function bool(args: ToolArgs, key: string, fallback: boolean): boolean {
  const v = args[key]
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(s)) return true
  if (['false', '0', 'no', 'n'].includes(s)) return false
  throw new Error(`参数 ${key} 应为布尔值`)
}

function enumArg<T extends string>(args: ToolArgs, key: string, allowed: readonly T[], fallback?: T): T {
  const v = args[key]
  if (v === undefined || v === null || v === '') {
    if (fallback === undefined) throw new Error(`缺少参数 ${key}`)
    return fallback
  }
  const s = String(v)
  const hit = allowed.find((a) => a.toLowerCase() === s.toLowerCase())
  if (!hit) throw new Error(`参数 ${key} 只能是 ${allowed.join(' / ')}，收到 ${s}`)
  return hit
}

/** 可选枚举：没传返回 undefined，让调用方决定「缺省时输出全部」 */
function optEnum<T extends string>(args: ToolArgs, key: string, allowed: readonly T[]): T | undefined {
  const v = args[key]
  if (v === undefined || v === null || v === '') return undefined
  return enumArg(args, key, allowed)
}

/* ================= 编解码 ================= */

const CODECS: ChainCodec[] = ['url', 'doubleUrl', 'html', 'unicode', 'hex', 'base64']
const CASE_STYLES: CaseStyle[] = [
  'camelCase', 'PascalCase', 'snake_case', 'SCREAMING_SNAKE', 'kebab-case', 'UPPERCASE', 'lowercase',
]
const LINE_OPS: LineOp[] = [
  'dedupe', 'removeEmpty', 'trim', 'sortAsc', 'sortDesc', 'sortNumeric', 'shuffle', 'reverse', 'number', 'quote', 'join',
]
const HASH_ALGOS: HashAlgo[] = ['MD5', 'SHA1', 'SHA256', 'SHA512', 'SHA3', 'RIPEMD160']
const HMAC_ALGOS: HmacAlgo[] = ['MD5', 'SHA1', 'SHA256', 'SHA512']

const q = (s: string): string => JSON.stringify(s)

/* ================= 处理器表 ================= */

export const HANDLERS: Record<string, ToolHandler> = {
  /* ---------- codec ---------- */
  base64_encode: (a) => utf8ToBase64(str(a, 'text'), bool(a, 'urlSafe', false)),

  base64_decode: (a) => base64ToUtf8(str(a, 'text')),

  url_encode: (a) => {
    const mode = enumArg(a, 'mode', ['component', 'full', 'double'] as const, 'component')
    const t = str(a, 'text')
    return mode === 'component'
      ? encodeURIComponent(t)
      : mode === 'full'
        ? encodeURI(t)
        : encodeURIComponent(encodeURIComponent(t))
  },

  url_decode: (a) => {
    const mode = enumArg(a, 'mode', ['component', 'full', 'double'] as const, 'component')
    const t = str(a, 'text')
    return mode === 'component'
      ? decodeURIComponent(t)
      : mode === 'full'
        ? decodeURI(t)
        : decodeURIComponent(decodeURIComponent(t))
  },

  escape_convert: (a) => {
    const codec = enumArg(a, 'codec', CODECS)
    const mode = enumArg(a, 'mode', ['encode', 'decode'] as const, 'encode')
    return mode === 'encode' ? chainEncode(codec, str(a, 'text')) : chainDecode(codec, str(a, 'text'))
  },

  html_entity: (a) => {
    const mode = enumArg(a, 'mode', ['encode', 'decode'] as const, 'encode')
    const t = str(a, 'text')
    if (mode === 'decode') return htmlEntityDecode(t)
    return bool(a, 'numeric', false) ? htmlEntityEncodeNumeric(t) : htmlEntityEncode(t)
  },

  radix_convert: (a) => {
    const r = radixConvert(str(a, 'input'), num(a, 'from', 10))
    return { dec: r.dec, hex: r.hex, oct: r.oct, bin: r.bin }
  },

  /* ---------- crypto ---------- */
  hash: (a) => {
    const text = str(a, 'text')
    const algo = optEnum(a, 'algorithm', HASH_ALGOS)
    if (!algo) {
      return digestAll(text).map((x) => `${x.label}: ${x.value}`).join('\n')
    }
    return digest(algo, text)
  },

  hmac: (a) => {
    const algo = enumArg(a, 'algorithm', HMAC_ALGOS, 'SHA256')
    return hmacDigest(algo, str(a, 'text'), str(a, 'key'))
  },

  aes_crypt: (a) => {
    const mode = enumArg(a, 'mode', ['ECB', 'CBC'] as const, 'ECB')
    const op = enumArg(a, 'op', ['encrypt', 'decrypt'] as const, 'encrypt')
    const text = str(a, 'text')
    const key = str(a, 'key')
    return op === 'encrypt' ? aesEncrypt(text, key, mode) : aesDecrypt(text, key, mode)
  },

  jwt_decode: (a) => {
    const d = jwtDecode(str(a, 'token'))
    const expired = jwtIsExpired(d.payloadObj)
    const claims: string[] = []
    const claim = (k: string, asDate: boolean): void => {
      const v = d.payloadObj[k]
      if (typeof v !== 'number' && typeof v !== 'string') return
      if (asDate && typeof v === 'number') {
        claims.push(`${k}: ${v} (${formatLocal(new Date(v * 1000))})`)
      } else {
        claims.push(`${k}: ${String(v)}`)
      }
    }
    claim('exp', true)
    claim('iat', true)
    claim('nbf', true)
    claim('iss', false)
    claim('sub', false)
    claim('aud', false)
    return [
      `header:\n${d.header}`,
      `payload:\n${d.payload}`,
      `signature: ${d.signed ? d.signature : '(无签名段)'}`,
      expired === null ? 'exp: 未声明，无法判断是否过期' : `是否过期: ${expired ? '已过期' : '未过期'}`,
      ...claims,
    ].join('\n\n')
  },

  /* ---------- data ---------- */
  json_format: (a) => {
    const mode = enumArg(a, 'mode', ['format', 'minify', 'sort'] as const, 'format')
    const text = str(a, 'text')
    if (mode === 'minify') return JSON.stringify(JSON.parse(text))
    if (mode === 'sort') return JSON.stringify(jsonSortKeys(JSON.parse(text)), null, num(a, 'indent', 2))
    return jsonFormat(text, num(a, 'indent', 2))
  },

  json_validate: (a) => {
    const r = jsonValidate(str(a, 'text'))
    return r.ok ? '合法 JSON' : `非法 JSON：${r.error}`
  },

  json_query: (a) => {
    const obj = JSON.parse(str(a, 'json'))
    const hits = evalJsonPath(obj, str(a, 'path'))
    if (!hits.length) return `没有匹配到结果（共 0 项）`
    if (hits.length === 1) return JSON.stringify(hits[0], null, 2)
    return `命中 ${hits.length} 项：\n` + JSON.stringify(hits, null, 2)
  },

  yaml_convert: (a) => {
    const mode = enumArg(a, 'mode', ['yaml2json', 'json2yaml'] as const, 'yaml2json')
    const text = str(a, 'text')
    return mode === 'yaml2json' ? yamlToJson(text, 2) : jsonToYaml(text)
  },

  /* ---------- text ---------- */
  text_case: (a) => {
    const text = str(a, 'text')
    const style = optEnum(a, 'style', CASE_STYLES)
    if (!style) {
      return convertCaseAll(text).map((x) => `${x.style}: ${x.value}`).join('\n')
    }
    return convertCase(text, style)
  },

  line_ops: (a) => {
    const op = enumArg(a, 'op', LINE_OPS)
    return applyLineOp(str(a, 'text'), op, { separator: optStr(a, 'separator', ',') })
  },

  text_stats: (a) => {
    const s = textStats(str(a, 'text'))
    return [
      `字符数: ${s.chars}`,
      `去空白字符数: ${s.charsNoSpace}`,
      `中文字符数: ${s.cjk}`,
      `英文单词数: ${s.words}`,
      `行数: ${s.lines}`,
      `段落数: ${s.paragraphs}`,
      `UTF-8 字节数: ${s.bytes}`,
    ].join('\n')
  },

  check_tool_schema: (a) => {
    const raw = str(a, 'schema')
    const target = enumArg({ target: str(a, 'target', false) }, 'target', SCHEMA_TARGETS, 'typescript')
    const { tools, issues } = parseToolSchema(raw)
    const code = renderSchema(tools, target as SchemaTarget)
    const { errors, warns } = summarizeIssues(issues)
    const names = tools.map((t) => t.name || '(未命名)').join(', ')
    const rows = issues.length
      ? issues.map((i) => `  [${i.level === 'error' ? '错误' : '建议'}] ${i.code} @ ${i.path}${i.detail === undefined ? '' : `（${i.detail}）`}`)
      : ['  （无问题）']
    return [
      `工具：${names}（共 ${tools.length} 个）`,
      `输出格式：${target}`,
      `体检：错误 ${errors} 项 · 建议 ${warns} 项`,
      '',
      code,
      '',
      '体检明细：',
      ...rows,
    ].join('\n')
  },

  estimate_tokens: (a) => {
    const messagesJson = str(a, 'messages', false)
    if (messagesJson) {
      const parsed = JSON.parse(messagesJson) as { role?: unknown; content?: unknown }[]
      if (!Array.isArray(parsed)) throw new Error('messages 应为 JSON 数组')
      const msgs = parsed.map((m, i) => ({
        role: typeof m?.role === 'string' ? m.role : 'user',
        content: typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''),
        i,
      }))
      const est = estimateMessages(msgs)
      const lines = msgs.map((m) => `  #${m.i + 1} ${m.role}: ${est.perMessage[m.i]}`)
      return [
        `正文估算: ${est.tokens} token`,
        `协议开销: ${est.overhead} token（${msgs.length} 条消息 × 4 + 3）`,
        `合计: ${est.total} token`,
        '',
        '每条明细（token）:',
        ...lines,
        '',
        '注：按字符启发式估算（±20%），非真实分词。',
      ].join('\n')
    }
    const text = str(a, 'text')
    const t = estimateTokens(text)
    return [
      `估算: ${t.tokens} token`,
      `明细: 拉丁字母数字 ${t.latinChars} 字符 / 中文 ${t.cjkChars} 字 / 其它 ${t.otherChars} 字符 / 英文单词 ${t.words}`,
      '注：按字符启发式估算（±20%），非真实分词。',
    ].join('\n')
  },

  diff: (a) => {
    const a1 = str(a, 'a')
    const b1 = str(a, 'b')
    const lines = lineDiff(a1, b1)
    const add = lines.filter((l) => l.type === 'add').length
    const del = lines.filter((l) => l.type === 'del').length
    const format = enumArg(a, 'format', ['text', 'json'] as const, 'text')
    if (format === 'json') return { add, del, lines }
    return `+${add} 行 / -${del} 行\n\n` + diffAsText(a1, b1)
  },

  regex_test: (a) => {
    const hits = regexTest(str(a, 'pattern'), optStr(a, 'flags', 'g'), str(a, 'text'))
    if (!hits.length) return '没有匹配'
    const body = hits
      .slice(0, 200)
      .map((h, i) => {
        const groups = h.groups.length ? `  分组: ${JSON.stringify(h.groups)}` : ''
        const named = Object.keys(h.named).length ? `  命名组: ${JSON.stringify(h.named)}` : ''
        return `#${i + 1} @${h.index} ${q(h.match)}${groups}${named}`
      })
      .join('\n')
    const more = hits.length > 200 ? `\n（共 ${hits.length} 个匹配，此处只显示前 200 个）` : ''
    return `共 ${hits.length} 个匹配：\n${body}${more}`
  },

  /* ---------- time ---------- */
  timestamp_convert: (a) => {
    const ts = str(a, 'timestamp', false)
    const date = str(a, 'date', false)
    const unit = enumArg(a, 'unit', ['auto', 's', 'ms', 'us', 'ns'] as const, 'auto')
    const parts = ts ? timestampToDate(ts, unit) : date ? dateToTimestamp(date) : timestampToDate(Date.now(), 'ms')
    return [
      `本地时间: ${parts.local}`,
      `UTC: ${parts.utc}`,
      `ISO 8601: ${parts.iso}`,
      `Unix 秒: ${parts.unixSec}`,
      `Unix 毫秒: ${parts.unixMs}`,
    ].join('\n')
  },

  date_diff: (a) => {
    const r = dateDiff(str(a, 'a'), str(a, 'b'))
    return [
      `相差: ${r.days} 天（${r.weeks} 周 / ${r.hours} 小时 / ${r.minutes} 分钟 / ${r.seconds} 秒）`,
      `方向: b 比 a ${r.direction === 1 ? '晚' : '早'}`,
    ].join('\n')
  },

  cron_next: (a) => {
    const r = cronNextRuns(str(a, 'expr'), Math.min(Math.max(num(a, 'count', 8), 1), 50))
    if (!r.ok) {
      const e = r.error
      if (e.code === 'NEED_5_FIELDS') throw new Error(`cron 表达式需要 5 段，收到 ${e.got} 段`)
      if (e.code === 'BAD_FIELD') throw new Error(`无法解析字段：${e.field}`)
      throw new Error(`字段 ${e.field} 超出取值范围 ${e.min}-${e.max}`)
    }
    return r.dates.map((d, i) => `#${i + 1}  ${formatLocal(d)}  周${'日一二三四五六'[d.getDay()]}`).join('\n')
  },

  /* ---------- net ---------- */
  ip_convert: (a) => {
    const r = ipConvert(str(a, 'input'))
    return [
      `点分十进制: ${r.ip}`,
      `十进制: ${r.decimal}`,
      `十六进制: ${r.hex}`,
      `八进制: ${r.octal}`,
      `点分十六进制: ${r.dottedHex}`,
      `点分八进制: ${r.dottedOctal}`,
    ].join('\n')
  },

  cidr_info: (a) => {
    const r = cidrInfo(str(a, 'cidr'))
    return [
      `IP: ${r.ip}`,
      `网络地址: ${r.network}/${r.cidr}`,
      `广播地址: ${r.broadcast}`,
      `子网掩码: ${r.mask}`,
      `通配符掩码: ${r.wildcard}`,
      `可用主机范围: ${r.firstHost} - ${r.lastHost}`,
      `可用主机数: ${r.hosts}`,
      `地址类别: ${r.ipClass}`,
      `私有地址: ${r.isPrivate ? '是' : '否'}`,
    ].join('\n')
  },

  chmod_convert: (a) => {
    const r = chmodConvert(str(a, 'input'))
    return [`八进制: ${r.octal}`, `符号: ${r.symbolic}`, `命令: chmod ${r.octal} <file>`].join('\n')
  },

  url_parse: (a) => {
    const r = parseUrl(str(a, 'url'))
    return {
      protocol: r.protocol,
      username: r.username,
      password: r.password,
      hostname: r.hostname,
      port: r.port,
      pathname: r.pathname,
      hash: r.hash,
      params: Object.fromEntries(r.params.map((x) => [x.k, x.v])),
    }
  },

  cookie_parse: (a) => {
    const r = parseCookie(str(a, 'cookie'))
    const ks = r.attrs.map((x) => x.k)
    const lines = [
      r.cookie ? `名称: ${r.cookie.name}\n值: ${r.cookie.value}` : '（未解析出 name=value）',
      '',
      '属性：',
      ...r.attrs.map((x) => `  ${x.k}${x.flag ? '' : ' = ' + x.v}`),
      '',
      '安全标记：',
      `  HttpOnly: ${ks.includes('httponly') ? '有' : '缺失'}`,
      `  Secure: ${ks.includes('secure') ? '有' : '缺失'}`,
      `  SameSite: ${ks.includes('samesite') ? '有' : '缺失'}`,
    ]
    return lines.join('\n')
  },

  ua_parse: (a) => {
    const r = parseUserAgent(str(a, 'ua'))
    const dev = { desktop: '桌面', mobile: '手机', tablet: '平板' }[r.device]
    return [
      `浏览器: ${r.browser ? r.browser + ' ' + r.version : '未识别'}`,
      `操作系统: ${r.os || '未识别'}`,
      `设备类型: ${dev}`,
      `爬虫/工具: ${r.bot ?? '无'}`,
    ].join('\n')
  },

  /* ---------- gen ---------- */
  uuid_generate: (a) =>
    generateUuids({
      count: num(a, 'count', 1),
      upper: bool(a, 'upper', false),
      noDash: bool(a, 'noDash', false),
    }).join('\n'),

  password_generate: (a) => {
    const r = generatePassword({
      length: num(a, 'length', 16),
      lower: bool(a, 'lower', true),
      upper: bool(a, 'upper', true),
      digit: bool(a, 'digit', true),
      symbol: bool(a, 'symbol', true),
      excludeAmbiguous: bool(a, 'excludeAmbiguous', false),
    })
    return `${r.password}\n\n熵值: ${r.bits} bit（字符集 ${r.poolSize} 个）`
  },

  fake_data: (a) => {
    const locale = enumArg(a, 'locale', ['zh', 'en'] as const, 'zh')
    const format = enumArg(a, 'format', ['json', 'csv'] as const, 'json')
    const src = genL[locale].fakeData
    const rows = generateFakeRows(locale, {
      surnames: src.surnames,
      givens: src.givens,
      phonePrefixes: src.phonePrefixes,
      domains: src.domains,
      areas: src.areas,
      firstNames: src.firstNames,
      lastNames: src.lastNames,
      enDomains: src.enDomains,
    }, num(a, 'count', 10))
    return format === 'csv' ? fakeRowsToCsv(rows) : JSON.stringify(rows, null, 2)
  },

  /* ---------- http ---------- */
  http_request: async (a) => {
    const url = str(a, 'url')
    const method = optStr(a, 'method', 'GET').toUpperCase()
    const headers = parseHeaderLines(str(a, 'headers', false))
    const bodyText = str(a, 'body', false)
    const res = await performRequest({
      method,
      url,
      headers,
      bodyText: bodyText || null,
      timeoutMs: num(a, 'timeoutMs', 30000),
      followRedirects: bool(a, 'followRedirects', true),
      rejectUnauthorized: bool(a, 'rejectUnauthorized', true),
      proxy: str(a, 'proxy', false) || null,
    })

    if (!res.ok) {
      return `请求失败: ${res.error ?? '未知错误'}${res.errorCode ? ` (${res.errorCode})` : ''}\nURL: ${res.url}`
    }

    const bodyStr = Buffer.from(res.bodyBase64, 'base64').toString('utf8')
    const printable = /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(bodyStr.slice(0, 4096))
    const head = [
      `${res.method} ${url}`,
      `状态: ${res.status} ${res.statusText}  HTTP/${res.httpVersion}`,
      `远端: ${res.remoteAddress}${res.viaProxy ? '（经代理）' : ''}`,
      `耗时: 总计 ${res.timings.totalMs}ms（连接 ${res.timings.connectMs} / TLS ${res.timings.tlsMs} / 首字节 ${res.timings.ttfbMs}）`,
      res.contentEncoding ? `内容编码: ${res.contentEncoding}${res.decompressed ? '（已解压）' : ''}` : '',
      res.truncated ? `注意: 响应体超过上限，已截断（原始 ${res.rawBytes} 字节）` : '',
      res.redirects.length ? `重定向链: ${res.redirects.map((r) => `${r.status}→${r.location}`).join(' , ')}` : '',
      res.tls ? `TLS: ${res.tls.protocol} ${res.tls.cipher}${res.tls.authorized ? '' : `（证书未通过校验: ${res.tls.authorizationError}）`}` : '',
      '',
      '响应头:',
      ...res.headers.map(([k, v]) => `  ${k}: ${v}`),
      '',
      `响应体（${res.bodyBytes} 字节）:`,
      printable ? bodyStr : `（二进制内容，Base64 前 2048 字符）\n${res.bodyBase64.slice(0, 2048)}`,
    ]
    return head.filter((l) => l !== '').join('\n')
  },
}

/** `Name: value` 每行一条，允许重名头（原样保留顺序） */
export function parseHeaderLines(raw: string): [string, string][] {
  if (!raw) return []
  const out: [string, string][] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf(':')
    if (i <= 0) throw new Error(`请求头格式应为 "Name: value"，收到：${t}`)
    out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()])
  }
  return out
}
