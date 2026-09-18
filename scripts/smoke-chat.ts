/**
 * 流式对话链路端到端冒烟。
 *
 * 起一个本地假服务端扮演 OpenAI 兼容接口 + 一个真 HTTP 代理，然后断言：
 *   - SSE 是真的逐帧到达（不是收完再一次给），首字延迟 / 帧数 / 总时长都有值
 *   - 服务端给的 usage 被正确记账；不给 usage 时靠字符数兜底
 *   - reasoning_content（推理模型）与 content 分流
 *   - 网关不支持流式、直接吐整段 JSON 时能降级处理
 *   - 非法帧不打断整条流；服务端报错被翻译成人能看懂的一句话
 *   - 中途取消能立刻停下，且不会被当成失败
 *   - **经 HTTP 代理走的流式请求照样工作**（验证与 http_request 共用同一套连接逻辑）
 *
 * 只依赖 node 内置模块与 electron/main/chat.ts，不需要 electron，可在 CI 直接跑。
 */
import http from 'node:http'
import { chatStream, type ChatConfig, type ChatDeltaKind, type ChatMeta } from '../electron/main/chat'
import { createChatController } from '../electron/main/chat-ipc'
import type { ChatEvent, ChatSendSpec } from '../src/lib/chat-types'

/** 等一个条件成立，超时就放弃（不用 sleep 猜时长） */
function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = (): void => {
      if (cond() || Date.now() - started > timeoutMs) resolve()
      else setTimeout(tick, 10)
    }
    tick()
  })
}

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
  ok(name, haystack.includes(needle), `未在「${haystack.slice(0, 160)}」中找到 ${JSON.stringify(needle)}`)
}

/* ================= 假服务端 ================= */

interface ChatResult {
  text: string
  reasoning: string
  meta: ChatMeta | null
  error: string | null
  deltaCalls: number
  /** 每个 delta 到达的相对时刻，用来证明是流式而非一次性 */
  deltaTimes: number[]
}

const DELTA_TEXT = ['你好', '，这是', '一段', '流式', '输出']

function startUpstream() {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let payload: any = {}
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        /* ignore */
      }
      const mode: string = payload.model ?? 'stream'
      const sawStreamFlag = payload.stream === true
      const sawUsageFlag = !!payload.stream_options?.include_usage

      if (mode === 'error401') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }))
        return
      }
      if (mode === 'error429') {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }))
        return
      }
      if (mode === 'plain') {
        // 网关不支持流式：忽略 stream:true，直接回整段 JSON
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          model: 'fallback-model',
          choices: [{ message: { role: 'assistant', content: '整段返回的内容' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 },
        }))
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      const send = (obj: unknown, crlf = false): void => {
        res.write(`data: ${JSON.stringify(obj)}${crlf ? '\r\n\r\n' : '\n\n'}`)
      }
      const frame = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
        send({ model: 'mock-model', choices: [{ index: 0, delta, ...extra }] })
      }

      if (mode === 'reasoning') {
        frame({ reasoning_content: '先想一下' })
        frame({ reasoning_content: '……想好了' })
      }
      if (mode === 'crlf') {
        // 有的服务端用 \r\n 分行，解析器必须容错
        for (const t of DELTA_TEXT) frame({ content: t }, true)
        send({ model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, true)
        res.write('data: [DONE]\r\n\r\n')
        res.end()
        return
      }
      if (mode === 'badframe') {
        // 半截 JSON 与注释行都出现过，解析器不能因此断流
        res.write(': keep-alive comment\n\n')
        res.write('data: {"model":"mock-model","choices":[{"delta":{"content":"前半"'), res.write('}]\n\n')
      }

      let i = 0
      const tick = (): void => {
        if (i < DELTA_TEXT.length) {
          frame({ content: DELTA_TEXT[i] })
          i++
          setTimeout(tick, 12)
          return
        }
        frame({}, { finish_reason: 'stop' })
        if (mode === 'usage' && sawUsageFlag) {
          send({
            model: 'mock-model',
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
          })
        }
        res.write('data: [DONE]\n\n')
        res.end()
      }

      if (mode === 'slow') {
        // 只发两帧后挂住，用于验证取消
        frame({ content: '第一帧' })
        setTimeout(() => frame({ content: '第二帧' }), 30)
        return // 不 end，保持连接
      }
      tick()
      // 记录服务端看到的请求形态，供断言使用
      lastUpstream = { mode, sawStreamFlag, sawUsageFlag }
    })
  })
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port }))
  })
}

let lastUpstream: { mode: string; sawStreamFlag: boolean; sawUsageFlag: boolean } | null = null

/** 极简正向代理：只处理绝对 URI 形式的明文 http，用于验证流式也走代理 */
function startProxy() {
  const seen: string[] = []
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? '')
    let target: URL
    try {
      target = new URL(req.url ?? '')
    } catch {
      res.writeHead(400)
      res.end('bad absolute uri')
      return
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: Number(target.port || 80),
        method: req.method,
        path: target.pathname + target.search,
        headers: { ...req.headers, host: target.host },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      res.writeHead(502)
      res.end('proxy upstream error')
    })
    req.pipe(upstream)
  })
  return new Promise<{ server: http.Server; port: number; seen: string[] }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port, seen }))
  })
}

/* ================= 调用封装 ================= */

function callChat(
  overrides: Record<string, unknown>,
  onFirstDelta?: (abort: () => void, kind: ChatDeltaKind) => void,
): Promise<ChatResult> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let text = ''
    let reasoning = ''
    let deltaCalls = 0
    const deltaTimes: number[] = []
    let aborted = false

    let handle: { abort: () => void }
    try {
      handle = chatStream(
        {
          baseUrl: '',
          apiKey: 'sk-test',
          model: 'stream',
          messages: [{ role: 'user', content: '你好' }],
          ...overrides,
        } as ChatConfig,
        {
          onDelta: (d, kind) => {
            deltaCalls++
            deltaTimes.push(Date.now() - t0)
            if (kind === 'content') text += d
            else reasoning += d
            if (!aborted && onFirstDelta) {
              aborted = true
              onFirstDelta(() => handle.abort(), kind)
            }
          },
          onDone: (meta) => resolve({ text, reasoning, meta, error: null, deltaCalls, deltaTimes }),
          onError: (message) => resolve({ text, reasoning, meta: null, error: message, deltaCalls, deltaTimes }),
        },
      )
    } catch (e) {
      // 同步参数错误按契约直接抛出
      resolve({ text, reasoning, meta: null, error: (e as Error).message, deltaCalls, deltaTimes })
      return
    }
    void handle
  })
}

/* ================= 主流程 ================= */

const watchdog = setTimeout(() => {
  console.error('\n错误: 冒烟脚本超时（60s），可能存在未结束的流')
  process.exit(1)
}, 60_000)

async function main(): Promise<void> {
  console.log('流式对话链路冒烟')

  const { server: upstream, port } = await startUpstream()
  const { server: proxy, port: proxyPort, seen: proxySeen } = await startProxy()
  const baseUrl = `http://127.0.0.1:${port}/v1`

  try {
    /* ---------- 基本流式 ---------- */
    const basic = await callChat({ baseUrl, model: 'stream' })
    eq('无错误', basic.error, null)
    eq('拼接出完整正文', basic.text, DELTA_TEXT.join(''))
    ok('是逐帧到达而非一次性收完', basic.deltaCalls === DELTA_TEXT.length, `实际 ${basic.deltaCalls} 帧`)
    ok('末帧 finish_reason 被记录', basic.meta?.finishReason === 'stop', String(basic.meta?.finishReason))
    ok('TTFB 有值', (basic.meta?.ttfbMs ?? 0) > 0, String(basic.meta?.ttfbMs))
    ok('首字延迟有值', (basic.meta?.firstTokenMs ?? -1) >= 0, String(basic.meta?.firstTokenMs))
    ok('首字不晚于总时长', (basic.meta?.firstTokenMs ?? 0) <= (basic.meta?.totalMs ?? 0))
    ok('累计字符数正确', basic.meta?.chars === DELTA_TEXT.join('').length, String(basic.meta?.chars))
    ok('服务端返回的模型名被记录', basic.meta?.model === 'mock-model', String(basic.meta?.model))
    ok('请求带上了 stream 标记', lastUpstream?.sawStreamFlag === true)
    ok('请求带上了 stream_options.include_usage', lastUpstream?.sawUsageFlag === true)

    /* ---------- usage 记账 ---------- */
    const withUsage = await callChat({ baseUrl, model: 'usage' })
    eq('带 usage 时内容照常', withUsage.text, DELTA_TEXT.join(''))
    eq('prompt tokens', withUsage.meta?.usage?.promptTokens, 11)
    eq('completion tokens', withUsage.meta?.usage?.completionTokens, 22)
    eq('total tokens', withUsage.meta?.usage?.totalTokens, 33)
    ok('usage 帧不污染正文字符数', withUsage.meta?.chars === DELTA_TEXT.join('').length, String(withUsage.meta?.chars))

    /* ---------- 推理模型 ---------- */
    const reasoning = await callChat({ baseUrl, model: 'reasoning' })
    eq('推理内容单独分流', reasoning.reasoning, '先想一下……想好了')
    eq('正文与推理分开累计', reasoning.text, DELTA_TEXT.join(''))
    ok('推理长度单独统计', reasoning.meta?.reasoningChars === '先想一下……想好了'.length)

    /* ---------- 非流式降级 ---------- */
    const plain = await callChat({ baseUrl, model: 'plain' })
    eq('网关不支持流式时整段降级', plain.text, '整段返回的内容')
    eq('降级路径也记 usage', plain.meta?.usage?.totalTokens, 16)
    eq('降级路径记模型名', plain.meta?.model, 'fallback-model')

    /* ---------- 非法帧容错 ---------- */
    const bad = await callChat({ baseUrl, model: 'badframe' })
    eq('非法帧不打断整条流', bad.text, DELTA_TEXT.join(''))
    ok('非法帧不计入正文', !bad.text.includes('前半'))

    /* ---------- CRLF 分行 ---------- */
    const crlf = await callChat({ baseUrl, model: 'crlf' })
    eq('CRLF 分行同样能解析', crlf.text, DELTA_TEXT.join(''))

    /* ---------- 错误翻译 ---------- */
    const e401 = await callChat({ baseUrl, model: 'error401' })
    includes('401 翻译成鉴权失败', e401.error ?? '', '鉴权失败')
    includes('401 带出服务端原文', e401.error ?? '', 'Invalid API key')
    const e429 = await callChat({ baseUrl, model: 'error429' })
    includes('429 翻译成限流/余额', e429.error ?? '', '429')

    const badUrl = await callChat({ baseUrl: '', model: 'stream' })
    includes('空地址有明确报错', badUrl.error ?? '', '接口地址')

    /* ---------- 取消 ---------- */
    const aborted = await callChat({ baseUrl, model: 'slow' }, (abort) => abort())
    includes('取消后立即收场', aborted.error ?? '', '已取消')
    ok('取消不会把已收到的内容丢掉', aborted.text.length > 0, aborted.text)

    /* ---------- 经代理流式 ---------- */
    const viaProxy = await callChat({ baseUrl, model: 'stream', proxy: `http://127.0.0.1:${proxyPort}` })
    eq('经代理流式同样得到完整正文', viaProxy.text, DELTA_TEXT.join(''))
    ok('请求确实走了代理（绝对 URI）', proxySeen.some((u) => u.startsWith('http://127.0.0.1:')), proxySeen.join(' | ').slice(0, 120))
    ok('经代理同样逐帧到达', viaProxy.deltaCalls === DELTA_TEXT.length, String(viaProxy.deltaCalls))

    /* ---------- 自定义请求头 ---------- */
    const custom = await callChat({ baseUrl, model: 'stream', extraHeaders: [['api-key', 'custom-value']] })
    eq('自定义请求头不影响流式', custom.text, DELTA_TEXT.join(''))

    /* ---------- IPC 编排（createChatController） ---------- */
    const events: ChatEvent[] = []
    const ctl = createChatController({ emit: (e) => events.push(e) })

    const r1 = ctl.send({ requestId: 'req-a', baseUrl, apiKey: 'k', model: 'usage', messages: [{ role: 'user', content: 'hi' }] } as ChatSendSpec)
    eq('send 返回调用方给的 requestId', r1.requestId, 'req-a')
    eq('send 报告成功', r1.ok, true)
    ok('有流在跑时 isActive 为真', ctl.isActive())
    eq('start 事件先于任何 delta', events[0]?.type, 'start')
    ok('事件都带同一个 requestId', events.every((e) => e.requestId === 'req-a'), events.map((e) => e.requestId).join(','))

    await waitFor(() => events.some((e) => e.type === 'done'), 5000)
    const doneEvt = events.find((e) => e.type === 'done') as Extract<ChatEvent, { type: 'done' }>
    ok('done 事件带上了 meta', !!doneEvt?.meta)
    eq('done 之后不再有活跃流', ctl.isActive(), false)
    eq('abort 在无流时返回 false', ctl.abort(), false)

    const deltaEvts = events.filter((e) => e.type === 'delta') as Extract<ChatEvent, { type: 'delta' }>[]
    ok('delta 事件按到达顺序累积成完整正文', deltaEvts.map((d) => d.text).join('') === DELTA_TEXT.join(''))
    ok('delta 事件带时间戳', deltaEvts.every((d) => typeof d.atMs === 'number' && d.atMs >= 0))

    // 新请求顶掉旧的：不这么做会出现两条流同时往界面上打字
    events.length = 0
    ctl.send({ requestId: 'req-b', baseUrl, apiKey: 'k', model: 'slow', messages: [{ role: 'user', content: 'hi' }] } as ChatSendSpec)
    const second = ctl.send({ requestId: 'req-c', baseUrl, apiKey: 'k', model: 'stream', messages: [{ role: 'user', content: 'hi' }] } as ChatSendSpec)
    eq('第二条请求用的是自己的 id', second.requestId, 'req-c')
    await waitFor(() => events.some((e) => e.type === 'done' && e.requestId === 'req-c'), 5000)
    const abortedB = events.find((e) => e.type === 'error' && e.requestId === 'req-b') as Extract<ChatEvent, { type: 'error' }> | undefined
    ok('被顶掉的旧请求收到取消事件', !!abortedB, events.map((e) => `${e.type}:${e.requestId}`).join(' '))
    eq('取消事件的错误码可识别', abortedB?.code, 'ABORTED')
    ok('旧请求不再产生 delta', !events.some((e) => e.type === 'delta' && e.requestId === 'req-b'))

    // 参数不合法：要能同步给出错误事件，而不是让界面永远转圈
    events.length = 0
    const badReq = ctl.send({ requestId: 'req-d', baseUrl: '', apiKey: 'k', model: 'stream', messages: [] } as ChatSendSpec)
    eq('空地址时 send 不算成功', badReq.ok, false)
    eq('空地址时仍先给出 start', events[0]?.type, 'start')
    const errD = events.find((e) => e.type === 'error') as Extract<ChatEvent, { type: 'error' }> | undefined
    ok('空地址给出错误事件', !!errD)
    includes('空地址错误信息可读', errD?.message ?? '', '接口地址')
    eq('失败后不再有活跃流', ctl.isActive(), false)

    // 自动生成 id 时不能重复
    const auto1 = ctl.send({ baseUrl: '', apiKey: 'k', model: 'stream', messages: [] } as ChatSendSpec)
    const auto2 = ctl.send({ baseUrl: '', apiKey: 'k', model: 'stream', messages: [] } as ChatSendSpec)
    ok('未给 id 时自动生成且不重复', !!auto1.requestId && auto1.requestId !== auto2.requestId, `${auto1.requestId} vs ${auto2.requestId}`)
  } finally {
    upstream.close()
    proxy.close()
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
