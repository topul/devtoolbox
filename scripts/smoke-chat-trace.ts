/**
 * 对话链路记录端到端冒烟。
 *
 * 断言「调用链路视图」的数据契约：
 *   - 纯对话：一轮请求体（含 model/stream/messages）、SSE 帧样例、响应 meta 都被记下
 *   - 工具对话：每轮请求体分开记，第 2 轮的 messages 里有 assistant.tool_calls 与 role=tool
 *   - 请求头脱敏：Authorization / api-key 的值不留密钥内容
 *   - 失败与取消的对话也有链路（meta 为 null、已收到的帧保留）
 *   - 未命中（NOT_FOUND）、条数淘汰、请求体/帧截断
 *
 * 两头都是真的：假 OpenAI 服务端 + 本仓库真实 MCP 服务端（需先 npm run build:mcp）。
 */
import http from 'node:http'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createChatController } from '../electron/main/chat-ipc'
import {
  CHAT_TRACE_MAX_BODY,
  CHAT_TRACE_MAX_FRAMES,
  CHAT_TRACE_MAX_TRACES,
  createChatTraceRegistry,
} from '../electron/main/chat-trace'
import type { ChatEvent, ChatSendSpec, ChatTrace } from '../src/lib/chat-types'

const SERVER = path.join(process.cwd(), 'out', 'mcp', 'devtoolbox-mcp.cjs')
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
  ok(
    name,
    Object.is(actual, expected),
    `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
  )
}
function includes(name: string, haystack: string, needle: string): void {
  ok(
    name,
    haystack.includes(needle),
    `未在「${haystack.slice(0, 200)}」中找到 ${JSON.stringify(needle)}`,
  )
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

/* ================= 假模型服务端 ================= */

function startModel() {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const messages = body.messages as any[]
      const toolMsgs = messages.filter((m) => m.role === 'tool').length

      if (body.model === 'error401') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (o: unknown): void => {
        res.write(`data: ${JSON.stringify(o)}\n\n`)
      }
      const frame = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
        send({ model: 'mock-model', choices: [{ index: 0, delta, ...extra }] })
      }
      const done = (): void => {
        res.write('data: [DONE]\n\n')
        res.end()
      }
      const emitToolCall = (id: string, name: string, argsJson: string): void => {
        frame({
          tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: argsJson } }],
        })
        frame({}, { finish_reason: 'tool_calls' })
        done()
      }

      if (body.model === 'slow') {
        frame({ content: '第一帧' })
        return // 不 end，用于取消
      }

      if (toolMsgs === 0 && body.tools?.length) {
        emitToolCall('call_1', 'cidr_info', '{"cidr":"10.0.0.1/22"}')
        return
      }
      for (const part of '工具结果已收到') frame({ content: part })
      frame({}, { finish_reason: 'stop' })
      send({
        model: 'mock-model',
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      })
      done()
    })
  })
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port }))
  })
}

/* ================= 驱动 ================= */

const events: ChatEvent[] = []
const ctl = createChatController({ emit: (e) => events.push(e) })

const of = <T extends ChatEvent['type']>(id: string, type: T): Extract<ChatEvent, { type: T }>[] =>
  events.filter((e) => e.type === type && e.requestId === id) as Extract<ChatEvent, { type: T }>[]

const baseSpec = (over: Partial<ChatSendSpec>): ChatSendSpec =>
  ({
    baseUrl: over.baseUrl ?? '',
    apiKey: 'sk-secret-123',
    model: 'mock-model',
    messages: [{ role: 'user', content: '你好' }],
    ...over,
  }) as ChatSendSpec

const watchdog = setTimeout(() => {
  console.error('\n错误: 冒烟脚本超时（90s）')
  process.exit(1)
}, 90_000)

async function main(): Promise<void> {
  console.log('对话链路记录冒烟')

  ok('被测工具服务端存在', existsSync(SERVER), SERVER)
  if (!existsSync(SERVER)) {
    console.error('  请先执行 npm run build:mcp')
    clearTimeout(watchdog)
    process.exit(1)
  }

  const { server: model, port } = await startModel()
  const baseUrl = `http://127.0.0.1:${port}/v1`

  try {
    /* ---------- 纯对话：一轮完整链路 ---------- */
    {
      ctl.send(baseSpec({ requestId: 'req-plain', baseUrl, model: 'mock-model' }))
      await waitFor(
        () => of('req-plain', 'done').length > 0 || of('req-plain', 'error').length > 0,
        10_000,
      )
      eq('纯对话完成', of('req-plain', 'done').length, 1)

      const r = ctl.trace('req-plain')
      eq('链路可查', r.ok, true)
      const trace = (r as { ok: true; trace: ChatTrace }).trace
      includes('记录了 completions 地址', trace.url, '/chat/completions')
      eq('一轮请求', trace.rounds.length, 1)
      const round = trace.rounds[0]
      const body = JSON.parse(round.requestBody) as Record<string, unknown>
      eq('请求体带 model', body.model, 'mock-model')
      eq('请求体是流式', body.stream, true)
      eq('请求体带用户消息', (body.messages as unknown[])?.length, 1)
      ok('请求体带了 usage 开关', !!body.stream_options)
      ok('SSE 帧被记录', round.frames.length >= 3, String(round.frames.length))
      includes('帧是 data 行', round.frames[0], 'data:')
      ok('响应 meta 被记录', round.meta?.totalMs >= 0)
      eq('usage 进了链路', round.meta?.usage?.totalTokens, 11)
      ok('startedAt 有值', trace.startedAt > 0)
    }

    /* ---------- 脱敏 ---------- */
    {
      const r = ctl.trace('req-plain')
      const trace = (r as { ok: true; trace: ChatTrace }).trace
      const auth = trace.headers.find(([k]) => k.toLowerCase() === 'authorization')
      includes('Authorization 保留形态', auth?.[1] ?? '', 'Bearer')
      includes('Authorization 值已脱敏', auth?.[1] ?? '', '***')
      ok('任何头里都不含密钥原文', !JSON.stringify(trace.headers).includes('sk-secret-123'))
    }

    /* ---------- 工具对话：逐轮请求体 ---------- */
    {
      ctl.send(
        baseSpec({
          requestId: 'req-agent',
          baseUrl,
          apiKey: 'sk-agent',
          tools: { server: { command: NODE, args: [SERVER] }, maxRounds: 8 },
        }),
      )
      await waitFor(
        () => of('req-agent', 'done').length > 0 || of('req-agent', 'error').length > 0,
        30_000,
      )
      eq('工具对话完成', of('req-agent', 'done').length, 1)

      const r = ctl.trace('req-agent')
      eq('链路可查', r.ok, true)
      const trace = (r as { ok: true; trace: ChatTrace }).trace
      eq('两轮请求', trace.rounds.length, 2)

      const round1 = JSON.parse(trace.rounds[0].requestBody) as {
        messages: { role: string }[]
        tools?: unknown[]
      }
      eq('第 1 轮只有用户消息', round1.messages.length, 1)
      ok('第 1 轮带了工具清单', Array.isArray(round1.tools) && round1.tools.length > 0)

      const round2 = JSON.parse(trace.rounds[1].requestBody) as {
        messages: {
          role: string
          tool_calls?: unknown[]
          tool_call_id?: string
          content?: string
        }[]
      }
      ok(
        '第 2 轮回填了 assistant.tool_calls',
        !!round2.messages.find((m) => m.role === 'assistant')?.tool_calls,
      )
      eq('第 2 轮带了 role=tool 结果', round2.messages.filter((m) => m.role === 'tool').length, 1)
      eq(
        'tool 消息的 id 对得上',
        round2.messages.find((m) => m.role === 'tool')?.tool_call_id,
        'call_1',
      )

      ok('第 1 轮记了工具调用', trace.rounds[0].tools.length === 1)
      eq('调用名正确', trace.rounds[0].tools[0].call.name, 'cidr_info')
      eq('调用参数正确', trace.rounds[0].tools[0].call.args, '{"cidr":"10.0.0.1/22"}')
      eq('结果已回填', trace.rounds[0].tools[0].result?.ok, true)
      includes('结果是真实执行输出', trace.rounds[0].tools[0].result?.text ?? '', '10.0.0.0/22')
      ok(
        '两轮各自的帧都记了',
        trace.rounds[0].frames.length > 0 && trace.rounds[1].frames.length > 0,
      )
      ok('工具对话的密钥同样脱敏', !JSON.stringify(trace.headers).includes('sk-agent'))
    }

    /* ---------- 失败（401）也有链路 ---------- */
    {
      ctl.send(baseSpec({ requestId: 'req-401', baseUrl, model: 'error401' }))
      await waitFor(() => of('req-401', 'error').length > 0, 10_000)
      const r = ctl.trace('req-401')
      eq('失败请求的链路可查', r.ok, true)
      const trace = (r as { ok: true; trace: ChatTrace }).trace
      eq('一轮', trace.rounds.length, 1)
      ok('请求体已记录', trace.rounds[0].requestBody.length > 0)
      eq('失败轮 meta 为空', trace.rounds[0].meta, null)
      ok('失败轮没有帧（非流式错误响应）', trace.rounds[0].frames.length === 0)
    }

    /* ---------- 取消也有链路 ---------- */
    {
      ctl.send(baseSpec({ requestId: 'req-abort', baseUrl, model: 'slow' }))
      await waitFor(() => of('req-abort', 'delta').length > 0, 10_000)
      ctl.abort()
      await waitFor(
        () => of('req-abort', 'error').length > 0 || of('req-abort', 'done').length > 0,
        10_000,
      )
      const r = ctl.trace('req-abort')
      eq('被取消对话的链路可查', r.ok, true)
      const trace = (r as { ok: true; trace: ChatTrace }).trace
      ok(
        '已收到的帧保留',
        trace.rounds[0].frames.length >= 1,
        String(trace.rounds[0].frames.length),
      )
      eq('没有完成的 meta 为空', trace.rounds[0].meta, null)
    }

    /* ---------- 未命中 ---------- */
    {
      const r = ctl.trace('no-such-request')
      ok('未命中返回 NOT_FOUND', !r.ok && (r as { error?: string }).error === 'NOT_FOUND')
    }

    /* ---------- 注册表：淘汰与截断（单元级） ---------- */
    {
      const reg = createChatTraceRegistry()
      for (let i = 0; i < CHAT_TRACE_MAX_TRACES + 1; i++) {
        reg.begin(`t-${i}`).request(1, { url: `u-${i}`, headers: [], body: '{}' })
      }
      eq('超过上限淘汰最旧', reg.get('t-0'), null)
      ok(
        '最新一条还在',
        reg.get(`t-${CHAT_TRACE_MAX_TRACES}`)?.url === `u-${CHAT_TRACE_MAX_TRACES}`,
      )

      const big = reg.begin('t-big')
      big.request(1, { url: 'u', headers: [], body: 'x'.repeat(CHAT_TRACE_MAX_BODY + 1000) })
      const bigTrace = reg.get('t-big')!
      ok('超长请求体标记 truncated', bigTrace.rounds[0].truncated === true)
      ok(
        '超长请求体长度在上限内',
        bigTrace.rounds[0].requestBody.length <= CHAT_TRACE_MAX_BODY,
        String(bigTrace.rounds[0].requestBody.length),
      )

      const many = reg.begin('t-frames')
      for (let i = 0; i < CHAT_TRACE_MAX_FRAMES + 50; i++) many.frame(1, `data: frame-${i}`)
      const framesTrace = reg.get('t-frames')!
      eq('帧数到上限停止记录', framesTrace.rounds[0].frames.length, CHAT_TRACE_MAX_FRAMES)
      ok('帧截断有标记', framesTrace.rounds[0].framesTruncated === true)

      const tools = reg.begin('t-tools')
      tools.toolCall(1, { id: 'c1', name: 'a', args: '{}' })
      tools.toolResult(1, 'c1', {
        id: 'c1',
        name: 'a',
        ok: true,
        isError: false,
        text: 'r',
        durationMs: 1,
      })
      eq('结果回填到对应调用', reg.get('t-tools')!.rounds[0].tools[0].result?.text, 'r')

      // 异常轮次号：丢弃而不是造出脏轮次
      const weird = reg.begin('t-weird')
      weird.request(0, { url: 'u', headers: [], body: '{}' })
      weird.request(999, { url: 'u', headers: [], body: '{}' })
      weird.request(2, { url: 'u2', headers: [], body: '{}' })
      const weirdTrace = reg.get('t-weird')!
      eq('只保留了合法轮次', weirdTrace.rounds.length, 1)
      eq('保留的是 round=2', weirdTrace.rounds[0].round, 2)

      // 同一 id 重发：旧记录作废
      reg.begin('t-plain')
      reg.begin('t-plain').request(1, { url: 'v2', headers: [], body: '{}' })
      eq('同 id 重发后是干净记录', reg.get('t-plain')!.rounds[0].requestBody, '{}')
    }
  } finally {
    model.close()
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
