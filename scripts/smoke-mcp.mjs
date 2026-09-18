#!/usr/bin/env node
/**
 * MCP 服务端端到端冒烟。
 *
 * 做三件事：
 *   1. 起真实进程，走真实 stdio JSON-RPC，断言协议行为（初始化/通知不回包/错误码/未知工具）；
 *   2. 逐个调用**目录里声明的每一个工具**，缺实现、参数名写错、抛异常都会在这里红；
 *   3. 起一个本地 http 服务，验证 http_request 的重定向、gzip 解压、请求体回显与失败分支。
 *
 * 与 smoke-render 一样，工具数量是写死的期望值：新增工具时必须同步更新 FIXTURES，
 * 否则数量断言会失败 —— 这是「加了声明忘了实现」的唯一拦截点。
 *
 * 只依赖 node 内置模块，不需要 electron，可在 CI 直接跑。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import zlib from 'node:zlib'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverFile = path.join(root, 'out', 'mcp', 'devtoolbox-mcp.cjs')

let passed = 0
let failed = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function includes(name, haystack, needle) {
  ok(name, String(haystack).includes(needle), `输出中未找到 ${JSON.stringify(needle)}`)
}

/* ================= 每个工具的调用参数（同时充当实现清单） ================= */

const FIXTURES = {
  base64_encode: { text: '你好, world' },
  base64_decode: { text: '5L2g5aW9LCB3b3JsZA==' },
  url_encode: { text: 'a b&c=中文', mode: 'component' },
  url_decode: { text: 'a%20b%26c%3D%E4%B8%AD%E6%96%87', mode: 'component' },
  escape_convert: { text: '<script>alert(1)</script>', codec: 'base64', mode: 'encode' },
  html_entity: { text: '<a href="x">&\'</a>', mode: 'encode' },
  radix_convert: { input: '0xFF', from: 16 },

  hash: { text: 'abc', algorithm: 'SHA256' },
  hmac: { text: 'message', key: 'secret', algorithm: 'SHA256' },
  aes_crypt: { text: 'hello', key: 'k', mode: 'ECB', op: 'encrypt' },
  jwt_decode: {
    token:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  },

  json_format: { text: '{"b":1,"a":[2,3]}', mode: 'format' },
  json_validate: { text: '{"ok":true}' },
  json_query: { json: '{"store":{"book":[{"price":8.95},{"price":12.99}]}}', path: '$.store.book[*].price' },
  yaml_convert: { text: 'server:\n  host: 0.0.0.0\n  port: 8080\n  tags:\n    - web\n', mode: 'yaml2json' },

  text_case: { text: 'hello world foo-bar', style: 'camelCase' },
  line_ops: { text: 'b\na\nb\n', op: 'dedupe' },
  text_stats: { text: '你好 world\n\n第二段' },
  estimate_tokens: { text: '你好，world' },
  check_tool_schema: {
    schema: JSON.stringify([
      {
        type: 'function',
        function: {
          name: 'demo',
          description: '演示工具',
          parameters: { type: 'object', properties: { a: { type: 'string', description: '甲' } }, required: ['a'] },
        },
      },
    ]),
    target: 'typescript',
  },
  diff: { a: 'a\nb\nc', b: 'a\nx\nc', format: 'text' },
  regex_test: { pattern: '(\\d+)-(\\d+)', text: 'call 12-34 and 56-78', flags: 'g' },

  timestamp_convert: { timestamp: '1758160000' },
  date_diff: { a: '2026-01-01', b: '2026-03-01' },
  cron_next: { expr: '0 3 * * 1-5', count: 3 },

  ip_convert: { input: '127.0.0.1' },
  cidr_info: { cidr: '10.0.0.1/22' },
  chmod_convert: { input: '755' },
  url_parse: { url: 'https://user:pw@api.example.com:8443/v1/users?id=42&tag=a&tag=b#sec' },
  cookie_parse: { cookie: 'sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax' },
  ua_parse: { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },

  uuid_generate: { count: 3 },
  password_generate: { length: 20, symbol: true },
  fake_data: { count: 3, locale: 'zh', format: 'json' },

  http_request: { url: 'http://127.0.0.1:1/' },
}

const EXPECTED_TOOL_COUNT = Object.keys(FIXTURES).length

/* ================= stdio 会话 ================= */

class McpSession {
  constructor(child) {
    this.child = child
    this.buf = ''
    this.pending = new Map()
    this.seq = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          failed++
          failures.push(`stdout 出现非 JSON 内容: ${line.slice(0, 120)}`)
          continue
        }
        const slot = this.pending.get(msg.id)
        if (slot) {
          this.pending.delete(msg.id)
          slot(msg)
        }
      }
    })
  }

  send(method, params, { expectReply = true } = {}) {
    const id = expectReply ? ++this.seq : undefined
    const msg = { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(expectReply ? { id } : {}) }
    this.child.stdin.write(JSON.stringify(msg) + '\n')
    if (!expectReply) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${method} 响应超时`)), 20000)
      this.pending.set(id, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
    })
  }

  raw(line) {
    this.child.stdin.write(line + '\n')
  }

  close() {
    this.child.stdin.end()
  }
}

/* ================= 本地 http 靶机 ================= */

function startTarget() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/hello' })
      res.end()
      return
    }
    if (url.pathname === '/hello') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Probe': 'yes' })
      res.end(JSON.stringify({ ok: true, path: '/hello' }))
      return
    }
    if (url.pathname === '/gzip') {
      const body = zlib.gzipSync(Buffer.from(JSON.stringify({ compressed: true, msg: '压缩正文' })))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
      res.end(body)
      return
    }
    if (url.pathname === '/echo') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString('utf8'), probe: req.headers['x-probe'] ?? null }))
      })
      return
    }
    if (url.pathname === '/dup') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': ['a=1', 'b=2'] })
      res.end('dup headers')
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/* ================= 主流程 ================= */

const watchdog = setTimeout(() => {
  console.error('\n错误: 冒烟脚本超时（90s），可能存在未关闭的连接或挂起的等待')
  process.exit(1)
}, 90000)

async function main() {
  console.log('MCP 服务端冒烟')

  ok('构建产物存在', existsSync(serverFile), serverFile)
  if (!existsSync(serverFile)) {
    console.error('  请先执行 npm run build:mcp')
    return
  }

  const { server: target, port: targetPort } = await startTarget()

  const child = spawn(process.execPath, [serverFile], { stdio: ['pipe', 'pipe', 'pipe'] })
  const session = new McpSession(child)
  let stderrText = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d) => { stderrText += d })

  try {
    /* ---------- 协议 ---------- */
    const init = await session.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    })
    ok('initialize 不返回错误', !init.error, JSON.stringify(init.error))
    eq('协议版本回显', init.result?.protocolVersion, '2025-06-18')
    ok('声明 tools 能力', !!init.result?.capabilities?.tools)
    eq('serverInfo.name', init.result?.serverInfo?.name, 'devtoolbox')
    ok('serverInfo.version 非空', !!init.result?.serverInfo?.version)

    // 未知版本要落到服务端支持的最新版本，而不是原样回显
    const init2 = await session.send('initialize', { protocolVersion: '1999-01-01', capabilities: {} })
    eq('未知协议版本降级', init2.result?.protocolVersion, '2025-06-18')

    // 通知不得回包
    session.send('notifications/initialized', undefined, { expectReply: false })

    const ping = await session.send('ping')
    ok('ping 正常', !ping.error)

    const list = await session.send('tools/list')
    const tools = list.result?.tools ?? []
    eq('工具数量与参数清单一致', tools.length, EXPECTED_TOOL_COUNT)

    const names = tools.map((t) => t.name)
    eq('工具名不重复', new Set(names).size, names.length)
    ok(
      'tools/list 中的工具都有调用参数',
      names.every((n) => n in FIXTURES),
      names.filter((n) => !(n in FIXTURES)).join(', '),
    )
    ok(
      '参数清单里的工具都已声明',
      Object.keys(FIXTURES).every((n) => names.includes(n)),
      Object.keys(FIXTURES).filter((n) => !names.includes(n)).join(', '),
    )
    for (const t of tools) {
      if (!t.description || typeof t.description !== 'string') {
        ok(`工具 ${t.name} 有说明`, false)
      }
      if (t.inputSchema?.type !== 'object') {
        ok(`工具 ${t.name} 的 inputSchema 是 object`, false)
      }
      // 目录里带中英两份文案供界面用，但发给客户端的结构里不能混进非标准 JSON Schema 字段
      const leaked = Object.values(t.inputSchema?.properties ?? {}).some((prop) => 'descriptionEn' in prop)
      if (leaked) ok(`工具 ${t.name} 未泄漏界面专用字段`, false, 'inputSchema 里出现了 descriptionEn')
      const undocumented = Object.values(t.inputSchema?.properties ?? {}).filter((prop) => !prop.description)
      if (undocumented.length) ok(`工具 ${t.name} 每个参数都有说明`, false)
    }

    /* ---------- 逐个工具真实调用 ---------- */
    for (const [name, args] of Object.entries(FIXTURES)) {
      if (name === 'http_request') continue // 单独测，避免端口占位与实际靶机耦合
      const res = await session.send('tools/call', { name, arguments: args })
      if (res.error) {
        ok(`调用 ${name}`, false, JSON.stringify(res.error))
        continue
      }
      const text = res.result?.content?.[0]?.text ?? ''
      ok(`调用 ${name} 返回内容`, text.length > 0)
      ok(`调用 ${name} 未标记失败`, res.result?.isError !== true, text.slice(0, 160))
    }

    /* ---------- 错误分支 ---------- */
    const unknown = await session.send('tools/call', { name: 'not_a_tool', arguments: {} })
    eq('未知工具返回 -32602', unknown.error?.code, -32602)

    const badMethod = await session.send('no/such/method')
    eq('未知方法返回 -32601', badMethod.error?.code, -32601)

    const noName = await session.send('tools/call', { arguments: {} })
    eq('缺少工具名返回 -32602', noName.error?.code, -32602)

    const missingArg = await session.send('tools/call', { name: 'base64_encode', arguments: {} })
    eq('缺必填参数时以 isError 结果返回', missingArg.result?.isError, true)
    includes('缺参提示带出参数名', missingArg.result?.content?.[0]?.text, 'text')

    const badAlgo = await session.send('tools/call', { name: 'hash', arguments: { text: 'a', algorithm: 'CRC32' } })
    eq('非法枚举值走 isError', badAlgo.result?.isError, true)

    // 坏 JSON 会拿到 -32700。这段故意破坏性地占满 stdin，所以单独起一个进程测，
    // 免得后面对话还依赖当前会话的 stdout 监听器。
    const badJson = await probeRaw(['{ this is not json }'])
    const parseErr = badJson.find((m) => m.error?.code === -32700)
    eq('非法 JSON 返回 -32700', parseErr?.error?.code, -32700)
    eq('非法 JSON 的错误 id 为 null', parseErr?.id, null)

    const noMethod = await probeRaw(['{"jsonrpc":"2.0","id":9}'])
    eq('缺少 method 返回 -32600', noMethod[0]?.error?.code, -32600)

    /* ---------- http_request 打真实靶机 ---------- */
    const base = `http://127.0.0.1:${targetPort}`
    const call = async (args) => {
      const res = await session.send('tools/call', { name: 'http_request', arguments: args })
      return res.result?.content?.[0]?.text ?? ''
    }

    const hello = await call({ url: `${base}/hello` })
    includes('http_request 拿到状态码', hello, '200 OK')
    includes('http_request 拿到响应头', hello, 'X-Probe: yes')
    includes('http_request 拿到响应体', hello, '"ok":true')

    const redir = await call({ url: `${base}/redirect` })
    includes('跟随重定向后拿到 200', redir, '200 OK')
    includes('重定向链被记录', redir, '302')

    const noRedir = await call({ url: `${base}/redirect`, followRedirects: false })
    includes('关闭重定向后拿到 302', noRedir, '302')

    const gz = await call({ url: `${base}/gzip` })
    includes('gzip 正文已自动解压', gz, '压缩正文')
    includes('标注内容编码', gz, 'gzip')

    const echoed = await call({
      url: `${base}/echo`,
      method: 'POST',
      headers: 'Content-Type: text/plain\nX-Probe: from-mcp',
      body: 'payload-中文',
    })
    includes('POST 方法被透传', echoed, '"method":"POST"')
    includes('请求体被透传', echoed, 'payload-中文')
    includes('自定义请求头被透传', echoed, '"probe":"from-mcp"')

    const dup = await call({ url: `${base}/dup` })
    includes('重名响应头被保留', dup, 'Set-Cookie: a=1')
    includes('重名响应头第二项被保留', dup, 'Set-Cookie: b=2')

    const refused = await call({ url: 'http://127.0.0.1:1/', timeoutMs: 3000 })
    includes('连接失败有明确回报', refused, '请求失败')

    const badHeader = await spawnCall(serverFile, 'http_request', { url: `${base}/hello`, headers: 'no-colon-here' })
    includes('非法请求头格式被拒绝', badHeader.stderr, 'Name: value')

    /* ---------- CLI 模式 ---------- */
    const cliList = await spawnCall(serverFile, null, null, ['--list'])
    includes('CLI --list 输出工具数', cliList.stdout, `共 ${EXPECTED_TOOL_COUNT} 个工具`)
    includes('CLI --list 输出分组', cliList.stdout, '[http]')

    const cliCall = await spawnCall(serverFile, 'radix_convert', { input: '255', from: 10 })
    includes('CLI --call 返回结果', cliCall.stdout, '"hex": "FF"')

    const cliHelp = await spawnCall(serverFile, null, null, ['--help'])
    includes('CLI --help 有用法说明', cliHelp.stdout, '--call <工具>')

    const cliBadTool = await spawnCall(serverFile, 'no_such_tool', {})
    eq('CLI 未知工具退出码为 1', cliBadTool.code, 1)

    session.close()
    const exited = await waitExit(child, 5000)
    ok('stdin 关闭后服务端自行退出', exited, '进程未在 5s 内退出')
    ok('stderr 只用于诊断信息', !stderrText.includes('SyntaxError'), stderrText.slice(0, 200))
  } finally {
    target.close()
    // 兜底：确保子进程不残留
    if (!child.killed) child.kill('SIGKILL')
  }

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed) {
    console.log('\n失败明细：')
    for (const f of failures) console.log('  - ' + f)
  }
  clearTimeout(watchdog)
  process.exit(failed ? 1 : 0)
}

/** 独立起一个进程跑一次 CLI 调用，用于验证退出码与 stderr */
function spawnCall(file, tool, args, extraArgv = []) {
  return new Promise((resolve) => {
    const argv = extraArgv.length ? extraArgv : ['--call', tool, JSON.stringify(args ?? {})]
    const p = spawn(process.execPath, [file, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    const timer = setTimeout(() => p.kill('SIGKILL'), 15000)
    p.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** 起一个干净进程，喂几行原始输入，收集所有响应后收工（用于协议异常分支） */
function probeRaw(lines) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [serverFile], { stdio: ['pipe', 'pipe', 'ignore'] })
    const out = []
    let buf = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (c) => {
      buf += c
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!l) continue
        try {
          out.push(JSON.parse(l))
        } catch {
          /* 忽略非 JSON stdout */
        }
      }
    })
    for (const l of lines) p.stdin.write(l + '\n')
    setTimeout(() => {
      p.kill('SIGKILL')
      resolve(out)
    }, 2500)
  })
}

function waitExit(child, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

main().catch((e) => {
  console.error('冒烟脚本异常:', e)
  clearTimeout(watchdog)
  process.exit(1)
})
