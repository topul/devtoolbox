/**
 * 工具调用循环（agent）端到端冒烟。
 *
 * 两头都是真的，中间只有模型是假的：
 *   模型 → 假 OpenAI 服务端（按剧本返回 tool_calls，且**分片**返回以验证拼接）
 *   工具 → 本仓库真实构建的 MCP 服务端（out/mcp/devtoolbox-mcp.cjs）
 *   驱动 → 真实的 createChatController
 *
 * 所以这里断言的是完整闭环：模型说要调什么 → 真的调到了本机工具 → 结果真的喂回了模型 →
 * 模型给出最终回答。这条链路任何一环写错都会红。
 */
import http from 'node:http'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createChatController } from '../electron/main/chat-ipc'
import { MCP_TOOLS } from '../src/lib/mcp-catalog'
import type { ChatEvent, ChatSendSpec } from '../src/lib/chat-types'

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

/* ================= 假模型服务端 ================= */

function startModel() {
  const seenRequests: { messages: any[]; tools: any[] }[] = []

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const messages = body.messages as any[]
      const tools = (body.tools ?? []) as any[]
      seenRequests.push({ messages, tools })

      const first = String(messages.find((m) => m.role === 'user')?.content ?? '')
      const toolMsgs = messages.filter((m) => m.role === 'tool').length
      const toolNames: string[] = messages.filter((m) => m.role === 'tool').map((m) => String(m.tool_call_id))

      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (o: unknown): void => { res.write(`data: ${JSON.stringify(o)}\n\n`) }
      const frame = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
        send({ model: 'mock-model', choices: [{ index: 0, delta, ...extra }] })
      }
      const done = (): void => {
        res.write('data: [DONE]\n\n')
        res.end()
      }
      /** 分片发一个工具调用：id 单独一帧、名字单独一帧、参数拆两帧 */
      const emitToolCall = (idx: number, id: string, name: string, argsJson: string): void => {
        frame({ tool_calls: [{ index: idx, id, type: 'function', function: { name, arguments: '' } }] })
        frame({ tool_calls: [{ index: idx, function: { arguments: argsJson.slice(0, 6) } }] })
        frame({ tool_calls: [{ index: idx, function: { arguments: argsJson.slice(6) } }] })
      }

      // 已经调过工具还没结束：给最终回答（除非剧本要求无限循环）
      if (toolMsgs > 0 && !first.includes('LOOP')) {
        if (first.includes('BADJSON') && toolMsgs < 2) {
          // 第一次参数不合法 → 模型看到报错后再给一次正确调用
          emitToolCall(0, 'call_fix', 'cidr_info', '{"cidr":"192.168.0.1/24"}')
          frame({}, { finish_reason: 'tool_calls' })
          done()
          return
        }
        const text = `收到 ${toolMsgs} 个工具结果：${toolNames.join(',')}`
        for (const part of [...text]) frame({ content: part })
        frame({}, { finish_reason: 'stop' })
        send({ model: 'mock-model', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
        done()
        return
      }

      if (first.includes('LOOP')) {
        emitToolCall(0, `call_loop_${toolMsgs}`, 'uuid_generate', '{"count":1}')
        frame({}, { finish_reason: 'tool_calls' })
        done()
        return
      }
      if (first.includes('MULTI')) {
        emitToolCall(0, 'call_a', 'base64_encode', '{"text":"你好"}')
        emitToolCall(1, 'call_b', 'hash', '{"text":"abc","algorithm":"SHA256"}')
        frame({}, { finish_reason: 'tool_calls' })
        done()
        return
      }
      if (first.includes('BADJSON')) {
        emitToolCall(0, 'call_bad', 'cidr_info', '{"cidr": ')
        frame({}, { finish_reason: 'tool_calls' })
        done()
        return
      }
      if (first.includes('UNKNOWN')) {
        emitToolCall(0, 'call_unknown', 'no_such_tool', '{}')
        frame({}, { finish_reason: 'tool_calls' })
        done()
        return
      }
      if (first.includes('TOOLERR')) {
        emitToolCall(0, 'call_err', 'base64_decode', '{"text":"!!!not base64!!!"}')
        frame({}, { finish_reason: 'tool_calls' })
        done()
        return
      }

      // 默认剧本：先调用 cidr_info
      emitToolCall(0, 'call_cidr', 'cidr_info', '{"cidr":"10.0.0.1/22"}')
      frame({}, { finish_reason: 'tool_calls' })
      done()
    })
  })
  return new Promise<{ server: http.Server; port: number; requests: typeof seenRequests }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port, requests: seenRequests }))
  })
}

/* ================= 驱动 ================= */

interface AgentEvents {
  events: ChatEvent[]
  ctl: ReturnType<typeof createChatController>
}

function harness(): AgentEvents {
  const events: ChatEvent[] = []
  const ctl = createChatController({ emit: (e) => events.push(e) })
  return { events, ctl }
}

const sendSpec = (baseUrl: string, text: string, extra: Partial<ChatSendSpec> = {}): ChatSendSpec => ({
  requestId: 'req-1',
  baseUrl,
  apiKey: 'k',
  model: 'mock-model',
  messages: [{ role: 'user', content: text }],
  tools: { server: { command: NODE, args: [SERVER] }, maxRounds: 8 },
  ...extra,
})

const of = <T extends ChatEvent['type']>(events: ChatEvent[], type: T): Extract<ChatEvent, { type: T }>[] =>
  events.filter((e) => e.type === type) as Extract<ChatEvent, { type: T }>[]

/* ================= 主流程 ================= */

const watchdog = setTimeout(() => {
  console.error('\n错误: 冒烟脚本超时（120s），可能有用例没结束')
  process.exit(1)
}, 120_000)

async function main(): Promise<void> {
  console.log('工具调用循环（agent）冒烟')

  ok('被测工具服务端存在', existsSync(SERVER), SERVER)
  if (!existsSync(SERVER)) {
    console.error('  请先执行 npm run build:mcp')
    clearTimeout(watchdog)
    process.exit(1)
  }

  const { server: model, port, requests } = await startModel()
  const baseUrl = `http://127.0.0.1:${port}/v1`

  try {
    /* ---------- 基本闭环 ---------- */
    {
      const { events, ctl } = harness()
      const res = ctl.send(sendSpec(baseUrl, '算一下子网'))
      eq('send 接受请求', res.ok, true)

      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const done = of(events, 'done')[0]
      ok('跑到了 done', !!done, events.map((e) => e.type).join(','))
      eq('只发一次 start', of(events, 'start').length, 1)
      eq('跑了两轮（调工具 + 给答案）', done?.rounds, 2)

      const ready = of(events, 'toolsReady')[0]
      eq('工具清单里有全部能力', ready?.tools.length, MCP_TOOLS.length)
      ok('清单里带了工具名与说明', ready?.tools.some((t) => t.name === 'cidr_info' && t.description.length > 0))

      const rounds = of(events, 'round')
      eq('round 事件按顺序编号', rounds.map((r) => r.round).join(','), '1,2')

      const call = of(events, 'toolCall')[0]
      eq('解析出工具名（分片拼接正确）', call?.call.name, 'cidr_info')
      eq('解析出完整参数（跨帧拼接正确）', call?.call.args, '{"cidr":"10.0.0.1/22"}')

      const result = of(events, 'toolResult')[0]
      eq('工具真的执行成功了', result?.result.ok, true)
      includes('结果是真实工具算出来的', result?.result.text ?? '', '10.0.0.0/22')
      includes('结果里带广播地址', result?.result.text ?? '', '10.0.3.255')
      ok('记录了工具耗时', (result?.result.durationMs ?? -1) >= 0)

      const text = of(events, 'delta').map((d) => d.text).join('')
      includes('最终回答渲染出来了', text, '收到 1 个工具结果：call_cidr')

      // 关键：喂回模型的消息形态必须正确，否则真实服务端会报错
      const second = requests[1]
      ok('第二轮把 assistant.tool_calls 回填了', Array.isArray(second?.messages.find((m) => m.role === 'assistant')?.tool_calls))
      eq('第二轮带上了 role=tool 的结果', second?.messages.filter((m) => m.role === 'tool').length, 1)
      eq('tool 消息用的 tool_call_id 与调用一致', second?.messages.find((m) => m.role === 'tool')?.tool_call_id, 'call_cidr')
      includes('tool 结果里是真实数据', String(second?.messages.find((m) => m.role === 'tool')?.content ?? ''), '10.0.0.0/22')
      ok('第一轮就把工具清单发给了模型', (requests[0]?.tools?.length ?? 0) === MCP_TOOLS.length)
      eq('工具定义用的是 OpenAI 形态', requests[0]?.tools?.[0]?.type, 'function')
      ok('工具定义带 description 与 parameters', !!requests[0]?.tools?.[0]?.function?.description && !!requests[0]?.tools?.[0]?.function?.parameters)
      eq('最终回答里 usage 被记账', done?.meta.usage?.totalTokens, 120)
    }

    /* ---------- 一轮里调多个工具 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'MULTI: 两个都算一下'))
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const calls = of(events, 'toolCall')
      eq('两个工具调用都被解析出来', calls.length, 2)
      eq('保持模型给的顺序', calls.map((c) => c.call.name).join(','), 'base64_encode,hash')
      const results = of(events, 'toolResult')
      eq('两个都执行了', results.length, 2)
      eq('base64 结果正确', results[0]?.result.text, '5L2g5aW9')
      includes('hash 结果正确', results[1]?.result.text ?? '', 'ba7816bf8f01cfea414140de5dae2223')
    }

    /* ---------- 模型给了非法 JSON 参数 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'BADJSON: 试一下'))
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const results = of(events, 'toolResult')
      ok('非法参数被识别为工具错误', results[0]?.result.isError === true)
      includes('错误信息里带上原始参数，便于模型自纠', results[0]?.result.text ?? '', '参数解析失败')
      const done = of(events, 'done')[0]
      eq('拿到报错后模型还能继续并收尾', done?.rounds, 3)
      const second = of(events, 'toolResult')[1]
      eq('模型改正后的调用成功了', second?.result.ok, true)
      includes('改正后结果正确', second?.result.text ?? '', '192.168.0.0/24')
    }

    /* ---------- 工具不存在 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'UNKNOWN: 试一下'))
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const r = of(events, 'toolResult')[0]
      eq('未知工具不算成功', r?.result.ok, false)
      includes('错误说明了原因（本地判定，不再白发 RPC）', r?.result.text ?? '', '未知工具')
      ok('仍然走到了 done（不是整轮失败）', of(events, 'done').length === 1)
    }

    /* ---------- 工具自己报错 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'TOOLERR: 试一下'))
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const r = of(events, 'toolResult')[0]
      eq('协议层是成功的', r?.result.ok, true)
      eq('工具自己标了错', r?.result.isError, true)
      includes('把工具的原话带回去了', r?.result.text ?? '', 'INVALID_BASE64')
    }

    /* ---------- 轮数上限 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'LOOP: 停不下来', { tools: { server: { command: NODE, args: [SERVER] }, maxRounds: 3 } }))
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 40000)
      const done = of(events, 'done')[0]
      eq('在轮数上限处停下', done?.rounds, 3)
      eq('结束原因标明是轮数上限', done?.meta.finishReason, 'max_rounds')
      eq('每轮都真的调了工具', of(events, 'toolCall').length, 3)
      ok('没有无休止地循环', of(events, 'toolCall').length <= 3)
    }

    /* ---------- 工具白名单 ---------- */
    {
      const { events, ctl } = harness()
      const spec = sendSpec(baseUrl, '随便算点啥')
      spec.tools = { server: { command: NODE, args: [SERVER] }, allow: ['cidr_info', 'base64_encode'] }
      ctl.send(spec)
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const ready = of(events, 'toolsReady')[0]
      eq('只把白名单里的工具给了模型', ready?.tools.length, 2)
      // 顺序跟服务端目录一致，不假设白名单的书写顺序
      eq('白名单内容正确', [...(ready?.tools.map((t) => t.name) ?? [])].sort().join(','), 'base64_encode,cidr_info')
      ok('请求里也只发了这两项', (requests[requests.length - 1]?.tools?.length ?? 0) === 2)
    }

    /* ---------- 取消 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'LOOP: 停不下来', { tools: { server: { command: NODE, args: [SERVER] }, maxRounds: 20 } }))
      await waitFor(() => of(events, 'toolResult').length >= 1, 30000)
      const stopped = ctl.abort()
      eq('取消返回 true', stopped, true)
      await waitFor(() => events.some((e) => e.type === 'error' || e.type === 'done'), 10000)
      const err = of(events, 'error')[0]
      eq('取消走 error 事件但带 ABORTED 码', err?.code, 'ABORTED')
      eq('取消后 isActive 为假', ctl.isActive(), false)

      // 关键：取消之后循环必须真的停住，而不是继续偷偷跑下一轮
      const atStop = of(events, 'toolCall').length
      await new Promise((resolve) => setTimeout(resolve, 500))
      eq('取消后不再产生新的工具调用', of(events, 'toolCall').length, atStop)
      const marks = events.map((e) => e.type).join(',')
      ok('取消是最后一个终止事件', marks.endsWith('error'), marks.slice(-80))
    }

    /* ---------- 没配工具服务端时不该走 agent ---------- */
    {
      const { events, ctl } = harness()
      const spec = sendSpec(baseUrl, '纯对话')
      delete spec.tools
      ctl.send(spec)
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      eq('不发 toolsReady', of(events, 'toolsReady').length, 0)
      eq('不发 round', of(events, 'round').length, 0)
      // 纯对话路径下假服务端的剧本仍是「先调工具」，但没给 tools 时模型会照剧本发 content
      ok('仍然完成了这一轮', of(events, 'done').length === 1 || of(events, 'error').length === 1)
    }

    /* ---------- 工具服务端起不来 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, '随便算点啥', { tools: { server: { command: 'definitely-not-a-real-command-xyz', args: [] } } }))
      await waitFor(() => events.some((e) => e.type === 'error' || e.type === 'done'), 30000)
      const err = of(events, 'error')[0]
      ok('工具服务端起不来时给出错误', !!err, events.map((e) => e.type).join(','))
      ok('错误信息指向启动失败', /启动失败|ENOENT/.test(err?.message ?? ''), err?.message)
    }

    /* ---------- 多工具源：合并、重名加后缀、部分失败不炸 ---------- */
    {
      const { events, ctl } = harness()
      ctl.send(sendSpec(baseUrl, 'LOOP: 多源', {
        tools: {
          servers: [
            { label: 'builtin', command: NODE, args: [SERVER] },
            { label: 'broken', command: 'definitely-not-a-real-command-xyz', args: [] },
            { label: 'dup', command: NODE, args: [SERVER] },
          ],
          maxRounds: 8,
        },
      }))
      await waitFor(() => events.some((e) => e.type === 'done' || e.type === 'error'), 30000)
      const ready = of(events, 'toolsReady')[0]
      const names = ready?.tools.map((t) => t.name) ?? []
      ok('重名工具自动加后缀', names.some((n) => n.endsWith('_2')), names.slice(0, 6).join(','))
      ok('先连的源拿到干净名字', names.includes('cidr_info'))
      const notice = of(events, 'notice')[0]
      includes('部分工具源失败有提示', notice?.text ?? '', 'broken')
      ok('单个源失败不拖垮对话', of(events, 'done').length === 1, events.map((e) => e.type).join(','))
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
