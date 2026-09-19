/**
 * 对话界面层的冒烟脚本。
 *
 * 被测的不是「我自己写的映射函数」——那是自说自话。这里驱动的是 **AI SDK 真实的
 * `Chat` 类**（`useChat` 内部用的就是它），只把最底层的 IPC 桥换成假的：
 * 于是「主进程事件 → 消息流片段 → 消息 parts / status」这条链路是被真协议检过的。
 *
 * 覆盖：
 *   1. 正文与思考交替时的部件顺序（SDK 要求 text-delta 前必须有 text-start）
 *   2. 完整一轮：text / reasoning / tool 部件与 metadata
 *   3. 用户取消：状态收回 ready、已收到的内容保留、上游被通知停止
 *   4. 发送失败：状态 error，且监听器不残留
 *   5. 历史压平（只带正文）与旧会话文件迁移（容错）
 *   6. Markdown 渲染：GFM 表格 / 代码块 / 行内代码 / javascript: 链接被清 / 原始 HTML 不执行
 *   7. 外链协议白名单
 *
 * 运行：npm run smoke:chatui
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// useChat 内部就是用它，这里直接驱动同一个类（它在 @ai-sdk/react 里导出）
import { Chat } from '@ai-sdk/react'
import type { ChatEvent, ChatSendSpec } from '../src/lib/chat-types'
import {
  chunksForEvent,
  createChunkState,
  legacyTurnsToUIMessages,
  messageMeta,
  messageReasoning,
  messageText,
  messageToolParts,
  normalizeStoredTurns,
  reasoningStreaming,
  uiMessagesToHistory,
  type ChatUIMessage,
} from '../src/lib/chat-ui'
import { createIpcChatTransport } from '../src/lib/chat-transport'
import { safeExternalUrl } from '../src/lib/external-link'
import { I18nProvider } from '../src/lib/i18n'
import { Markdown } from '../src/components/Markdown'
import { MessageView } from '../src/components/chat/MessageView'

/* ================= 断言小工具 ================= */

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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/* ================= 浏览器环境桩 ================= */

const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  electronAPI: undefined,
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
}
;(globalThis as unknown as { document: unknown }).document = {
  documentElement: { classList: { add() {}, remove() {} }, style: {}, lang: '' },
  createElement: () => ({ value: '', innerHTML: '', select() {}, setAttribute() {} }),
  body: { appendChild() {}, removeChild() {} },
  execCommand: () => true,
}

/* ================= 假 IPC 桥 ================= */

interface FakeBridge {
  api: {
    send: (spec: ChatSendSpec) => Promise<{ ok: boolean; error?: string }>
    abort: () => Promise<boolean>
    onEvent: (cb: (evt: ChatEvent) => void) => () => void
  }
  specs: ChatSendSpec[]
  aborts: number
  listeners: () => number
}

type Script = (emit: (evt: ChatEvent) => void, requestId: string) => void | Promise<void>

function fakeBridge(opts: { script?: Script; fail?: string } = {}): FakeBridge {
  const cbs = new Set<(evt: ChatEvent) => void>()
  const out: FakeBridge = {
    specs: [],
    aborts: 0,
    listeners: () => cbs.size,
    api: {
      send: async (spec) => {
        out.specs.push(spec)
        if (opts.fail) return { ok: false, error: opts.fail }
        // 事件在下一次微任务里开始发：正好覆盖「订阅早于流创建」的缓冲路径
        queueMicrotask(() => { void opts.script?.((evt) => { for (const cb of cbs) cb(evt) }, spec.requestId ?? '') })
        return { ok: true, requestId: spec.requestId ?? '' }
      },
      abort: async () => { out.aborts++; return true },
      onEvent: (cb) => { cbs.add(cb); return () => { cbs.delete(cb) } },
    },
  }
  return out
}

function makeChat(bridge: FakeBridge, onFinish?: (info: { isAbort: boolean; isError: boolean }) => void): Chat<ChatUIMessage> {
  const transport = createIpcChatTransport({
    get api() { return bridge.api },
    buildSpec: (messages, requestId) => ({
      requestId, baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'demo-model', messages,
    }),
    onUserMessage: () => {},
    // 固定 id 便于断言
    nextId: (() => { let n = 0; return () => `id-${++n}` })(),
  })
  return new Chat<ChatUIMessage>({
    id: 'smoke',
    transport,
    generateId: () => 'msg-fixed',
    onFinish: onFinish ? (i) => onFinish({ isAbort: i.isAbort, isError: i.isError }) : undefined,
  })
}

const evt = {
  start: (requestId: string): ChatEvent => ({ type: 'start', requestId }),
  content: (requestId: string, text: string): ChatEvent => ({ type: 'delta', requestId, text, kind: 'content', atMs: 0 }),
  reasoning: (requestId: string, text: string): ChatEvent => ({ type: 'delta', requestId, text, kind: 'reasoning', atMs: 0 }),
}

/* ================= 1. 片段映射 ================= */

{
  const state = createChunkState()
  const seq = [
    ...chunksForEvent(state, evt.reasoning('r', '先想')),          // reasoning-start + delta
    ...chunksForEvent(state, evt.reasoning('r', '一下')),          // reasoning-delta
    ...chunksForEvent(state, evt.content('r', '答案是')),           // reasoning-end + text-start + delta
    ...chunksForEvent(state, evt.content('r', '42')),              // text-delta
    ...chunksForEvent(state, evt.start('r')),                     // start（不碰部件）
    ...chunksForEvent(state, { type: 'toolCall', requestId: 'r', round: 1, call: { id: 'c1', name: 'http_request', args: '{"url":"http://x"}' } }),
    ...chunksForEvent(state, evt.content('r', '结论')),             // text-start + delta
  ]
  const kinds = seq.map((c) => c.type)
  eq(kinds[0], 'reasoning-start', '思考块先开 reasoning-start')
  eq(kinds[1], 'reasoning-delta', '接着是 reasoning-delta')
  ok(kinds.includes('reasoning-end'), '切到正文前收尾思考块')
  ok(kinds.indexOf('text-start') < kinds.indexOf('text-delta'), 'text-delta 之前必有 text-start')
  ok(kinds.indexOf('reasoning-start') < kinds.indexOf('reasoning-end'), '思考块有始有终')
  // 每个 text-delta 都能在它之前找到同 id 的 text-start（SDK 内部按 id 取活动部件，取不到会抛）
  const open = new Set<string>()
  let deltaOk = true
  for (const c of seq) {
    if (c.type === 'text-start' || c.type === 'reasoning-start') open.add(c.id)
    if (c.type === 'text-end' || c.type === 'reasoning-end') open.delete(c.id)
    if ((c.type === 'text-delta' || c.type === 'reasoning-delta') && !open.has(c.id)) deltaOk = false
  }
  ok(deltaOk, '所有增量片段都落在已打开的部件里')
  const tool = seq.find((c) => c.type === 'tool-input-available')
  ok(!!tool && tool.dynamic === true, '工具调用以 dynamic-tool 形式下发（不需要预先声明工具集）')
  eq(kinds[kinds.indexOf('tool-input-available') - 1], 'text-end', '工具调用前先收尾正文')

  // 取消不发 error 片段：否则「已停止」会被渲染成「失败」
  const aborted = chunksForEvent(createChunkState(), { type: 'error', requestId: 'r', message: 'aborted', code: 'ABORTED' })
  eq(aborted.length, 1, '取消失败事件只产出一个片段')
  eq(aborted[0].type, 'abort', '取消映射成 abort 而不是 error')
  const realErr = chunksForEvent(createChunkState(), { type: 'error', requestId: 'r', message: 'boom' })
  eq(realErr[0].type, 'error', '真实错误仍然映射成 error')
}

/* ================= 2. 完整一轮 ================= */

await (async () => {
  let finish: { isAbort: boolean; isError: boolean } | null = null
  const bridge = fakeBridge({
    script: async (emit, rid) => {
      emit(evt.start(rid))
      emit(evt.reasoning(rid, '用户想要一个结果'))
      emit(evt.content(rid, '好的，'))
      emit(evt.content(rid, '我查一下。'))
      emit({ type: 'toolCall', requestId: rid, round: 1, call: { id: 'call-1', name: 'hash', args: '{"text":"abc"}' } })
      emit({ type: 'toolResult', requestId: rid, round: 1, result: { id: 'call-1', name: 'hash', ok: true, isError: false, text: '900150983cd24fb0', durationMs: 3 } })
      emit(evt.content(rid, '结果是 900150983cd24fb0。'))
      emit({
        type: 'done', requestId: rid, rounds: 2,
        meta: {
          ttfbMs: 12, firstTokenMs: 40, totalMs: 900, chunks: 5, chars: 20, reasoningChars: 11,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          finishReason: 'stop', model: 'demo-model', toolCalls: [],
        },
      })
    },
  })
  const chat = makeChat(bridge, (i) => { finish = i })
  await chat.sendMessage({ text: '帮我算个哈希' })

  const msgs = chat.messages
  eq(msgs.length, 2, '一轮对话收下两条消息')
  eq(msgs[0].role, 'user', '第一条是用户消息')
  eq(messageText(msgs[0]), '帮我算个哈希', '用户消息内容原样保留')
  const reply = msgs[1]
  eq(reply.role, 'assistant', '第二条是助手消息')
  eq(messageText(reply), '好的，我查一下。结果是 900150983cd24fb0。', '正文按顺序拼起来（工具调用前后的两段）')
  eq(messageReasoning(reply), '用户想要一个结果', '思考内容单独成块，不进正文')
  ok(!reasoningStreaming(reply), '一轮结束后思考块不再是流式状态（界面据此自动折叠）')

  const tools = messageToolParts(reply)
  eq(tools.length, 1, '工具调用被记录成一个部件')
  eq(tools[0].toolName, 'hash', '工具名保留')
  eq(tools[0].state, 'output-available', '有结果后状态是 output-available')
  eq(tools[0].output, '900150983cd24fb0', '工具结果进了部件')
  ok(JSON.stringify(tools[0].input) === '{"text":"abc"}', '工具参数被解析成结构化对象')

  const meta = messageMeta(reply)
  eq(meta.meta?.totalTokens ?? meta.meta?.usage?.totalTokens, 30, '本轮用量挂在消息 metadata 上（可随会话落盘）')
  eq(meta.rounds, 2, '轮数也一并记下')
  ok(!meta.error && !meta.aborted, '正常结束不带错误标记')
  eq(chat.status, 'ready', '结束后状态回到 ready')
  ok(!!finish && !finish.isError && !finish.isAbort, 'onFinish 报告正常收场')
  eq(bridge.listeners(), 0, '流结束后事件监听器被摘掉（不残留）')

  // 部件顺序：思考 → 正文 → 工具 → 正文
  const order = reply.parts.map((p) => (p.type === 'dynamic-tool' ? 'tool' : p.type)).filter((t) => t !== 'step-start')
  ok(JSON.stringify(order) === JSON.stringify(['reasoning', 'text', 'tool', 'text']), `部件按发生顺序排列（实际 ${order.join(',')}）`)

  // 发给主进程的 spec
  eq(bridge.specs.length, 1, '只发起了一次请求')
  eq(bridge.specs[0].model, 'demo-model', 'spec 带上当前模型')
  eq(bridge.specs[0].messages.length, 1, '首次请求只带用户消息')
  eq(bridge.specs[0].messages[0].content, '帮我算个哈希', '历史内容来自界面消息')
  typeof bridge.specs[0].requestId === 'string' && ok(bridge.specs[0].requestId!.startsWith('id-'), '请求 id 由 transport 生成并贯穿事件')
})()

/* ================= 3. 用户取消 ================= */

await (async () => {
  const gate = { open: false }
  const bridge = fakeBridge({
    script: async (emit, rid) => {
      emit(evt.start(rid))
      emit(evt.content(rid, '前一半'))
      // 等测试点「停止」之后再继续产出，确保取消发生在流中间
      while (!gate.open) await sleep(2)
      emit(evt.content(rid, '后一半'))
      emit({ type: 'error', requestId: rid, message: 'aborted', code: 'ABORTED' })
    },
  })
  const chat = makeChat(bridge)
  const done = chat.sendMessage({ text: '写长文' })
  await sleep(20)
  chat.stop()
  gate.open = true
  await done

  const reply = chat.messages[1]
  eq(chat.status, 'ready', '取消后状态收回 ready（不是 error）')
  eq(messageText(reply), '前一半', '已收到的内容保留，取消不吞字')
  eq(bridge.aborts, 1, '取消时通知主进程停掉上游请求')
  await sleep(20)
  eq(bridge.listeners(), 0, '取消后监听器不残留')
})()

/* ================= 4. 发送失败 ================= */

await (async () => {
  const bridge = fakeBridge({ fail: '接口地址为空' })
  const chat = makeChat(bridge)
  await chat.sendMessage({ text: '你好' })
  eq(chat.status, 'error', '发送失败后状态是 error')
  eq(chat.error?.message, '接口地址为空', '失败原因透传给界面')
  eq(bridge.listeners(), 0, '失败路径同样要摘掉监听器')
})()

/* ================= 4.5 出错后还能继续发送 ================= */

{
  // 发送失败会把状态置成 error；如果此后 sendMessage 直接被拒，
  // 界面上的「重试」就是个摆设。这条断言就是在守这个。
  const cbs = new Set<(e: ChatEvent) => void>()
  let calls = 0
  const chat = makeChat({
    specs: [], aborts: 0, listeners: () => cbs.size,
    api: {
      send: async (spec) => {
        calls++
        if (calls === 1) return { ok: false, error: '第一次就失败' }
        queueMicrotask(() => {
          const rid = spec.requestId ?? ''
          for (const cb of [...cbs]) cb(evt.start(rid))
          for (const cb of [...cbs]) cb(evt.content(rid, '第二次成功'))
          for (const cb of [...cbs]) cb({ type: 'done', requestId: rid, meta: {
            ttfbMs: 1, firstTokenMs: 1, totalMs: 2, chunks: 1, chars: 4, reasoningChars: 0,
            usage: null, finishReason: 'stop', model: null, toolCalls: [],
          } })
        })
        return { ok: true, requestId: spec.requestId ?? '' }
      },
      abort: async () => true,
      onEvent: (cb) => { cbs.add(cb); return () => { cbs.delete(cb) } },
    },
  })
  await chat.sendMessage({ text: '第一次' })
  eq(chat.status, 'error', '第一次发送失败后状态为 error')
  await chat.sendMessage({ text: '第二次' })
  eq(chat.status, 'ready', '出错后仍能继续发送（重试按钮不是摆设）')
  ok(chat.messages.length >= 3, `第二次的消息进了列表（实际 ${chat.messages.length} 条）`)
  const last = chat.messages[chat.messages.length - 1]
  eq(messageText(last), '第二次成功', '第二次的回复正常落到消息里')
}

/* ================= 5. 历史压平与旧格式迁移 ================= */

{
  const withTool: ChatUIMessage = {
    id: 'a1', role: 'assistant',
    parts: [
      { type: 'reasoning', id: 'r1', text: '内心戏', state: 'done' },
      { type: 'text', text: '正文一' },
      { type: 'dynamic-tool', toolCallId: 'c1', toolName: 'hash', state: 'output-available', input: {}, output: 'x' },
      { type: 'text', text: '正文二' },
    ],
  }
  const history = uiMessagesToHistory([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '问题' }] }, withTool])
  eq(history.length, 2, '压平后每个角色一条')
  eq(history[0].content, '问题', '用户文本保留')
  eq(history[1].content, '正文一正文二', '助手只带正文：思考与工具调用交给主进程的 agent 循环，不能重复塞')
  ok(!JSON.stringify(history).includes('内心戏'), '思考内容不会被当成历史发回去')

  const legacy = legacyTurnsToUIMessages([
    { id: 'u-1', role: 'user', blocks: [{ kind: 'text', text: '老会话的问题' }], status: 'done' },
    {
      id: 'a-1', role: 'assistant', status: 'stopped', rounds: 3,
      error: '网络断了',
      meta: { ttfbMs: 1, firstTokenMs: 2, totalMs: 3, chunks: 1, chars: 1, reasoningChars: 0, usage: null, finishReason: null, model: null, toolCalls: [] },
      blocks: [
        { kind: 'reasoning', text: '旧思考' },
        { kind: 'text', text: '旧正文' },
        { kind: 'tool', call: { id: 'c9', name: 'jwt_decode', args: 'not-json' }, result: { ok: true, isError: false, text: '结果', durationMs: 1 } },
      ],
    },
    { role: 'assistant' },                        // 坏数据：没有 blocks
    null,                                          // 坏数据：压根不是对象
    { role: 'tool', blocks: [] },                  // 坏数据：角色不认识
  ])
  eq(legacy.length, 2, '旧格式迁移只认能认的条目，坏数据跳过而不是整份炸掉')
  eq(messageText(legacy[1]), '旧正文', '旧正文转成 text 部件')
  eq(messageReasoning(legacy[1]), '旧思考', '旧思考转成 reasoning 部件')
  const lt = messageToolParts(legacy[1])[0]
  eq(lt.state, 'output-available', '旧工具调用带结果')
  eq(lt.input, 'not-json', '旧参数不是合法 JSON 时保留原文，不丢信息')
  const lm = messageMeta(legacy[1])
  eq(lm.aborted, true, '旧会话的「已停止」状态迁移过来')
  eq(lm.error, '网络断了', '旧错误也迁移过来')
  eq(lm.rounds, 3, '旧轮数迁移过来')

  eq(normalizeStoredTurns([withTool]).length, 1, '新格式原样返回')
  eq(normalizeStoredTurns([{ id: 'x', role: 'assistant', blocks: [{ kind: 'text', text: 't' }] }]).length, 1, '旧格式走迁移分支')
  eq(normalizeStoredTurns([]).length, 0, '空会话返回空数组')
  eq(normalizeStoredTurns(null as unknown as unknown[]).length, 0, '非数组输入不炸')
}

/* ================= 6. Markdown 渲染 ================= */

{
  const md = [
    '# 标题',
    '',
    '| 列 A | 列 B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '- [x] 已完成',
    '',
    '```ts',
    'const a: number = 1',
    '```',
    '',
    '行内 `code` 与 [链接](javascript:alert(1)) 还有 [正常链接](https://example.com/doc)',
    '',
    '<img src=x onerror="alert(1)">',
  ].join('\n')

  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(Markdown, { text: md })),
  )

  ok(html.includes('<table>'), 'GFM 表格被渲染')
  ok(html.includes('<th>列 A</th>'), '表头单元格正确')
  ok(html.includes('type="checkbox"'), 'GFM 任务列表被渲染')
  ok(html.includes('hljs') && html.includes('language-ts'), '围栏代码块带语言标记并做了高亮')
  ok(html.includes('TS') || html.includes('ts'), '代码块显示语言名')
  ok(html.includes('md-inline-code'), '行内代码走独立样式')
  ok(html.includes('md-code-bar'), '代码块带工具栏（复制按钮所在行）')
  eq(html.includes('javascript:'), false, 'javascript: 链接被清掉（XSS 防线）')
  ok(html.includes('https://example.com/doc'), '正常外链保留')
  // 「未启用 rehype-raw」的证据是：没有生成真的 <img> 元素，HTML 源码被转义成了文本
  eq(html.includes('<img'), false, '原始 HTML 不生成真实元素（未启用 rehype-raw）')
  ok(html.includes('&lt;img src=x') && html.includes('&quot;'), '原始 HTML 被转义成纯文本显示')
  // SSR 下拿不到 electronAPI，链接点击不该抛
  ok(html.includes('<h1>标题</h1>'), '标题层级正常')
}

/* ================= 7. 思考块的展开 / 自动折叠 ================= */

{
  const renderMsg = (live: boolean, state: 'streaming' | 'done'): string => renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, {
        live,
        price: null,
        msg: {
          id: 'm1', role: 'assistant',
          parts: [
            { type: 'reasoning', id: 'r1', text: '这是思考内容', state },
            { type: 'text', text: '这是正文' },
          ],
        } as ChatUIMessage,
      }),
    ),
  )

  const streaming = renderMsg(true, 'streaming')
  ok(streaming.includes('aria-expanded="true"'), '流式输出中：思考块自动展开')
  ok(streaming.includes('这是思考内容'), '流式输出中：思考内容可见')
  ok(streaming.includes('思考中'), '流式输出中：标出「思考中」')

  const done = renderMsg(false, 'done')
  ok(done.includes('aria-expanded="false"'), '这一轮结束后：思考块自动折叠')
  eq(done.includes('这是思考内容'), false, '折叠后思考内容不占版面')
  ok(done.includes('展开思考'), '折叠后留一个展开入口，随时能回看')
  ok(done.includes('这是正文'), '正文不受影响')

  // 已经结束的旧消息（不在流式）即便部件状态还写着 streaming，也不该展开 ——
  // 中断的会话里部件状态会永远停在 streaming
  const stale = renderMsg(false, 'streaming')
  ok(stale.includes('aria-expanded="false"'), '非当前流式的消息不展开（中断的部件状态不会让它一直张着）')
}

/* ================= 8. 外链白名单 ================= */

{
  eq(safeExternalUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1', 'https 放行')
  eq(safeExternalUrl('  http://127.0.0.1:8080/x  '), 'http://127.0.0.1:8080/x', 'http 放行（内网地址照开）')
  eq(safeExternalUrl('mailto:a@b.com'), 'mailto:a@b.com', 'mailto 放行')
  eq(safeExternalUrl('javascript:alert(1)'), null, 'javascript: 拒绝')
  eq(safeExternalUrl('file:///etc/passwd'), null, 'file: 拒绝')
  eq(safeExternalUrl('data:text/html,<script>x</script>'), null, 'data: 拒绝')
  eq(safeExternalUrl('vscode://x'), null, '未知协议拒绝')
  eq(safeExternalUrl('https://user:pass@evil.test/'), null, '带账号密码的地址拒绝（防钓鱼）')
  eq(safeExternalUrl(''), null, '空串拒绝')
  eq(safeExternalUrl(null), null, '非字符串拒绝')
  eq(safeExternalUrl(`https://e.test/${'a'.repeat(3000)}`), null, '超长地址拒绝')
}

/* ================= 结果 ================= */

console.log(`\n对话界面：${pass} 项通过 / ${fails.length} 项失败`)
if (fails.length) {
  console.error('\n失败项：')
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✔ 事件映射、消息部件、取消、迁移、Markdown 与外链白名单均符合预期')
