/**
 * HTTP 请求「导入 / 导出 / curl 解析 / 多语言代码生成」的断言。
 *
 * 为什么单独写脚本：解析器和代码生成器都是「看起来对、贴进去才发现错」的重灾区
 * ——引号吃错一个、续行没归一化、body 没转义，界面照样渲染，只有在用户真正粘贴
 * 一条 curl 时才炸。这里用真实样例把行为逐条钉住。
 *
 * 运行：npm run smoke:httpcodec
 */
import {
  CODE_TARGETS,
  MULTIPART_BOUNDARY,
  tokenizeCommand,
  buildRequestFile,
  effectiveHeaders,
  generateCode,
  materializeBody,
  mergeRequests,
  parseCurlCommand,
  parseRequestFile,
  utf8ToBase64,
  type RequestDoc,
} from '../src/lib/http-codegen'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}
function includes(name: string, hay: string, needle: string): void {
  ok(name, hay.includes(needle), `输出里没有 ${JSON.stringify(needle)}\n--- 实际 ---\n${hay}`)
}
function notIncludes(name: string, hay: string, needle: string): void {
  ok(name, !hay.includes(needle), `输出里不该有 ${JSON.stringify(needle)}\n--- 实际 ---\n${hay}`)
}
function headersOf(doc: RequestDoc | undefined): string {
  return (doc?.headers ?? []).map(([k, v]) => `${k}:${v}`).join('|')
}
function hv(headers: [string, string][], name: string): string | null {
  const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
  return hit ? hit[1] : null
}
function warnCodes(w: { code: string }[]): string {
  return w.map((x) => x.code).sort().join(',')
}

/* ================= 样例 ================= */

/** Chrome DevTools「Copy as cURL」，最常见的粘贴来源：没有 -X，靠正文推断 POST */
const DEVTOOLS = `curl 'https://api.example.com/v1/users?limit=10' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  --data-raw '{"name":"张三","tags":["a","b"]}'`

const POWERSHELL = 'curl.exe -X PUT "https://api.example.com/v1/users/1" `\n' +
  '  -H "Content-Type: application/json" `\n' +
  '  -d "{\\"name\\":\\"it is ok\\"}"'

const RICH: RequestDoc = {
  method: 'POST',
  url: 'https://api.example.com/v1/users?limit=10',
  headers: [
    ['Content-Type', 'application/json'],
    ['Authorization', 'Bearer t0ken'],
    ['X-Note', `it's "quoted"\\path`],
  ],
  body: { kind: 'text', text: '{"name":"张三","note":"a\\nb"}' },
  followRedirects: true,
  verifyTls: false,
  proxy: 'http://127.0.0.1:8899',
}

/* ================= 1. 分词与 curl 解析 ================= */

{
  const r = parseCurlCommand(DEVTOOLS)
  ok('devtools: 解析成功', r.ok, JSON.stringify(r))
  eq('devtools: 方法推断为 POST', r.request?.method, 'POST')
  eq('devtools: URL 保留查询串', r.request?.url, 'https://api.example.com/v1/users?limit=10')
  eq('devtools: 两个请求头', r.request?.headers.length, 2)
  eq('devtools: 请求头内容', headersOf(r.request), 'accept:application/json|content-type:application/json')
  eq('devtools: 正文原样保留', r.request?.body.kind === 'text' ? r.request.body.text : null, '{"name":"张三","tags":["a","b"]}')
  eq('devtools: 提示按正文推断方法', warnCodes(r.warnings), 'METHOD_INFERRED')
}

{
  const r = parseCurlCommand(POWERSHELL)
  ok('powershell: 解析成功', r.ok, JSON.stringify(r))
  eq('powershell: curl.exe 别名可用', r.request?.method, 'PUT')
  eq('powershell: 反引号续行被归一化', r.request?.url, 'https://api.example.com/v1/users/1')
  eq('powershell: 双引号内 \\" 解转义', r.request?.body.kind === 'text' ? r.request.body.text : null, '{"name":"it is ok"}')
}

{
  const r = parseCurlCommand(`curl -u user:pass https://api.example.com/me`)
  eq('basic: 生成 Authorization', headersOf(r.request), 'Authorization:Basic dXNlcjpwYXNz')
  eq('basic: 无正文不误判方法', r.request?.method, 'GET')
  eq('basic: 无警告', r.warnings.length, 0)
}

{
  const r = parseCurlCommand(`curl -k -L --proxy http://127.0.0.1:8899 -A 'MyAgent/1.0' -e 'https://ref.example.com/' -b 'a=1; b=2' https://api.example.com/x`)
  eq('开关: -k 关校验', r.request?.verifyTls, false)
  eq('开关: -L 跟随重定向', r.request?.followRedirects, true)
  eq('开关: --proxy 记录代理', r.request?.proxy, 'http://127.0.0.1:8899')
  eq('简写: -A/-e/-b 都进请求头', headersOf(r.request), 'User-Agent:MyAgent/1.0|Referer:https://ref.example.com/|Cookie:a=1; b=2')
}

{
  const r = parseCurlCommand(`curl -d 'a=1' -d 'b=2' https://api.example.com/submit`)
  eq('多处 -d 用 & 连接', r.request?.body.kind === 'text' ? r.request.body.text : null, 'a=1&b=2')
  eq('多处 -d 推断 POST', r.request?.method, 'POST')
}

{
  const r = parseCurlCommand(`curl --data-urlencode 'q=hello world&x=1' https://api.example.com/search`)
  eq('--data-urlencode 做百分号编码', r.request?.body.kind === 'text' ? r.request.body.text : null, 'q=hello%20world%26x%3D1')
  eq('--data-urlencode 有提示', warnCodes(r.warnings), 'DATA_URLENCODE,METHOD_INFERRED')
}

{
  const r = parseCurlCommand(`curl -G -d 'q=a b' -d 'page=2' https://api.example.com/search`)
  eq('-G: 方法回落 GET', r.request?.method, 'GET')
  eq('-G: 数据进查询串', r.request?.url, 'https://api.example.com/search?q=a%20b&page=2')
  eq('-G: 不再携带正文', r.request?.body.kind, 'none')
}

{
  const r = parseCurlCommand(`curl -X HEAD --url https://api.example.com/x`)
  eq('--url 形态也被识别', r.request?.url, 'https://api.example.com/x')
  eq('--url 形态方法正确', r.request?.method, 'HEAD')
}

{
  const r = parseCurlCommand(`curl -s --max-time 10 --compressed https://api.example.com/a https://api.example.com/b`)
  eq('已知携带值开关不吞掉 URL', r.request?.url, 'https://api.example.com/a')
  eq('多余 URL 只给提示', warnCodes(r.warnings), 'MULTI_URL')
}

{
  const r = parseCurlCommand(`curl -s --nonsense-flag https://api.example.com/a`)
  eq('未知开关记进 warnings 而非抛错', warnCodes(r.warnings), 'UNKNOWN_FLAG')
  eq('未知开关不影响 URL', r.request?.url, 'https://api.example.com/a')
  eq('未知开关的 detail 是开关本身', r.warnings[0]?.detail, '--nonsense-flag')
}

{
  const r = parseCurlCommand(`curl -F 'file=@/tmp/a.png' -F 'name=demo' https://api.example.com/upload`)
  eq('-F: 解析为字段', r.request?.body.kind, 'fields')
  const fields = r.request?.body.kind === 'fields' ? r.request.body.fields : []
  eq('-F: 两个字段', fields.length, 2)
  eq('-F: 标记 multipart', r.request?.body.kind === 'fields' ? r.request.body.multipart : false, true)
  eq('-F: @文件只提示不臆造内容', warnCodes(r.warnings), 'FILE_BODY,METHOD_INFERRED')
}

{
  const r = parseCurlCommand(`curl -H 'X-Empty;' -H 'NoColonHeader' https://api.example.com/a`)
  eq('无冒号请求头给提示', warnCodes(r.warnings), 'HEADER_NO_COLON')
  eq('空值请求头保留', headersOf(r.request), 'X-Empty:|NoColonHeader:')
}

{
  const r = parseCurlCommand('')
  eq('空输入: 报 EMPTY_INPUT', r.errorCode, 'EMPTY_INPUT')
  eq('空输入: ok=false', r.ok, false)
}
{
  const r = parseCurlCommand(`curl -X POST -H 'a: b'`)
  eq('无 URL: 报 NO_URL', r.errorCode, 'NO_URL')
}
{
  const r = parseCurlCommand(`Invoke-WebRequest -Uri https://api.example.com/a -Method Post`)
  eq('PowerShell 原生 cmdlet 明确不支持', r.errorCode, 'UNSUPPORTED')
}
{
  const r = parseCurlCommand(`   \n  `)
  eq('纯空白: 报 EMPTY_INPUT', r.errorCode, 'EMPTY_INPUT')
}

/* ================= 1b. 分词器的边界输入 ================= */

{
  eq('分词: 未闭合引号按字面量收尾', tokenizeCommand(`curl 'https://a.example.com/x`).join('|'), 'curl|https://a.example.com/x')
  eq('分词: bash 拼接写法还原单引号', tokenizeCommand(`-H 'it'\\''s'`).join('|'), "-H|it's")
  eq('分词: 连续空白不产生空 token', tokenizeCommand(`curl   -H\t'a: b'   https://x`).join('|'), 'curl|-H|a: b|https://x')
  eq('分词: 空输入得到空数组', tokenizeCommand('   ').length, 0)

  // 未闭合引号不该让整条命令失效：URL 仍能解析出来，后续内容退化成字面量
  const r = parseCurlCommand(`curl 'https://a.example.com/x -H 'a: b'`)
  ok('未闭合引号: 仍能给出结果', r.ok === true || r.errorCode === 'NO_URL', JSON.stringify(r))
}

/* ================= 2. 八种语言的代码生成 ================= */

{
  eq('目标语言数量为 8', CODE_TARGETS.length, 8)
  const snippets = CODE_TARGETS.map((t) => [t, generateCode(t, RICH)] as const)
  for (const [t, code] of snippets) {
    ok(`${t}: 非空`, code.trim().length > 0)
    includes(`${t}: 带上 URL`, code, 'https://api.example.com/v1/users?limit=10')
    includes(`${t}: 带上正文`, code, '张三')
    includes(`${t}: 带上自定义头`, code, 'X-Note')
    ok(`${t}: 输出不含中文说明`, !/[\u4e00-\u9fff]/.test(code.replace(/张三/g, '')), code)
  }

  const cur = generateCode('curl', RICH)
  includes('curl: 命令名', cur, 'curl \\')
  includes('curl: 方法', cur, '-X POST')
  includes('curl: -L', cur, '-L')
  includes('curl: -k', cur, '-k')
  includes('curl: --proxy', cur, "--proxy 'http://127.0.0.1:8899'")
  includes('curl: 单引号按 shell 语义转义', cur, "'X-Note: it'\\''s \"quoted\"\\path'")
  includes('curl: --data-raw', cur, '--data-raw')

  const fe = generateCode('fetch', RICH)
  includes('fetch: 调用', fe, 'await fetch(')
  includes('fetch: method', fe, 'method: "POST"')
  includes('fetch: 正文转义换行', fe, '\\n')

  const ax = generateCode('axios', RICH)
  includes('axios: 引入', ax, 'axios')
  includes('axios: 小写方法', ax, 'method: "post"')
  includes('axios: data 字段', ax, 'data:')

  const py = generateCode('python', RICH)
  includes('python: 引入 requests', py, 'import requests')
  includes('python: requests.post', py, 'requests.post(')
  includes('python: verify=False', py, 'verify=False')

  const httpx = generateCode('httpx', RICH)
  includes('httpx: 引入 httpx', httpx, 'import httpx')
  includes('httpx: httpx.post', httpx, 'httpx.post(')

  const go = generateCode('go', RICH)
  includes('go: 包名', go, 'package main')
  includes('go: net/http', go, 'net/http')
  includes('go: NewRequest', go, 'http.NewRequest("POST"')
  includes('go: InsecureSkipVerify', go, 'InsecureSkipVerify: true')
  includes('go: proxy 生效', go, 'http.ProxyURL')

  const java = generateCode('java', RICH)
  includes('java: OkHttpClient', java, 'OkHttpClient')
  includes('java: method()', java, '.method("POST", body)')
  includes('java: 媒体类型', java, 'MediaType.parse("application/json")')
  includes('java: 转义引号', java, '\\"name\\"')

  const php = generateCode('php', RICH)
  includes('php: curl_init', php, 'curl_init()')
  includes('php: CURLOPT_HTTPHEADER', php, 'CURLOPT_HTTPHEADER')
  includes('php: 单引号转义', php, `it\\'s`)
}

{
  /* GET 无正文时，各语言都不该凭空造出 body */
  const g: RequestDoc = { method: 'GET', url: 'https://api.example.com/x', headers: [], body: { kind: 'none' }, followRedirects: false, verifyTls: true, proxy: null }
  notIncludes('get/fetch: 无 body 字段', generateCode('fetch', g), 'body:')
  notIncludes('get/curl: 无 --data-raw', generateCode('curl', g), '--data-raw')
  notIncludes('get/curl: 无 -k', generateCode('curl', g), '-k')
  includes('get/fetch: 保留 method', generateCode('fetch', g), 'method: "GET"')
}

{
  /* 字段式正文（表单）在各语言里都应落成结构化键值，而不是把 JSON 原文塞进去 */
  const f: RequestDoc = {
    method: 'POST',
    url: 'https://api.example.com/login',
    headers: [['Content-Type', 'application/x-www-form-urlencoded']],
    body: { kind: 'fields', fields: [['user', 'a b'], ['pwd', "p'1"]], multipart: false },
    followRedirects: false,
    verifyTls: true,
    proxy: null,
  }
  includes('form/python: 落成 dict', generateCode('python', f), '"user": "a b"')
  includes('form/php: 正文做百分号编码', generateCode('php', f), 'a%20b')
  includes('form/curl: 正文做百分号编码', generateCode('curl', f), 'user=a%20b')

  const m = materializeBody({ ...f, body: { kind: 'fields', fields: [['n', 'v']], multipart: true } })
  includes('multipart: 带 boundary 头', m.contentType ?? '', 'multipart/form-data; boundary=----DevToolboxBoundary')
  includes('multipart: 正文含分隔符', m.text ?? '', '----DevToolboxBoundary')
  includes('multipart: 正文含字段名', m.text ?? '', 'name="n"')
}

{
  const none = materializeBody({ method: 'GET', url: 'https://a', headers: [], body: { kind: 'none' }, followRedirects: false, verifyTls: true, proxy: null })
  eq('materialize: 无正文返回 null', none.text, null)
  eq('materialize: 无正文不带类型', none.contentType, null)
}

/* ================= 2b. 生成的请求头与正文必须对得上 ================= */

{
  /* 具体的坑：文档头里留着上一轮的 boundary，生成的代码就会出现两个 boundary */
  const m: RequestDoc = {
    method: 'POST',
    url: 'https://api.example.com/upload',
    headers: [['Content-Type', 'multipart/form-data; boundary=stale']],
    body: { kind: 'fields', fields: [['n', 'v']], multipart: true },
    followRedirects: false,
    verifyTls: true,
    proxy: null,
  }
  const h = effectiveHeaders(m)
  eq('生成头: 旧 boundary 被替换', hv(h, 'content-type'), `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`)
  eq('生成头: 不新增重复 Content-Type', h.filter(([k]) => k.toLowerCase() === 'content-type').length, 1)
  const php = generateCode('php', m)
  includes('php: 头里是新 boundary', php, `boundary=${MULTIPART_BOUNDARY}`)
  includes('php: 正文用的是同一个 boundary', php, `--${MULTIPART_BOUNDARY}`)
  notIncludes('php: 不残留旧 boundary', php, 'stale')

  /* curl -F 解析出来的文档没有 Content-Type，生成时必须补上带 boundary 的那条 */
  const fromCurl = parseCurlCommand(`curl -F 'a=b' https://api.example.com/u`).request
  eq('curl -F: 自动补 multipart 头', hv(effectiveHeaders(fromCurl!), 'content-type'), `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`)

  /* 纯文本正文且没声明类型时，不该凭空造一个 Content-Type */
  const bare: RequestDoc = { method: 'POST', url: 'https://api.example.com/x', headers: [], body: { kind: 'text', text: 'hi' }, followRedirects: false, verifyTls: true, proxy: null }
  eq('无声明类型: 不凭空补头', effectiveHeaders(bare).length, 0)
}

/* ================= 2c. 生成代码的边缘情况 ================= */

{
  const base: RequestDoc = { method: 'GET', url: 'https://api.example.com/x', headers: [], body: { kind: 'none' }, followRedirects: false, verifyTls: true, proxy: null }

  /* 重复请求头不能被悄悄合并掉（curl 允许重名，Go 的 Set 会盖掉前一个） */
  const dup: RequestDoc = { ...base, headers: [['Accept', 'a'], ['Accept', 'b']] }
  eq('go: 重复头用 Add 保留两份', (generateCode('go', dup).match(/req\.Header\.Add\("Accept"/g) ?? []).length, 2)
  const feDup = generateCode('fetch', dup)
  ok('fetch: 重复头退化成数组字面量', feDup.includes('"a"') && feDup.includes('"b"') && !feDup.includes('"Accept": '))

  /* OkHttp 对 POST 族要求 body 非 null，否则运行期直接抛 */
  const postEmpty: RequestDoc = { ...base, method: 'POST' }
  includes('java: POST 空正文给空体', generateCode('java', postEmpty), 'RequestBody.create("", null)')
  includes('java: GET 允许 null 体', generateCode('java', base), 'RequestBody body = null;')

  /* 非标准方法在 requests / httpx 里没有同名简写 */
  const purge: RequestDoc = { ...base, method: 'PURGE' }
  includes('python: 非标准方法走 request()', generateCode('python', purge), 'requests.request("PURGE"')
  includes('httpx: 非标准方法走 request()', generateCode('httpx', purge), 'httpx.request("PURGE"')
  includes('python: 标准方法仍用简写', generateCode('python', postEmpty), 'requests.post(')
}

/* ================= 3. 导出 / 导入往返 ================= */

{
  const entries = [{ name: '用户列表', doc: RICH }, { name: '健康检查', doc: { method: 'GET', url: 'https://api.example.com/health', headers: [], body: { kind: 'none' }, followRedirects: true, verifyTls: true, proxy: null } }]
  const text = buildRequestFile(entries)
  const back = parseRequestFile(text)
  ok('往返: 解析成功', back.ok, JSON.stringify(back).slice(0, 200))
  eq('往返: 条数一致', back.requests.length, 2)
  eq('往返: 名称保留', back.requests[0]?.name, '用户列表')
  eq('往返: 方法与 URL 保留', `${back.requests[0]?.doc.method} ${back.requests[0]?.doc.url}`, `${RICH.method} ${RICH.url}`)
  eq('往返: 请求头保留', headersOf(back.requests[0]?.doc), headersOf(RICH))
  eq('往返: 正文保留', JSON.stringify(back.requests[0]?.doc.body), JSON.stringify(RICH.body))
  eq('往返: 开关保留', `${back.requests[0]?.doc.followRedirects}/${back.requests[0]?.doc.verifyTls}/${back.requests[0]?.doc.proxy}`, 'true/false/http://127.0.0.1:8899')
  eq('往返: 幂等（再导出再导入条目一致）', JSON.stringify(parseRequestFile(buildRequestFile(back.requests)).requests), JSON.stringify(back.requests))
  includes('导出: 带 kind 标记', text, 'devtoolbox.http-requests')
}

{
  eq('导入: 坏 JSON 报 BAD_JSON', parseRequestFile('{oops').errorCode, 'BAD_JSON')
  eq('导入: 形状不对报 BAD_SHAPE', parseRequestFile('{"kind":"devtoolbox.http-requests"}').errorCode, 'BAD_SHAPE')
  eq('导入: 版本不符报 BAD_VERSION', parseRequestFile(JSON.stringify({ kind: 'devtoolbox.http-requests', version: 99, requests: [] })).errorCode, 'BAD_VERSION')
  eq('导入: 版本不相符时回传版本号', parseRequestFile(JSON.stringify({ kind: 'devtoolbox.http-requests', version: 99, requests: [] })).version, 99)
  eq('导入: 空数组合法', parseRequestFile(JSON.stringify({ kind: 'devtoolbox.http-requests', version: 1, requests: [] })).ok, true)
  const bad = parseRequestFile(JSON.stringify({ kind: 'devtoolbox.http-requests', version: 1, requests: [{ name: 'x' }] }))
  eq('导入: 条目缺 doc 报 BAD_SHAPE', bad.errorCode, 'BAD_SHAPE')
  ok('导入: 失败时不返回任何条目（不静默清空）', bad.requests.length === 0)
}

{
  const base = [{ name: 'A', doc: { ...RICH, url: 'https://a/1' } }]
  const incoming = [
    { name: 'A', doc: { ...RICH, url: 'https://a/1' } },
    { name: 'B', doc: { ...RICH, url: 'https://a/2' } },
  ]
  const res = mergeRequests(base, incoming)
  eq('合并: 只新增未重复的一条', res.added, 1)
  eq('合并: 按 method+url+name 去重', res.skipped, 1)
  eq('合并: 结果长度', res.merged.length, 2)
  eq('合并: 新条目在前', res.merged[0]?.name, 'B')
  eq('合并: 空集合不报错', mergeRequests([], []).merged.length, 0)
}

/* ================= 4. 与「是否发过请求」无关 ================= */

{
  /* 只要有一个 RequestDoc 就能出全部 8 种代码 —— 页面不发请求也该看得到 */
  const doc: RequestDoc = { method: 'DELETE', url: 'https://api.example.com/v1/users/1', headers: [], body: { kind: 'none' }, followRedirects: false, verifyTls: true, proxy: null }
  for (const t of CODE_TARGETS) {
    includes(`未发请求也能生成 ${t}`, generateCode(t, doc), 'https://api.example.com/v1/users/1')
  }
}

/* ================= 5. 工具函数 ================= */

{
  eq('base64: ASCII', utf8ToBase64('user:pass'), 'dXNlcjpwYXNz')
  eq('base64: 中文（UTF-8）', utf8ToBase64('中'), '5Lit')
  eq('base64: 空串', utf8ToBase64(''), '')
  eq('base64: 补齐两位', utf8ToBase64('a'), 'YQ==')
  eq('base64: 补齐一位', utf8ToBase64('ab'), 'YWI=')
}

/* ================= 汇总 ================= */

console.log(`\nHTTP 请求导入导出 / 代码生成：${passed} 项通过`)
if (failures.length) {
  console.error(`\n${failures.length} 项失败：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('✔ 全部断言通过')
