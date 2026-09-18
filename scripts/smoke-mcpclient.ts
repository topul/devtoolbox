/**
 * MCP 客户端（Inspector）端到端冒烟。
 *
 * 最有价值的一点：**被测目标就是本仓库自己构建出来的 MCP 服务端**
 * （`out/mcp/devtoolbox-mcp.cjs`）。客户端与服务端互为验证 ——
 * 服务端改坏了这里会红，客户端协议实现错了这里同样会红。
 *
 * 覆盖：
 *   - stdio：握手 / 能力清单 / 调工具 / 错误分支 / ping / 断开后进程退出 / 换目标不残留
 *   - stdio 异常：命令不存在、命令为空、服务端往 stdout 打日志（不能把连接搞崩）
 *   - http（Streamable HTTP）：JSON 响应与 SSE 响应两种形态
 *   - 编排：同一时刻只留一条连接、失败后 isConnected() 不为真
 */
import http from 'node:http'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createMcpClientController } from '../electron/main/mcpclient-ipc'
import { MCP_TOOLS } from '../src/lib/mcp-catalog'
import type { McpClientEvent, McpConnectSpec } from '../src/lib/mcpclient-types'

/**
 * 注意：这个脚本会被 esbuild 打包到 node_modules/.cache 下再执行，
 * 所以**不能用 import.meta.url 推仓库根目录**（那会指到 node_modules）。
 * npm script 从仓库根启动，直接用 cwd。
 */
const root = process.cwd()
const SERVER = path.join(root, 'out', 'mcp', 'devtoolbox-mcp.cjs')
const NODE = process.execPath

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}
function includes(name: string, haystack: string, needle: string): void {
  ok(name, haystack.includes(needle), `未在「${haystack.slice(0, 200)}」中找到 ${JSON.stringify(needle)}`)
}
function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = (): void => {
      if (cond() || Date.now() - t0 > timeoutMs) resolve()
      else setTimeout(tick, 10)
    }
    tick()
  })
}

/** 每个用例都独立的控制器 + 事件收集器 */
function makeHarness(): { events: McpClientEvent[]; ctl: ReturnType<typeof createMcpClientController> } {
  const events: McpClientEvent[] = []
  const ctl = createMcpClientController({ emit: (e) => events.push(e) }, { version: 'test' })
  return { events, ctl }
}

const stdioSpec = (overrides: Partial<McpConnectSpec> = {}): McpConnectSpec => ({
  id: 'self',
  transport: 'stdio',
  command: NODE,
  args: [SERVER],
  timeoutMs: 15000,
  ...overrides,
})

/* ================= 假 MCP HTTP 服务端 ================= */

function startHttpMock() {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let msg: any = {}
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch { /* ignore */ }

      const reply = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id: msg.id, result })
      let payload: Record<string, unknown> | null = null
      if (msg.method === 'initialize') {
        payload = reply({
          protocolVersion: '2025-03-26',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'http-mock', version: '9.9' },
          instructions: '来自假 HTTP 服务端',
        })
      } else if (msg.method === 'tools/list') {
        payload = reply({
          tools: [
            { name: 'echo', description: '回显参数', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要回显的文本' } }, required: ['text'] } },
          ],
        })
      } else if (msg.method === 'tools/call') {
        payload = reply({ content: [{ type: 'text', text: `echo:${JSON.stringify(msg.params?.arguments)}` }] })
      } else if (msg.method === 'resources/list') {
        payload = reply({ resources: [{ uri: 'mock://a', name: 'A', mimeType: 'text/plain' }] })
      } else if (msg.method === 'ping') {
        payload = reply({})
      } else if (msg.id !== undefined) {
        payload = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: '不支持的方法' } }
      }

      if (!payload) {
        res.writeHead(202)
        res.end()
        return
      }
      if (req.url === '/sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
        res.end()
        return
      }
      if (req.url === '/session') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-123' })
        res.end(JSON.stringify(payload))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port }))
  })
}

/** 往 stdout 打日志的假 stdio 服务端（真实世界里这么干的服务端不少） */
const NOISY_SERVER = `
process.stdout.write('INFO starting up, this line is not JSON\\n')
let buf = ''
const reply = (m, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const m = JSON.parse(line)
    if (m.method === 'initialize') reply(m, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'noisy', version: '1' } })
    else if (m.method === 'tools/list') reply(m, { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] })
    else if (m.method === 'tools/call') reply(m, { content: [{ type: 'text', text: 'noisy:' + JSON.stringify(m.params.arguments) }] })
    else if (m.id !== undefined) reply(m, {})
  }
})
`

/* ================= 主流程 ================= */

const watchdog = setTimeout(() => {
  console.error('\n错误: 冒烟脚本超时（120s），可能存在未结束的连接')
  process.exit(1)
}, 120_000)

async function main(): Promise<void> {
  console.log('MCP 客户端（Inspector）冒烟')

  ok('被测目标存在（本仓库自己的 MCP 服务端）', existsSync(SERVER), SERVER)
  if (!existsSync(SERVER)) {
    console.error('  请先执行 npm run build:mcp')
    // 必须清掉 watchdog：否则定时器会吊住事件循环，调用方看到的是「挂住然后被杀」
    clearTimeout(watchdog)
    process.exit(1)
  }

  const { server: httpMock, port } = await startHttpMock()

  try {
    /* ---------- stdio：连本机自己的服务端 ---------- */
    {
      const { events, ctl } = makeHarness()
      const res = await ctl.connect(stdioSpec())

      eq('连接自己的服务端成功', res.ok, true)
      eq('服务端名是 devtoolbox', res.info?.name, 'devtoolbox')
      ok('拿到协议版本', !!res.info?.protocolVersion, res.info?.protocolVersion)
      ok('服务端声明了 tools 能力', 'tools' in (res.info?.capabilities ?? {}))
      eq('未声明 resources 时清单为空', res.catalog?.resources.length, 0)
      eq('declared.resources 为假', res.catalog?.declared.resources, false)
      eq('能力清单与 catalog 声明一致', res.catalog?.tools.length, MCP_TOOLS.length)
      ok('工具带说明与参数 schema', !!res.catalog?.tools[0]?.description && !!res.catalog?.tools[0]?.inputSchema)

      const statuses = events.filter((e) => e.type === 'status').map((e) => (e as any).status)
      eq('状态依次为 connecting → connected', statuses.join(','), 'connecting,connected')
      ok('收到了 serverInfo 事件', events.some((e) => e.type === 'serverInfo'))
      ok('收到了 catalog 事件', events.some((e) => e.type === 'catalog'))
      ok('收到了子进程 stderr 日志', events.some((e) => e.type === 'log' && e.source === 'stderr'))

      const frames = events.filter((e) => e.type === 'frame') as Extract<McpClientEvent, { type: 'frame' }>[]
      ok('原始帧里有 send 也有 recv', frames.some((f) => f.dir === 'send') && frames.some((f) => f.dir === 'recv'))
      ok('所有帧都是合法 JSON', frames.every((f) => f.ok), frames.filter((f) => !f.ok).map((f) => f.payload).join(' | '))
      includes('帧里能看到 initialize', frames.map((f) => f.payload).join('\n'), 'initialize')
      includes('帧里能看到 tools/list', frames.map((f) => f.payload).join('\n'), 'tools/list')

      ok('isConnected 为真', ctl.isConnected())

      /* 调工具 */
      const b64 = await ctl.callTool('base64_encode', { text: '你好' })
      eq('调用成功', b64.ok, true)
      eq('调用结果正确', b64.text, '5L2g5aW9')
      ok('结果带耗时', b64.durationMs >= 0)
      ok('结果带原始 result', !!b64.raw)

      const bad = await ctl.callTool('no_such_tool', {})
      eq('不存在的工具不算成功', bad.ok, false)
      eq('不存在的工具标记 isError', bad.isError, true)
      includes('不存在的工具报出协议错误码', bad.error ?? '', '-32602')

      const missing = await ctl.callTool('base64_encode', {})
      eq('缺参数时服务端返回 isError 结果', missing.isError, true)
      ok('协议层仍是成功的', missing.ok, JSON.stringify(missing))
      includes('缺参数提示可读', missing.text, 'text')

      const diff = await ctl.callTool('diff', { a: 'a\nb', b: 'a\nc', format: 'text' })
      eq('多行参数工具可用', diff.ok, true)
      includes('多行结果正确', diff.text, '+1 行')
      includes('多行结果带上了差异行', diff.text, '+ c')

      const ping = await ctl.ping()
      eq('ping 成功', ping.ok, true)
      ok('ping 有耗时', (ping.ms ?? -1) >= 0, String(ping.ms))

      /* 断开 */
      eq('断开返回 true', await ctl.disconnect(), true)
      eq('断开后 isConnected 为假', ctl.isConnected(), false)
      eq('无连接时再断开返回 false', await ctl.disconnect(), false)
      const noConn = await ctl.callTool('base64_encode', { text: 'x' })
      eq('断开后调用被拒', noConn.ok, false)
      includes('断开后错误可读', noConn.error ?? '', '尚未连接')
      const exits = events.filter((e) => e.type === 'exit')
      ok('子进程收到退出事件', exits.length > 0, String(exits.length))
    }

    /* ---------- stdio：服务端往 stdout 打日志也不能崩 ---------- */
    {
      const { events, ctl } = makeHarness()
      const res = await ctl.connect(stdioSpec({ id: 'noisy', args: ['-e', NOISY_SERVER] }))
      eq('带噪声的服务端仍能连上', res.ok, true)
      eq('识别出服务端名', res.info?.name, 'noisy')
      const badFrames = events.filter((e) => e.type === 'frame' && !e.ok)
      ok('非 JSON 的 stdout 行被标记出来', badFrames.length > 0)
      includes('被标记的正是那行日志', (badFrames[0] as any)?.payload ?? '', 'not JSON')
      const called = await ctl.callTool('echo', { a: 1 })
      eq('噪声不影响后续调用', called.text, 'noisy:{"a":1}')
      await ctl.disconnect()
    }

    /* ---------- stdio：起不来要有清楚报错且不留残留 ---------- */
    {
      const { ctl } = makeHarness()
      const res = await ctl.connect(stdioSpec({ id: 'bad-cmd', command: 'definitely-not-a-real-command-xyz' }))
      eq('命令不存在时连接失败', res.ok, false)
      ok('报错说明是启动失败', /启动失败|ENOENT/.test(res.error ?? ''), res.error)
      eq('失败后 isConnected 为假', ctl.isConnected(), false)

      const empty = await ctl.connect(stdioSpec({ id: 'empty-cmd', command: '   ' }))
      eq('命令为空时连接失败', empty.ok, false)
      includes('提示未填写命令', empty.error ?? '', '命令')
    }

    /* ---------- http：JSON 响应 ---------- */
    {
      const { events, ctl } = makeHarness()
      const spec: McpConnectSpec = { id: 'http-json', transport: 'http', url: `http://127.0.0.1:${port}/mcp`, timeoutMs: 10000 }
      const res = await ctl.connect(spec)
      eq('HTTP 连接成功', res.ok, true)
      eq('HTTP 服务端名', res.info?.name, 'http-mock')
      eq('HTTP 协议版本按服务端返回', res.info?.protocolVersion, '2025-03-26')
      eq('HTTP 能力清单', res.catalog?.tools.length, 1)
      eq('HTTP 服务端声明了 resources', res.catalog?.declared.resources, true)
      eq('HTTP 资源列表已拉取', res.catalog?.resources.length, 1)

      const called = await ctl.callTool('echo', { text: 'hi' })
      eq('HTTP 调工具成功', called.ok, true)
      eq('HTTP 工具结果正确', called.text, 'echo:{"text":"hi"}')

      const ping = await ctl.ping()
      eq('HTTP ping 成功', ping.ok, true)
      ok('HTTP 传输有诊断日志', events.some((e) => e.type === 'log'))
      await ctl.disconnect()
    }

    /* ---------- http：SSE 响应 ---------- */
    {
      const { ctl } = makeHarness()
      const res = await ctl.connect({ id: 'http-sse', transport: 'http', url: `http://127.0.0.1:${port}/sse`, timeoutMs: 10000 })
      eq('SSE 响应也能完成握手', res.ok, true)
      eq('SSE 服务端名', res.info?.name, 'http-mock')
      const called = await ctl.callTool('echo', { n: 2 })
      eq('SSE 调工具成功', called.ok, true)
      eq('SSE 工具结果正确', called.text, 'echo:{"n":2}')
      await ctl.disconnect()
    }

    /* ---------- http：会话 id 与错误分支 ---------- */
    {
      const { ctl } = makeHarness()
      // /session 会返回 Mcp-Session-Id，客户端要带上（这里只验证不影响握手与调用）
      const res = await ctl.connect({ id: 'http-session', transport: 'http', url: `http://127.0.0.1:${port}/session`, timeoutMs: 10000 })
      eq('带会话 id 的服务端可用', res.ok, true)
      const called = await ctl.callTool('echo', { ok: true })
      eq('带会话 id 时调用成功', called.ok, true)
      await ctl.disconnect()

      // 连不上的地址：要在超时前给出可读错误，而不是干等
      const dead = await ctl.connect({ id: 'http-dead', transport: 'http', url: 'http://127.0.0.1:1/mcp', timeoutMs: 3000 })
      eq('连不上的地址连接失败', dead.ok, false)
      ok('连不上时有错误信息', !!dead.error, dead.error)

      const emptyUrl = await ctl.connect({ id: 'http-empty', transport: 'http', url: '  ' })
      eq('地址为空时连接失败', emptyUrl.ok, false)
      includes('提示未填写地址', emptyUrl.error ?? '', '地址')
    }

    /* ---------- 换目标时不残留旧连接 ---------- */
    {
      const { ctl } = makeHarness()
      const first = await ctl.connect(stdioSpec({ id: 'first' }))
      eq('第一条连接建立', first.ok, true)
      const second = await ctl.connect({ id: 'second', transport: 'http', url: `http://127.0.0.1:${port}/mcp`, timeoutMs: 10000 })
      eq('第二条连接建立', second.ok, true)
      eq('第二条连接是 HTTP 服务端', second.info?.name, 'http-mock')
      const called = await ctl.callTool('echo', { z: 1 })
      eq('调用走的是新连接', called.text, 'echo:{"z":1}')
      await ctl.disconnect()
    }
  } finally {
    httpMock.close()
  }

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed) {
    console.log('\n失败明细：')
    for (const f of failures) console.log('  - ' + f)
  }
  clearTimeout(watchdog)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('冒烟脚本异常:', e)
  clearTimeout(watchdog)
  process.exit(1)
})
