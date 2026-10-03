/**
 * HAR 解析冒烟。
 *
 * HAR（HTTP Archive）是抓包工具的通用导出格式，字段定义见 http://www.softwareishard.com/blog/har-12-spec/
 * 实测各家导出的差异比规范大得多：
 *   - Chrome 会加 `_` 前缀的私有字段（`_priority`、`_resourceType`）
 *   - Firefox 的 `comment` 位置不同，有的版本 `log.version` 缺失
 *   - 导出的 body 可能已被解码、也可能还是 base64
 *   - 分页/懒加载场景下 `pages` 数组可能为空但 entries 有几十条
 * 所以这里的重点全在**容错**，正常路径反而简单。
 */
import {
  parseHar,
  buildWaterfall,
  summarizeByHost,
  formatBytes,
  type HarEntry,
  type HarSummary,
} from '../src/lib/toolkit/har'

let pass = 0
const fails: string[] = []
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  fails.push(label)
  console.error(`  ✗ ${label}`)
}
function eq<T>(got: T, want: T, label: string): void {
  ok(got === want, `${label}（期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}）`)
}
function throws(code: string, fn: () => unknown, label: string): void {
  try {
    fn()
    fails.push(label)
    console.error(`  ✗ ${label}（应当抛 ${code}，实际没抛）`)
  } catch (e) {
    eq((e as Error).message, code, label)
  }
}

/* ================= 造一份 Chrome 风格的 HAR ================= */

const CHROME_HAR = {
  log: {
    version: '1.2',
    creator: { name: 'Chrome DevTools', version: '120' },
    pages: [
      { id: 'page_1', title: 'https://example.com/', startedDateTime: '2026-03-01T10:00:00.000Z', pageTimings: { onContentLoad: 800, onLoad: 1500 } },
    ],
    entries: [
      {
        startedDateTime: '2026-03-01T10:00:00.000Z',
        time: 120,
        _priority: 'VeryHigh',
        _resourceType: 'document',
        request: {
          method: 'GET',
          url: 'https://example.com/index.html',
          httpVersion: 'HTTP/2',
          headers: [
            { name: 'Host', value: 'example.com' },
            { name: 'User-Agent', value: 'Mozilla/5.0' },
          ],
          queryString: [{ name: 'debug', value: '1' }],
          cookies: [],
          headersSize: 220,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/2',
          headers: [
            { name: 'content-type', value: 'text/html' },
            { name: 'content-encoding', value: 'gzip' },
          ],
          cookies: [],
          content: { size: 2048, mimeType: 'text/html', text: '<!doctype html><h1>Hi</h1>' },
          redirectURL: '',
          headersSize: 180,
          bodySize: 512,
          _transferSize: 700,
        },
        cache: {},
        timings: { blocked: 1, dns: 10, connect: 20, send: 1, wait: 80, receive: 8, ssl: 15 },
        serverIPAddress: '93.184.216.34',
        connection: '443',
      },
      {
        startedDateTime: '2026-03-01T10:00:00.050Z',
        time: 300,
        _resourceType: 'stylesheet',
        request: {
          method: 'GET',
          url: 'https://cdn.example.com/app.css',
          httpVersion: 'HTTP/2',
          headers: [],
          queryString: [],
          cookies: [],
          headersSize: 100,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/2',
          headers: [{ name: 'content-type', value: 'text/css' }],
          cookies: [],
          content: { size: 15000, mimeType: 'text/css', text: 'body{color:#0f0}' },
          redirectURL: '',
          headersSize: 90,
          bodySize: 4096,
        },
        cache: {},
        timings: { blocked: 0, dns: 5, connect: 8, send: 1, wait: 280, receive: 6, ssl: 8 },
        serverIPAddress: '104.18.32.7',
        connection: '443',
      },
      {
        // 失败请求：status 0、error 字段有值
        startedDateTime: '2026-03-01T10:00:00.100Z',
        time: 50,
        _resourceType: 'xhr',
        request: {
          method: 'POST',
          url: 'https://api.example.com/graphql',
          httpVersion: 'HTTP/1.1',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          queryString: [],
          cookies: [],
          headersSize: 150,
          bodySize: 42,
          postData: { mimeType: 'application/json', text: '{"query":"{ user { id } }"}' },
        },
        response: {
          status: 0,
          statusText: '',
          httpVersion: '',
          headers: [],
          cookies: [],
          content: { size: 0, mimeType: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { blocked: 0, dns: -1, connect: -1, send: 0, wait: 0, receive: 0, ssl: -1 },
        serverIPAddress: '',
        connection: '',
        _error: 'net::ERR_CONNECTION_REFUSED',
      },
      {
        // 302 跳转
        startedDateTime: '2026-03-01T10:00:00.200Z',
        time: 60,
        _resourceType: 'document',
        request: {
          method: 'GET',
          url: 'https://example.com/old',
          httpVersion: 'HTTP/1.1',
          headers: [],
          queryString: [],
          cookies: [],
          headersSize: 100,
          bodySize: 0,
        },
        response: {
          status: 302,
          statusText: 'Found',
          httpVersion: 'HTTP/1.1',
          headers: [{ name: 'location', value: 'https://example.com/new' }],
          cookies: [],
          content: { size: 0, mimeType: 'text/html' },
          redirectURL: 'https://example.com/new',
          headersSize: 120,
          bodySize: 0,
        },
        cache: {},
        timings: { blocked: 0, dns: -1, connect: 5, send: 0, wait: 50, receive: 5, ssl: 3 },
        serverIPAddress: '93.184.216.34',
        connection: '443',
      },
    ],
  },
}

/* ================= 1. 解析 ================= */
{
  const s = parseHar(CHROME_HAR)
  eq(s.version, '1.2', '读到 HAR 版本')
  eq(s.creator, 'Chrome DevTools', '读到 creator')
  eq(s.entries.length, 4, '解析出 4 条 entry')
  eq(s.pageCount, 1, '页数 1')
  ok(s.hasBody, '至少有可读body（有 text 字段）')
}

{
  const s = parseHar(CHROME_HAR)
  const e = s.entries[0]
  eq(e.method, 'GET', '方法 GET')
  eq(e.url, 'https://example.com/index.html', 'URL 正确')
  eq(e.host, 'example.com', '抽出 host')
  eq(e.path, '/index.html', '抽出 path')
  eq(e.status, 200, '状态码 200')
  eq(e.statusText, 'OK', '状态文本')
  eq(e.mimeType, 'text/html', '从 content.mimeType 取 MIME')
  eq(e.resourceType, 'document', '读 Chrome 私有字段 _resourceType')
  eq(e.priority, 'VeryHigh', '读 Chrome 私有字段 _priority')
  eq(e.bodySize, 512, '响应体大小 512')
  eq(e.transferSize, 700, '优先用 _transferSize（含开销的真实传输量）')
  eq(e.serverIP, '93.184.216.34', '服务端 IP')
  eq(e.httpVersion, 'HTTP/2', 'HTTP 版本')
}

{
  const s = parseHar(CHROME_HAR)
  const e = s.entries[0]
  eq(e.headerCount, 2, '请求头 2 个')
  eq(e.respHeaderCount, 2, '响应头 2 个')
  ok(e.body !== null && e.body.includes('<h1>Hi</h1>'), 'body 文本可读')
  eq(e.queryCount, 1, '查询参数 1 个')
  eq(e.postData, '', '没有 postData 时是空串')
  // content-encoding 是 gzip，但 Chrome 已经解压了 text —— 不该再提示 base64
  ok(e.bodyEncoding === 'text', `body 标记为已解码文本（实际 ${e.bodyEncoding}）`)
}

{
  const s = parseHar(CHROME_HAR)
  const post = s.entries[2]
  eq(post.method, 'POST', '第三条是 POST')
  ok(post.postData.includes('user'), 'postData 原文保留')
  eq(post.status, 0, '失败请求 status 0')
  eq(post.error, 'net::ERR_CONNECTION_REFUSED', '读 _error 字段（Chrome 私有）')
}

{
  const s = parseHar(CHROME_HAR)
  const redirect = s.entries[3]
  eq(redirect.status, 302, '第四条 302')
  eq(redirect.redirectURL, 'https://example.com/new', 'redirectURL 正确')
  ok(redirect.isRedirect, 'isRedirect 标记为 true')
  ok(!s.entries[0].isRedirect, '200 不是重定向')
}

{
  // 转义URL（HAR 里url 字段是转义过的）
  const esc = { log: { version: '1.2', entries: [{
    startedDateTime: '2026-03-01T10:00:00.000Z', time: 10,
    request: { method: 'GET', url: 'https://example.com/a%20b?q=%E4%B8%AD%E6%96%87', headers: [], queryString: [], cookies: [] },
    response: { status: 200, statusText: 'OK', headers: [], cookies: [], content: { size: 0, mimeType: 'text/html' }, redirectURL: '', headersSize: 0, bodySize: 0 },
    cache: {}, timings: { blocked: 0, dns: 1, connect: 1, send: 0, wait: 5, receive: 3, ssl: 0 },
  }] } }
  const s = parseHar(esc)
  eq(s.entries[0].path, '/a%20b', 'path 保留转义形态（不做二次解码）')
  ok(s.entries[0].url.includes('%E4%B8%AD'), 'url 原样保留')
}

/* --- 容错 --- */
{
  // log 缺失
  throws('BAD_HAR', () => parseHar({}), '缺少 log 时抛 BAD_HAR')
  throws('BAD_HAR', () => parseHar(null), 'null 抛 BAD_HAR')
  throws('BAD_HAR', () => parseHar('nope'), '字符串抛 BAD_HAR')
}

{
  // entries 缺失但 log 在：某些工具导出会这样
  throws('BAD_HAR', () => parseHar({ log: { version: '1.2' } }), 'entries 缺失抛 BAD_HAR')
}

{
  // version 缺失（Firefox 偶尔这样）
  const noVer = { log: { entries: CHROME_HAR.log.entries } }
  const s = parseHar(noVer)
  eq(s.version, '', 'version 缺失时为空串而不是崩')
  eq(s.entries.length, 4, '照样解析出 entries')
}

{
  // pages 缺失
  const noPages = { log: { version: '1.2', entries: CHROME_HAR.log.entries } }
  eq(parseHar(noPages).pageCount, 0, 'pages 缺失时 pageCount=0')
}

{
  // 单条 entry 字段大面积缺失
  const thin = { log: { version: '1.2', entries: [{ request: { url: 'https://x.test/' } }] } }
  const s = parseHar(thin)
  eq(s.entries.length, 1, '极简 entry 也能解析')
  const e = s.entries[0]
  eq(e.method, '', '缺 method 时空串')
  eq(e.status, 0, '缺 status 时 0')
  eq(e.mimeType, '', '缺 mimeType 时空串')
  eq(e.host, 'x.test', 'host仍能抽出')
  eq(e.time, 0, '缺 time 时 0')
}

{
  // JSON 字符串输入（用户粘贴的往往是一整段文本）
  const s = parseHar(JSON.stringify(CHROME_HAR))
  eq(s.entries.length, 4, '接受 JSON 字符串输入')
}

{
  // 非 JSON 字符串
  throws('BAD_HAR', () => parseHar('{not json'), '非法 JSON 抛 BAD_HAR')
}

{
  // headers 为 null 而不是数组
  const nullH = { log: { version: '1.2', entries: [{
    startedDateTime: '2026-03-01T10:00:00.000Z', time: 1,
    request: { method: 'GET', url: 'https://a.test/', headers: null, queryString: null, cookies: null },
    response: { status: 200, statusText: 'OK', headers: null, cookies: null, content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: 0, bodySize: 0 },
    cache: {}, timings: { blocked: 0, dns: -1, connect: -1, send: 0, wait: 1, receive: 0, ssl: -1 },
  }] } }
  const s = parseHar(nullH)
  eq(s.entries[0].headerCount, 0, 'headers 为 null 时计数 0')
  ok(!Number.isNaN(s.entries[0].time), 'timings 全为 -1 时 time 不是 NaN')
}

/* ================= 2. 时序瀑布 ================= */
{
  const s = parseHar(CHROME_HAR)
  const w = buildWaterfall(s.entries)
  eq(w.length, 4, '瀑布有 4 行')
  // 以最早开始时间为 0 点
  const base = w[0].offset
  eq(base, 0, '第一条 offset 为 0')
  ok(w[1].offset >= 0, '后续条目 offset 非负')
  ok(w[3].offset > w[0].offset, '按开始时间排序（第 4 条在第 1 条之后）')
  // 阶段之和应等于总耗时。blocked 也是阶段之一，别漏
  const e0 = w[0]
  const sum = e0.blocked + e0.dns + e0.connect + e0.send + e0.wait + e0.receive
  eq(sum, e0.time, `各阶段之和等于总耗时（${sum} vs ${e0.time}）`)
  // ssl 在 HAR 里是包含在 connect 内的，不能重复计入
  ok(e0.ssl > 0 && e0.ssl <= e0.connect, 'ssl 是 connect 的子集而非并列阶段')
}

{
  // timings 全为 -1（HAR 规范允许，表示未采集）
  const noTiming = { log: { version: '1.2', entries: [{
    startedDateTime: '2026-03-01T10:00:00.000Z', time: 0,
    request: { method: 'GET', url: 'https://a.test/', headers: [], queryString: [], cookies: [] },
    response: { status: 204, statusText: 'No Content', headers: [], cookies: [], content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: 0, bodySize: 0 },
    cache: {}, timings: { blocked: -1, dns: -1, connect: -1, send: -1, wait: -1, receive: -1, ssl: -1 },
  }] } }
  const s = parseHar(noTiming)
  const w = buildWaterfall(s.entries)
  eq(w[0].time, 0, 'timings 全 -1 时 time 退化为 0 而不是负数相加')
  ok(w[0].dns >= 0, '各阶段非负')
}

{
  const s = parseHar(CHROME_HAR)
  // 失败请求也要能进瀑布（它占了时间）
  ok(buildWaterfall(s.entries).some(r => r.status === 0), '失败请求也在瀑布里')
}

/* ================= 3. 按域名汇总 ================= */
{
  const s = parseHar(CHROME_HAR)
  const byHost = summarizeByHost(s.entries)
  eq(byHost.length, 3, '3 个域名')
  const ex = byHost.find(h => h.host === 'example.com')
  ok(!!ex, 'example.com 在汇总里')
  eq(ex!.count, 2, 'example.com 有 2 条')
  ok(ex!.bytes > 0, '字节数非 0')
  const api = byHost.find(h => h.host === 'api.example.com')
  eq(api!.count, 1, 'api.example.com 有 1 条')
  eq(api!.failed, 1, 'api.example.com 有 1 条失败')
  // 按字节数降序
  ok(byHost[0].bytes >= byHost[byHost.length - 1].bytes, '按字节数降序')
}

{
  const s = parseHar(CHROME_HAR)
  const byHost = summarizeByHost(s.entries)
  const total = byHost.reduce((n, h) => n + h.bytes, 0)
  ok(total > 0, '总字节数非 0')
  // 3xx 不算失败（是正常跳转）
  const ex = byHost.find(h => h.host === 'example.com')!
  eq(ex.failed, 0, '302 不算失败')
}

{
  // 空数组
  eq(summarizeByHost([]).length, 0, '空数组汇总为空')
}

/* ================= 4. 字节格式化 ================= */
{
  eq(formatBytes(0), '0 B', '0 字节')
  eq(formatBytes(512), '512 B', '512 字节')
  eq(formatBytes(1024), '1.0 KB', '1024 → 1.0 KB')
  eq(formatBytes(1536), '1.5 KB', '1536 → 1.5 KB')
  eq(formatBytes(1048576), '1.0 MB', '1MB')
  eq(formatBytes(-1), '-', '负数（HAR 的 headersSize 可能是 -1）显示为 -')
}

{
  // 负字节数（HAR 用 -1 表示「未采集」）不能变成 "-1 B" 误导用户
  eq(formatBytes(-1), '-', 'HAR 的 -1 显示为 -')
  eq(formatBytes(-999), '-', '任何负数都显示为 -')
}

/* ================= 5. 类型契约 ================= */
{
  const s: HarSummary = parseHar(CHROME_HAR)
  const e: HarEntry = s.entries[0]
  ok(typeof e.index === 'number', 'index 是数字')
  ok(typeof e.startedMs === 'number', 'startedMs 是数字（已转毫秒时间戳）')
  ok(e.startedMs > 0, 'startedMs 解析成功')
  ok(typeof e.isRedirect === 'boolean', 'isRedirect 是布尔')
  ok(typeof e.isFailed === 'boolean', 'isFailed 是布尔')
  eq(e.isFailed, false, '200 不是失败')
  eq(s.entries[2].isFailed, true, 'status 0 + 有 error 记为失败')
}

{
  // status 0 但没有 error 字段：也是失败（网络层没拿到响应）
  const s = parseHar({ log: { version: '1.2', entries: [{
    startedDateTime: '2026-03-01T10:00:00.000Z', time: 1,
    request: { method: 'GET', url: 'https://a.test/', headers: [], queryString: [], cookies: [] },
    response: { status: 0, statusText: '', headers: [], cookies: [], content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: -1, bodySize: -1 },
    cache: {}, timings: { blocked: 0, dns: -1, connect: -1, send: 0, wait: 0, receive: 0, ssl: -1 },
  }] } })
  eq(s.entries[0].isFailed, true, 'status 0 即使无 error 也算失败')
}

{
  // 4xx/5xx 也算失败
  const s = parseHar({ log: { version: '1.2', entries: [{
    startedDateTime: '2026-03-01T10:00:00.000Z', time: 1,
    request: { method: 'GET', url: 'https://a.test/', headers: [], queryString: [], cookies: [] },
    response: { status: 500, statusText: 'Internal Server Error', headers: [], cookies: [], content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: 0, bodySize: 0 },
    cache: {}, timings: { blocked: 0, dns: 1, connect: 1, send: 0, wait: 1, receive: 0, ssl: 0 },
  }] } })
  eq(s.entries[0].isFailed, true, '500 记为失败')
  eq(s.entries[0].isRedirect, false, '500 不是重定向')
}

/* ================= 结果 ================= */

if (fails.length) {
  console.error(`\n✗ smoke:har 失败：${pass} 通过 / ${fails.length} 失败`)
  process.exit(1)
}
console.log(`✓ smoke:har ${pass} 项全部通过`)
