/**
 * 对话页拆分窗格 —— 纯逻辑验收。
 * 树操作 / fan-out / 事件归组 / 多轮累积 / 持久化，全部用假数据驱动。
 */
import {
  MAX_HISTORY_MESSAGES,
  MAX_PANES,
  applyPaneEvent,
  assignProfile,
  beginFanOut,
  closePane,
  countLeaves,
  leafIds,
  loadPaneSession,
  newPaneSession,
  paneMetrics,
  serializePanes,
  splitPane,
  type PaneSession,
} from '../src/lib/chat-panes'
import type { ChatEvent, ChatMeta } from '../src/lib/chat-types'

let pass = 0
const fail: string[] = []
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
  } else {
    fail.push(`${name}${detail ? ` —— ${detail}` : ''}`)
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, String(got) === String(want), `got=${String(got)} want=${String(want)}`)
}

const prof = (id: string, model = `${id}-model`) => ({
  id,
  label: '',
  baseUrl: ' https://api.x.com/v1 ',
  apiKey: ' k ',
  model: ` ${model} `,
})

let seq = 0
const rid = (): string => `req-${++seq}`
const pid = (): string => `pane-${++seq}`

/** 造一个 1×2 横向布局：左叶绑 m1，右叶绑 m2 */
function twoPanes(): { s: PaneSession; a: string; b: string } {
  let s = newPaneSession()
  const a = leafIds(s.tree)[0]
  s = splitPane(s, a, 'row', pid)!
  const b = leafIds(s.tree).find((x) => x !== a)!
  s = assignProfile(s, a, 'm1')
  s = assignProfile(s, b, 'm2')
  return { s, a, b }
}

const metaOf = (totalMs: number, tokens: number): ChatMeta => ({
  ttfbMs: 10,
  firstTokenMs: 120,
  totalMs,
  chunks: 2,
  chars: 2,
  reasoningChars: 0,
  usage: { promptTokens: 5, completionTokens: tokens, totalTokens: 5 + tokens },
  finishReason: 'stop',
  model: 'm',
  toolCalls: [],
})

/* ================= 树操作 ================= */

{
  const s = newPaneSession()
  eq('初始单叶', countLeaves(s.tree), 1)
  const root = leafIds(s.tree)[0]
  ok('初始叶有 runtime', !!s.panes[root] && s.panes[root].status === 'idle')

  const s2 = splitPane(s, root, 'row', pid)!
  eq('横拆后两叶', countLeaves(s2.tree), 2)
  ok('原叶保留 id 与绑定', leafIds(s2.tree).includes(root))
  const other = leafIds(s2.tree).find((x) => x !== root)!
  ok('新叶无模型绑定', findProfileId(s2, other) === null)
  ok('新叶有默认 runtime', !!s2.panes[other])

  const s3 = splitPane(s2, other, 'col', pid)!
  eq('纵拆再+1', countLeaves(s3.tree), 3)

  ok('拆分不存在的叶 → null', splitPane(s3, 'nope', 'row', pid) === null)

  // 拆到上限：3 → 8 共 5 次
  let cur = s3
  let n = countLeaves(cur.tree)
  while (n < MAX_PANES) {
    cur = splitPane(cur, leafIds(cur.tree)[0], 'row', pid)!
    n = countLeaves(cur.tree)
  }
  ok(`达到 ${MAX_PANES} 上限`, n === MAX_PANES)
  ok('超限拆分被拒 → null', splitPane(cur, leafIds(cur.tree)[0], 'row', pid) === null)

  const s4 = closePane(s3, other)!
  eq('关叶后坍缩回两叶', countLeaves(s4.tree), 2)
  ok('被关叶的 runtime 被清理', !s4.panes[other])
  ok('剩余叶保留 runtime', !!s4.panes[root])

  ok('关最后一叶 → null', closePane(newPaneSession(), leafIds(newPaneSession().tree)[0]) === null)
  ok('关不存在的叶 → null', closePane(s4, 'nope') === null)

  function findProfileId(sess: PaneSession, id: string): string | null {
    const walk = (n: PaneSession['tree']): string | null =>
      n.kind === 'leaf'
        ? n.id === id
          ? n.profileId
          : null
        : (walk(n.children[0]) ?? walk(n.children[1]))
    return walk(sess.tree)
  }
}

/* ================= fan-out ================= */

{
  const { s, a } = twoPanes()
  const profiles: Record<string, ReturnType<typeof prof>> = { m1: prof('m1'), m2: prof('m2') }
  const r = beginFanOut(s, ' 你好 ', (id) => profiles[id] ?? null, rid)

  eq('两叶各得一条 spec', r.specs.length, 2)
  ok('requestId 唯一', r.specs[0].requestId !== r.specs[1].requestId)
  const sa = r.specs.find((x) => x.paneId === a)!
  ok('spec 携带本叶 requestId', sa.spec.requestId === sa.requestId)
  ok('三件套 trim', sa.spec.baseUrl === 'https://api.x.com/v1' && sa.spec.model === 'm1-model')
  eq('消息 = 历史+新问题', sa.spec.messages.length, 1)
  eq('用户消息 trim', sa.spec.messages[0].content, '你好')
  ok('纯文本路径不带工具', sa.spec.tools === null)

  ok('发送后用户消息落历史', r.session.panes[a].history.at(-1)?.content === '你好')
  eq('发送后状态 pending', r.session.panes[a].status, 'pending')
  ok('activeRequestId 挂上', r.session.panes[a].activeRequestId === sa.requestId)

  // 未配置模型的叶不参与
  let s2 = newPaneSession()
  const only = leafIds(s2.tree)[0]
  s2 = splitPane(s2, only, 'row', pid)!
  const blank = leafIds(s2.tree).find((x) => x !== only)!
  s2 = assignProfile(s2, only, 'm1')
  const r2 = beginFanOut(s2, 'q', (id) => profiles[id] ?? null, rid)
  eq('空叶不 fan-out', r2.specs.length, 1)
  eq('空叶状态不变', r2.session.panes[blank].status, 'idle')

  // 空问题不发
  const r3 = beginFanOut(s, '   ', () => null, rid)
  eq('空白问题零 spec', r3.specs.length, 0)
  ok('空白问题不改状态', r3.session.panes[a].status === 'idle')
}

/* ================= 事件归组与多轮累积 ================= */

{
  const { s, a, b } = twoPanes()
  const profiles = { m1: prof('m1'), m2: prof('m2') }
  const r = beginFanOut(s, 'Q1', (id) => profiles[id] ?? null, rid)
  const ra = r.specs.find((x) => x.paneId === a)!.requestId
  const rb = r.specs.find((x) => x.paneId === b)!.requestId

  let sess = r.session
  const ev = (e: ChatEvent): void => {
    sess = applyPaneEvent(sess, e)
  }
  ok(
    '不认识 requestId 原样返回',
    applyPaneEvent(sess, { type: 'start', requestId: 'zzz' }) === sess,
  )

  ev({ type: 'start', requestId: ra })
  ev({ type: 'start', requestId: rb })
  ev({ type: 'delta', requestId: rb, text: '乙', kind: 'content', atMs: 0 })
  ev({ type: 'delta', requestId: ra, text: '甲', kind: 'content', atMs: 0 })
  eq('交错 delta 不错窗（a）', sess.panes[a].text, '甲')
  eq('交错 delta 不错窗（b）', sess.panes[b].text, '乙')
  eq('start 后 streaming', sess.panes[a].status, 'streaming')

  ev({ type: 'done', requestId: ra, meta: metaOf(900, 2) })
  eq('done → 完成', sess.panes[a].status, 'done')
  eq('assistant 落历史', sess.panes[a].history.at(-1)?.role, 'assistant')
  eq('历史内容=累积文本', sess.panes[a].history.at(-1)?.content, '甲')
  eq('totalMs 用服务端值', sess.panes[a].totalMs, 900)
  ok('done 后摘掉 activeRequestId', sess.panes[a].activeRequestId === null)
  eq('b 仍在流', sess.panes[b].status, 'streaming')

  // 第二轮追问：上下文应含两轮
  const r2 = beginFanOut(sess, 'Q2', (id) => profiles[id] ?? null, rid)
  const sa2 = r2.specs.find((x) => x.paneId === a)!
  eq('第二轮消息数=3（u/a/u）', sa2.spec.messages.length, 3)
  eq('第二轮末条=Q2', sa2.spec.messages.at(-1)?.content, 'Q2')
  ok(
    '流式中的 b 也收到 Q2',
    r2.specs.some((x) => x.paneId === b),
  )

  // 取消不是失败
  let s3 = r2.session
  const rc = r2.specs.find((x) => x.paneId === b)!.requestId
  s3 = applyPaneEvent(s3, { type: 'error', requestId: rc, message: '已取消', code: 'ABORTED' })
  eq('ABORTED → aborted', s3.panes[b].status, 'aborted')
  ok('aborted 也摘 requestId', s3.panes[b].activeRequestId === null)

  let s4 = r2.session
  const rd = r2.specs.find((x) => x.paneId === a)!.requestId
  s4 = applyPaneEvent(s4, { type: 'error', requestId: rd, message: '401 Unauthorized' })
  eq('无码错误 → error', s4.panes[a].status, 'error')
  ok('错误信息保留', s4.panes[a].error.includes('401'))

  // 指标助手
  eq('paneMetrics tokens', paneMetrics(s4.panes[a]).tokens, null)
  eq('指标：已完成的窗有 tokens', paneMetrics(sess.panes[a]).tokens, 7)
}

/* ================= 历史上限 ================= */

{
  const init = twoPanes()
  let s = init.s
  const a = init.a
  const profiles = { m1: prof('m1'), m2: prof('m2') }
  // 反复发送+完成，把历史顶到超过上限
  for (let i = 0; i < 40; i++) {
    const r = beginFanOut(s, `q${i}`, (id) => profiles[id] ?? null, rid)
    s = r.session
    for (const sp of r.specs) {
      s = applyPaneEvent(s, { type: 'start', requestId: sp.requestId })
      s = applyPaneEvent(s, {
        type: 'delta',
        requestId: sp.requestId,
        text: 'x',
        kind: 'content',
        atMs: 0,
      })
      s = applyPaneEvent(s, { type: 'done', requestId: sp.requestId, meta: metaOf(1, 1) })
    }
  }
  ok(
    `历史截断到 ${MAX_HISTORY_MESSAGES}`,
    s.panes[a].history.length <= MAX_HISTORY_MESSAGES,
    `got=${s.panes[a].history.length}`,
  )
  // 截断保留最近轮次：末条是最近一条 assistant
  eq('截断后末条仍是回复', s.panes[a].history.at(-1)?.content, 'x')
}

/* ================= 持久化 ================= */

{
  const { s, a, b } = twoPanes()
  const profiles = { m1: prof('m1'), m2: prof('m2') }
  const r = beginFanOut(s, 'hi', (id) => profiles[id] ?? null, rid)
  let sess = applyPaneEvent(r.session, { type: 'start', requestId: r.specs[0].requestId })
  sess = applyPaneEvent(sess, {
    type: 'delta',
    requestId: r.specs[0].requestId,
    text: '部分回复',
    kind: 'content',
    atMs: 0,
  })

  const raw = serializePanes(sess)
  const back = loadPaneSession(raw)!
  eq('往返后叶数不变', countLeaves(back.tree), 2)
  eq('往返后历史保留', back.panes[a].history.at(-1)?.content, 'hi')
  eq('往返后流式文本保留', back.panes[a].text, '部分回复')
  eq('往返后另一叶状态保留', back.panes[b].status, 'pending')
  ok(
    '往返后再发可续',
    beginFanOut(back, 'next', (id) => profiles[id] ?? null, rid).specs.length === 2,
  )

  ok('坏 JSON → null', loadPaneSession('{oops') === null)
  ok('空串 → null', loadPaneSession('') === null)
  ok('版本不符 → null', loadPaneSession('{"version":99,"tree":{},"panes":{}}') === null)
  ok('缺 panes → null', loadPaneSession(JSON.stringify({ version: 1, tree: sess.tree })) === null)

  // 树中 runtime 缺失 → 补默认；多余 runtime → 丢弃
  const partial = JSON.parse(raw) as { tree: unknown; panes: Record<string, unknown> }
  delete partial.panes[b]
  partial.panes['ghost'] = {
    history: [],
    text: '',
    reasoningChars: 0,
    status: 'idle',
    error: '',
    startedAt: null,
    firstTokenMs: null,
    totalMs: null,
    usage: null,
    activeRequestId: null,
  }
  const healed = loadPaneSession(JSON.stringify(partial))!
  ok('缺 runtime 补默认', !!healed.panes[b] && healed.panes[b].status === 'idle')
  ok('幽灵 runtime 被丢弃', !healed.panes['ghost'])
}

/* ================= 结果 ================= */

console.log(`chat-panes: ${pass} passed, ${fail.length} failed`)
if (fail.length) {
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
