/**
 * HTTP 请求的「中立文档模型 + curl/PowerShell 解析 + 多语言代码生成 + 请求文件读写」。
 *
 * 为什么单独一个文件：请求测试页的表单状态（Row[] / bodyMode / auth / options）不适合直接
 * 序列化 —— 粘贴进来的 curl、导出的 JSON、生成出来的代码，三者真正需要的都是同一个东西：
 * 「方法 + URL + 有序头 + 正文 + 几个开关」。这里把它定成 RequestDoc，三处共用一份实现，
 * 避免「解析一套、导出另一套、生成第三套」慢慢走样。
 *
 * 纯函数：不依赖 DOM / React / Node 内置，可在 Node 下直接断言（npm run smoke:httpcodec）。
 * 错误一律用稳定错误码，文案归界面词条。
 */

/* ================= 文档模型 ================= */

export type RequestBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'fields'; fields: [string, string][]; multipart: boolean }

export interface RequestDoc {
  method: string
  url: string
  /** 有序、允许重名 */
  headers: [string, string][]
  body: RequestBody
  followRedirects: boolean
  verifyTls: boolean
  proxy: string | null
}

export function emptyDoc(): RequestDoc {
  return { method: 'GET', url: '', headers: [], body: { kind: 'none' }, followRedirects: false, verifyTls: true, proxy: null }
}

export function headerValue(headers: [string, string][], name: string): string | null {
  const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
  return hit ? hit[1] : null
}

/** 实际发出的请求（HttpRequestSpec 的结构子集），用来按真实发送结果生成代码 */
export interface RequestSpecLike {
  method: string
  url: string
  headers?: [string, string][]
  bodyText?: string | null
  followRedirects?: boolean
  rejectUnauthorized?: boolean
  proxy?: string | null
}

export function docFromRequestSpec(spec: RequestSpecLike, fallbackUrl = ''): RequestDoc {
  return {
    method: spec.method || 'GET',
    url: spec.url || fallbackUrl,
    headers: spec.headers ?? [],
    body: spec.bodyText ? { kind: 'text', text: spec.bodyText } : { kind: 'none' },
    followRedirects: spec.followRedirects === true,
    verifyTls: spec.rejectUnauthorized !== false,
    proxy: spec.proxy ?? null,
  }
}

/** 正文落成实际要发的字节与 Content-Type（生成代码与回填表单共用，避免两套编码规则） */
export function materializeBody(doc: RequestDoc): { text: string | null; contentType: string | null } {
  if (doc.body.kind === 'none') return { text: null, contentType: null }
  const declared = headerValue(doc.headers, 'content-type')
  if (doc.body.kind === 'text') {
    return { text: doc.body.text.trim() ? doc.body.text : null, contentType: declared }
  }
  if (doc.body.multipart) {
    const lines: string[] = []
    for (const [k, v] of doc.body.fields) {
      lines.push(`--${MULTIPART_BOUNDARY}`, `Content-Disposition: form-data; name="${k}"`, '', v)
    }
    lines.push(`--${MULTIPART_BOUNDARY}--`, '')
    // boundary 是我们自己生成的，因此必须覆盖声明的 Content-Type，否则两边对不上
    return { text: lines.join('\r\n'), contentType: `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` }
  }
  const text = doc.body.fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return { text: text || null, contentType: declared ?? 'application/x-www-form-urlencoded' }
}

export const MULTIPART_BOUNDARY = '----DevToolboxBoundary'

/**
 * 生成代码时用的请求头。
 *
 * 存在感来自一个具体的坑：字段式正文的 boundary 是我们自己造的，如果文档头里还留着上一轮
 * 生成的 `multipart/form-data; boundary=xxx`，就会出现「头里一个 boundary、正文里另一个」
 * —— 生成的代码看着像对的，发出去却解析不出字段。所以正文类型以 materializeBody 为准。
 */
export function effectiveHeaders(doc: RequestDoc): [string, string][] {
  const { contentType } = materializeBody(doc)
  if (!contentType) return doc.headers
  const i = doc.headers.findIndex(([k]) => k.toLowerCase() === 'content-type')
  if (i < 0) return [...doc.headers, ['Content-Type', contentType]]
  if (doc.headers[i][1] === contentType) return doc.headers
  const out = [...doc.headers]
  out[i] = [out[i][0], contentType]
  return out
}

/* ================= curl / PowerShell 解析 ================= */

export type ParseWarningCode =
  | 'METHOD_INFERRED'
  | 'UNKNOWN_FLAG'
  | 'FILE_BODY'
  | 'MULTI_URL'
  | 'DATA_URLENCODE'
  | 'HEADER_NO_COLON'

export type ParseErrorCode = 'EMPTY_INPUT' | 'NO_URL' | 'UNSUPPORTED'

export interface ParseWarning {
  code: ParseWarningCode
  /** 出问题的原文片段（开关名、请求头等），由界面拼进提示文案 */
  detail?: string
}

export interface ParseResult {
  ok: boolean
  errorCode?: ParseErrorCode
  request?: RequestDoc
  warnings: ParseWarning[]
}

/** 会消费下一个 token 的开关（自己处理的） */
const OWN_VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
  '--data-urlencode', '-F', '--form', '-u', '--user', '-b', '--cookie', '-A', '--user-agent',
  '-e', '--referer', '-x', '--proxy', '--url',
])
/** 会消费下一个 token、但我们不关心的开关（不放过的话，值会被误当成 URL） */
const IGNORED_VALUE_FLAGS = new Set([
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out',
  '--retry', '--retry-delay', '--retry-max-time', '-c', '--cookie-jar', '-U', '--proxy-user',
  '-T', '--upload-file', '--cert', '--key', '--cacert', '-E', '--capath', '--resolve',
  '--interface', '-r', '--range', '--limit-rate', '--max-redirs', '--host', '--unix-socket',
  '-D', '--dump-header', '--trace', '--trace-ascii', '--output-dir', '--connect-to',
])
/** 不消费值的开关 */
const IGNORED_BARE_FLAGS = new Set([
  '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include', '-f', '--fail',
  '-#', '--progress-bar', '-g', '--globoff', '-4', '-6', '--ipv4', '--ipv6', '--compressed',
  '--no-buffer', '-N', '--raw', '--path-as-is', '--no-keepalive', '--http1.0', '--http1.1',
  '--http2', '--http2-prior-knowledge', '--tlsv1.2', '--tlsv1.3', '--tcp-nodelay', '-q', '--disable',
  '-j', '--junk-session-cookies', '--no-progress-meter', '--fail-with-body', '--retry-all-errors',
  '--ssl-no-revoke', '--location-trusted', '--no-clobber',
])

/**
 * 把三种续行写法归一成空格：bash 的 `\`、PowerShell 的反引号、cmd 的 `^`。
 * 不做这步，DevTools 复制出来的多行命令只会被认成「URL 后面跟了一堆垃圾」。
 */
function normalizeContinuations(input: string): string {
  return input
    .replace(/\\\r?\n\s*/g, ' ')
    .replace(/`\r?\n\s*/g, ' ')
    .replace(/\^\r?\n\s*/g, ' ')
}

/**
 * shell 风格分词：单引号内不转义（`''` 当字面量），双引号内认 `\\` `\"` `\n` `\t` `\r`，
 * 引号外 `\X` 一律退化成 X —— 这一条正好吃下 bash 里 `'it'\''s'` 这种拼接写法。
 * 引号没闭合时不抛错，按字面量收尾（用户手改过的命令很常见）。
 */
export function tokenizeCommand(input: string): string[] {
  const s = normalizeContinuations(input)
  const out: string[] = []
  let cur = ''
  let started = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote === "'") {
      if (ch === "'") {
        if (s[i + 1] === "'") { cur += "'"; i++; continue }
        quote = null
        continue
      }
      cur += ch
      continue
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < s.length) {
        const nxt = s[i + 1]
        if (nxt === '"' || nxt === '\\' || nxt === '$' || nxt === '`') { cur += nxt; i++; continue }
        if (nxt === 'n') { cur += '\n'; i++; continue }
        if (nxt === 't') { cur += '\t'; i++; continue }
        if (nxt === 'r') { cur += '\r'; i++; continue }
        cur += ch
        continue
      }
      if (ch === '"') { quote = null; continue }
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue }
    if (ch === '\\' && i + 1 < s.length) { cur += s[i + 1]; i++; started = true; continue }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (started || cur) { out.push(cur); cur = ''; started = false }
      continue
    }
    cur += ch
    started = true
  }
  if (started || cur) out.push(cur)
  return out
}

function parseHeader(warnings: ParseWarning[], raw: string): [string, string] {
  if (raw.endsWith(';')) return [raw.slice(0, -1).trim(), '']
  const at = raw.indexOf(':')
  if (at < 0) {
    warnings.push({ code: 'HEADER_NO_COLON', detail: raw })
    return [raw.trim(), '']
  }
  return [raw.slice(0, at).trim(), raw.slice(at + 1).trim()]
}

/** `--data-urlencode` 只编码等号右边，等号左边的名字原样保留（curl 的语义） */
function encodeDataUrlencoded(raw: string): string {
  const at = raw.indexOf('=')
  if (at < 0) return encodeURIComponent(raw)
  return `${raw.slice(0, at)}=${encodeURIComponent(raw.slice(at + 1))}`
}

function appendQuery(url: string, query: string): string {
  if (!query) return url
  const at = url.indexOf('#')
  const hash = at >= 0 ? url.slice(at) : ''
  const base = at >= 0 ? url.slice(0, at) : url
  return `${base}${base.includes('?') ? '&' : '?'}${query}${hash}`
}

export function parseCurlCommand(input: string): ParseResult {
  const warnings: ParseWarning[] = []
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, errorCode: 'EMPTY_INPUT', warnings }
  if (/^(invoke-webrequest|invoke-restmethod|iwr|irm)\b/i.test(raw)) {
    return { ok: false, errorCode: 'UNSUPPORTED', warnings }
  }

  const tokens = tokenizeCommand(raw)
  if (!tokens.length) return { ok: false, errorCode: 'EMPTY_INPUT', warnings }

  let i = 0
  while (i < tokens.length && /^(sudo|env|time)$/i.test(tokens[i])) i++
  if (i < tokens.length && /(^|[\\/])curl(\.exe)?$/i.test(tokens[i])) i++

  let method = ''
  const headers: [string, string][] = []
  const data: { value: string; encode: boolean }[] = []
  const fields: [string, string][] = []
  const positionals: string[] = []
  let followRedirects = false
  let verifyTls = true
  let proxy: string | null = null
  let asQuery = false
  let headMode = false
  let multipart = false

  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (t !== '-' && !t.startsWith('-')) { positionals.push(t); continue }

    const value = (): string => {
      const v = tokens[i + 1]
      if (v === undefined) { warnings.push({ code: 'UNKNOWN_FLAG', detail: t }); return '' }
      i++
      return v
    }

    if (t === '-X' || t === '--request') { method = value().toUpperCase(); continue }
    if (t === '-H' || t === '--header') { headers.push(parseHeader(warnings, value())); continue }
    if (t === '-F' || t === '--form') {
      const f = value()
      multipart = true
      if (f.includes('=@') || f.startsWith('@')) warnings.push({ code: 'FILE_BODY', detail: f })
      const at = f.indexOf('=')
      fields.push(at < 0 ? [f, ''] : [f.slice(0, at), f.slice(at + 1)])
      continue
    }
    if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      const v = value()
      if (v.startsWith('@')) warnings.push({ code: 'FILE_BODY', detail: v })
      else data.push({ value: v, encode: false })
      continue
    }
    if (t === '--data-urlencode') {
      const v = value()
      warnings.push({ code: 'DATA_URLENCODE', detail: v })
      data.push({ value: v, encode: true })
      continue
    }
    if (t === '-u' || t === '--user') { headers.push(['Authorization', `Basic ${utf8ToBase64(value())}`]); continue }
    if (t === '-b' || t === '--cookie') { headers.push(['Cookie', value()]); continue }
    if (t === '-A' || t === '--user-agent') { headers.push(['User-Agent', value()]); continue }
    if (t === '-e' || t === '--referer') { headers.push(['Referer', value()]); continue }
    if (t === '-x' || t === '--proxy') { proxy = value(); continue }
    if (t === '--url') { positionals.push(value()); continue }

    if (t === '-k' || t === '--insecure') { verifyTls = false; continue }
    if (t === '-L' || t === '--location' || t === '--location-trusted') { followRedirects = true; continue }
    if (t === '-G' || t === '--get') { asQuery = true; continue }
    if (t === '-I' || t === '--head') { headMode = true; continue }

    if (IGNORED_BARE_FLAGS.has(t)) continue
    if (IGNORED_VALUE_FLAGS.has(t)) { i++; continue }
    if (!OWN_VALUE_FLAGS.has(t)) warnings.push({ code: 'UNKNOWN_FLAG', detail: t })
  }

  if (!positionals.length) return { ok: false, errorCode: 'NO_URL', warnings }
  const url = positionals[0]
  if (positionals.length > 1) warnings.push({ code: 'MULTI_URL', detail: positionals[1] })

  const encoded = data.map((d) => (d.encode ? encodeDataUrlencoded(d.value) : d.value)).filter(Boolean)
  let body: RequestBody = { kind: 'none' }
  let finalUrl = url

  if (asQuery && encoded.length) {
    finalUrl = appendQuery(url, encoded
      .flatMap((part) => part.split('&'))
      .map((pair) => {
        const at = pair.indexOf('=')
        return at < 0 ? encodeURIComponent(pair) : `${encodeURIComponent(pair.slice(0, at))}=${encodeURIComponent(pair.slice(at + 1))}`
      })
      .join('&'))
  } else if (fields.length) {
    body = { kind: 'fields', fields, multipart }
  } else if (encoded.length) {
    body = { kind: 'text', text: encoded.join('&') }
  }

  const inferred = body.kind !== 'none'
  if (!method) {
    if (headMode) method = 'HEAD'
    else if (inferred && !asQuery) { method = 'POST'; warnings.push({ code: 'METHOD_INFERRED' }) }
    else method = 'GET'
  }

  return {
    ok: true,
    warnings,
    request: { method, url: finalUrl, headers, body, followRedirects, verifyTls, proxy },
  }
}

/* ================= 多语言代码生成 ================= */

export const CODE_TARGETS = ['curl', 'fetch', 'axios', 'python', 'httpx', 'go', 'java', 'php'] as const
export type CodeTarget = (typeof CODE_TARGETS)[number]

/** OkHttp 要求这些方法的 body 不能为 null，生成代码时得给个空正文 */
const BODY_REQUIRED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'PROPPATCH', 'REPORT'])

/** requests / httpx 有同名简写方法的方法集合；其余方法只能走 .request() */
const PY_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

/** JSON.stringify 的输出同时是合法的 JS / TS / Go / Java / Python 字符串字面量 */
const lit = (v: string): string => JSON.stringify(v)
/** PHP 单引号字符串：只需转义反斜杠与单引号 */
const phpLit = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const shellLit = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`

/** 无重名时用对象字面量（更像人写的）；有重名只能退化成数组，否则请求头会丢 */
function jsHeaders(headers: [string, string][], indent: number): string {
  const names = headers.map(([k]) => k.toLowerCase())
  const pad = ' '.repeat(indent)
  const dedupe = new Set(names).size === names.length
  if (!dedupe) return JSON.stringify(headers, null, 2).replace(/\n/g, `\n${pad}`)
  const obj: Record<string, string> = {}
  for (const [k, v] of headers) obj[k] = v
  return JSON.stringify(obj, null, 2).replace(/\n/g, `\n${pad}`)
}

function headerLines(headers: [string, string][], indent: string, quote: (v: string) => string, colons: boolean): string[] {
  return headers.map(([k, v]) => `${indent}${quote(k)}${colons ? ': ' : ' => '}${quote(v)},`)
}

export function generateCode(target: CodeTarget, doc: RequestDoc): string {
  const body = materializeBody(doc)
  const view: RequestDoc = { ...doc, headers: effectiveHeaders(doc) }
  switch (target) {
    case 'curl': return genCurl(view, body.text)
    case 'fetch': return genFetch(view, body.text)
    case 'axios': return genAxios(view, body.text)
    case 'python': return genPython(view, body)
    case 'httpx': return genHttpx(view, body)
    case 'go': return genGo(view, body.text)
    case 'java': return genJava(view, body)
    case 'php': return genPhp(view, body.text)
  }
}

function genCurl(doc: RequestDoc, bodyText: string | null): string {
  const parts = ['curl', `-X ${doc.method}`]
  if (doc.followRedirects) parts.push('-L')
  if (!doc.verifyTls) parts.push('-k')
  if (doc.proxy) parts.push(`--proxy ${shellLit(doc.proxy)}`)
  parts.push(shellLit(doc.url))
  for (const [k, v] of doc.headers) parts.push(`-H ${shellLit(`${k}: ${v}`)}`)
  if (bodyText) parts.push(`--data-raw ${shellLit(bodyText)}`)
  return parts.join(' \\\n  ')
}

function genFetch(doc: RequestDoc, bodyText: string | null): string {
  const init = [`  method: ${lit(doc.method)}`]
  if (doc.headers.length) init.push(`  headers: ${jsHeaders(doc.headers, 2)}`)
  if (bodyText) init.push(`  body: ${lit(bodyText)}`)
  return `const res = await fetch(${lit(doc.url)}, {\n${init.join(',\n')}\n})\nconsole.log(res.status, await res.text())`
}

function genAxios(doc: RequestDoc, bodyText: string | null): string {
  const lines: string[] = ['import axios from "axios"']
  if (!doc.verifyTls) lines.push('import https from "node:https"')
  lines.push('', 'const res = await axios({', `  method: ${lit(doc.method.toLowerCase())},`, `  url: ${lit(doc.url)},`)
  if (doc.headers.length) lines.push(`  headers: ${jsHeaders(doc.headers, 2)},`)
  if (bodyText) lines.push(`  data: ${lit(bodyText)},`)
  if (!doc.verifyTls) lines.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false }),')
  lines.push('})', 'console.log(res.status, res.data)')
  return lines.join('\n')
}

/** requests / httpx 的公共形状：字段式正文落成 dict，文本正文落成字符串 */
function pyBodyLiteral(doc: RequestDoc, body: { text: string | null; contentType: string | null }): string | null {
  if (doc.body.kind === 'fields' && !doc.body.multipart) {
    return `{${doc.body.fields.map(([k, v]) => `${lit(k)}: ${lit(v)}`).join(', ')}}`
  }
  return body.text === null ? null : lit(body.text)
}

function genPython(doc: RequestDoc, body: { text: string | null; contentType: string | null }): string {
  const data = pyBodyLiteral(doc, body)
  const lines = ['import requests', '', `url = ${lit(doc.url)}`]
  if (doc.headers.length) lines.push('headers = {', ...headerLines(doc.headers, '    ', lit, true), '}')
  if (data) lines.push(`data = ${data}`)
  const args = ['url']
  if (doc.headers.length) args.push('headers=headers')
  if (data) args.push('data=data')
  if (doc.proxy) args.push(`proxies={${lit('http')}: ${lit(doc.proxy)}, ${lit('https')}: ${lit(doc.proxy)}}`)
  if (!doc.verifyTls) args.push('verify=False')
  const verb = doc.method.toLowerCase()
  lines.push(PY_VERBS.has(verb)
    ? `r = requests.${verb}(${args.join(', ')})`
    : `r = requests.request(${lit(doc.method)}, ${args.join(', ')})`)
  lines.push('print(r.status_code, r.text)')
  return lines.join('\n')
}

function genHttpx(doc: RequestDoc, body: { text: string | null; contentType: string | null }): string {
  const data = pyBodyLiteral(doc, body)
  const lines = ['import httpx', '', `url = ${lit(doc.url)}`]
  if (doc.headers.length) lines.push('headers = {', ...headerLines(doc.headers, '    ', lit, true), '}')
  if (data) lines.push(`data = ${data}`)
  const args = ['url']
  if (doc.headers.length) args.push('headers=headers')
  if (data) args.push('content=data')
  if (doc.proxy) args.push(`proxy=${lit(doc.proxy)}`)
  if (!doc.verifyTls) args.push('verify=False')
  const verb = doc.method.toLowerCase()
  lines.push(PY_VERBS.has(verb)
    ? `r = httpx.${verb}(${args.join(', ')})`
    : `r = httpx.request(${lit(doc.method)}, ${args.join(', ')})`)
  lines.push('print(r.status_code, r.text)')
  return lines.join('\n')
}

function genGo(doc: RequestDoc, bodyText: string | null): string {
  const imports = ['"crypto/tls"', '"fmt"', '"io"', '"net/http"', '"net/url"', '"strings"'].filter((p) =>
    p === '"crypto/tls"' ? !doc.verifyTls
      : p === '"net/url"' ? !!doc.proxy
        : p === '"strings"' ? !!bodyText
          : true)

  const lines: string[] = ['package main', '', 'import (']
  for (const imp of imports) lines.push(`\t${imp}`)
  lines.push(')', '', 'func main() {')
  if (bodyText) lines.push(`\tpayload := strings.NewReader(${lit(bodyText)})`)
  lines.push(`\treq, err := http.NewRequest(${lit(doc.method)}, ${lit(doc.url)}, ${bodyText ? 'payload' : 'nil'})`)
  lines.push('\tif err != nil {', '\t\tpanic(err)', '\t}')
  for (const [k, v] of doc.headers) lines.push(`\treq.Header.Add(${lit(k)}, ${lit(v)})`)
  if (!doc.verifyTls || doc.proxy) {
    lines.push('\ttransport := &http.Transport{}')
    if (!doc.verifyTls) lines.push('\ttransport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}')
    if (doc.proxy) {
      lines.push(`\tif proxyURL, err := url.Parse(${lit(doc.proxy)}); err == nil {`)
      lines.push('\t\ttransport.Proxy = http.ProxyURL(proxyURL)')
      lines.push('\t}')
    }
    lines.push('\tclient := &http.Client{Transport: transport}')
  } else {
    lines.push('\tclient := &http.Client{}')
  }
  lines.push('\tres, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}')
  lines.push('\tdefer res.Body.Close()', '\tb, _ := io.ReadAll(res.Body)', '\tfmt.Println(res.Status, string(b))', '}')
  return lines.join('\n')
}

function genJava(doc: RequestDoc, body: { text: string | null; contentType: string | null }): string {
  const lines = [
    'import okhttp3.*;',
    '',
    'public class Main {',
    '  public static void main(String[] args) throws Exception {',
    '    OkHttpClient client = new OkHttpClient();',
  ]
  if (body.text) {
    const mediaType = body.contentType ? `MediaType.parse(${lit(body.contentType)})` : 'null'
    lines.push(`    RequestBody body = RequestBody.create(${lit(body.text)}, ${mediaType});`)
  } else if (BODY_REQUIRED_METHODS.has(doc.method)) {
    // OkHttp 对 POST/PUT/PATCH 要求 body 非 null，否则直接抛 IllegalArgumentException
    lines.push('    RequestBody body = RequestBody.create("", null);')
  } else {
    lines.push('    RequestBody body = null;')
  }
  lines.push('    Request request = new Request.Builder()', `        .url(${lit(doc.url)})`, `        .method(${lit(doc.method)}, body)`)
  for (const [k, v] of doc.headers) lines.push(`        .addHeader(${lit(k)}, ${lit(v)})`)
  lines.push('        .build();')
  lines.push('    try (Response response = client.newCall(request).execute()) {', '      System.out.println(response.code());', '      System.out.println(response.body().string());', '    }', '  }', '}')
  return lines.join('\n')
}

function genPhp(doc: RequestDoc, bodyText: string | null): string {
  const lines = ['<?php', '$ch = curl_init();', `curl_setopt($ch, CURLOPT_URL, ${phpLit(doc.url)});`]
  lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ${phpLit(doc.method)});`)
  lines.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);')
  if (doc.followRedirects) lines.push('curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);')
  if (doc.proxy) lines.push(`curl_setopt($ch, CURLOPT_PROXY, ${phpLit(doc.proxy)});`)
  if (!doc.verifyTls) {
    lines.push('curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);')
    lines.push('curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);')
  }
  if (doc.headers.length) {
    lines.push('curl_setopt($ch, CURLOPT_HTTPHEADER, [')
    for (const [k, v] of doc.headers) lines.push(`    ${phpLit(`${k}: ${v}`)},`)
    lines.push(']);')
  }
  if (bodyText) lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${phpLit(bodyText)});`)
  lines.push('$response = curl_exec($ch);', 'echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . "\\n";', 'echo $response;', 'curl_close($ch);')
  return lines.join('\n')
}

/** 兼容旧的 buildCurl 调用点（抓包页在用） */
export interface CurlInput {
  method: string
  url: string
  headers: [string, string][]
  bodyText?: string | null
  followRedirects?: boolean
  verifyTls?: boolean
  proxy?: string | null
}

export function buildCurl(o: CurlInput): string {
  return generateCode('curl', {
    method: o.method,
    url: o.url,
    headers: o.headers,
    body: o.bodyText ? { kind: 'text', text: o.bodyText } : { kind: 'none' },
    followRedirects: !!o.followRedirects,
    verifyTls: o.verifyTls !== false,
    proxy: o.proxy ?? null,
  })
}

/* ================= 请求文件读写 ================= */

export const REQUEST_FILE_KIND = 'devtoolbox.http-requests'
export const REQUEST_FILE_VERSION = 1

export interface RequestEntry {
  name: string
  doc: RequestDoc
}

export interface RequestFile {
  kind: string
  version: number
  exportedAt: string
  requests: RequestEntry[]
}

export type ImportErrorCode = 'BAD_JSON' | 'BAD_SHAPE' | 'BAD_VERSION'

export interface ImportResult {
  ok: boolean
  errorCode?: ImportErrorCode
  /** 版本不符时回传文件里写的版本，便于界面说清是哪个版本 */
  version?: number
  requests: RequestEntry[]
}

function normalizeHeaders(input: unknown): [string, string][] | null {
  if (input === undefined || input === null) return []
  if (Array.isArray(input)) {
    const out: [string, string][] = []
    for (const item of input) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') out.push([item[0], item[1]])
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        if (typeof o.name === 'string' && typeof o.value === 'string') out.push([o.name, o.value])
        else return null
      } else return null
    }
    return out
  }
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, v as string])
  }
  return null
}

function normalizeBody(input: unknown): RequestBody | null {
  if (input === undefined || input === null) return { kind: 'none' }
  if (typeof input === 'string') return { kind: 'text', text: input }
  if (typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  if (o.kind === 'none') return { kind: 'none' }
  if (o.kind === 'text') return typeof o.text === 'string' ? { kind: 'text', text: o.text } : null
  if (o.kind === 'fields') {
    const fields = normalizeHeaders(o.fields)
    if (!fields) return null
    return { kind: 'fields', fields, multipart: o.multipart === true }
  }
  return null
}

/** 宽松归一：只认形状不认来源，顺手挡掉手写文件里的半截数据 */
export function normalizeDoc(input: unknown): RequestDoc | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  if (typeof o.method !== 'string' || typeof o.url !== 'string') return null
  const headers = normalizeHeaders(o.headers)
  if (!headers) return null
  const body = normalizeBody(o.body)
  if (!body) return null
  return {
    method: o.method.trim().toUpperCase() || 'GET',
    url: o.url,
    headers,
    body,
    followRedirects: o.followRedirects === true,
    verifyTls: o.verifyTls !== false,
    proxy: typeof o.proxy === 'string' && o.proxy ? o.proxy : null,
  }
}

function defaultEntryName(doc: RequestDoc): string {
  return `${doc.method} ${doc.url}`.slice(0, 60)
}

function normalizeEntry(item: unknown): RequestEntry | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const source = 'doc' in o ? o.doc : o
  const doc = normalizeDoc(source)
  if (!doc) return null
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : defaultEntryName(doc)
  return { name, doc }
}

export function buildRequestFile(requests: RequestEntry[]): string {
  const file: RequestFile = {
    kind: REQUEST_FILE_KIND,
    version: REQUEST_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    requests: requests.map((r) => ({ name: r.name, doc: normalizeDoc(r.doc) ?? emptyDoc() })),
  }
  return JSON.stringify(file, null, 2)
}

export function parseRequestFile(text: string): ImportResult {
  const empty: RequestEntry[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errorCode: 'BAD_JSON', requests: empty }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, errorCode: 'BAD_SHAPE', requests: empty }

  const o = parsed as Record<string, unknown>
  const version = typeof o.version === 'number' ? o.version : undefined
  const list = Array.isArray(o.requests)
    ? o.requests
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : typeof o.method === 'string'
        ? [parsed]
        : null
  if (!list) return { ok: false, errorCode: 'BAD_SHAPE', version, requests: empty }
  if (o.kind !== undefined && o.kind !== REQUEST_FILE_KIND) return { ok: false, errorCode: 'BAD_SHAPE', version, requests: empty }
  if (version !== undefined && version !== REQUEST_FILE_VERSION) return { ok: false, errorCode: 'BAD_VERSION', version, requests: empty }

  const requests: RequestEntry[] = []
  for (const item of list) {
    const entry = normalizeEntry(item)
    if (!entry) return { ok: false, errorCode: 'BAD_SHAPE', version, requests: empty }
    requests.push(entry)
  }
  return { ok: true, requests }
}

/** 导入时按「名称 + 方法 + URL」去重，不静默覆盖已有收藏 */
export function mergeRequests(existing: RequestEntry[], incoming: RequestEntry[]): { merged: RequestEntry[]; added: number; skipped: number } {
  const key = (e: RequestEntry): string => `${e.name}\u0000${e.doc.method}\u0000${e.doc.url}`
  const seen = new Set(existing.map(key))
  const fresh: RequestEntry[] = []
  let skipped = 0
  for (const e of incoming) {
    const k = key(e)
    if (seen.has(k)) { skipped++; continue }
    seen.add(k)
    fresh.push(e)
  }
  return { merged: [...fresh, ...existing], added: fresh.length, skipped }
}

/* ================= 小工具 ================= */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 不依赖 atob/btoa 的实现（Node 下可直接断言，且不会因非 ASCII 抛错） */
export function utf8ToBase64(input: string): string {
  if (!input) return ''
  const bytes = new TextEncoder().encode(input)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 63]
  }
  return out
}
