/**
 * 多模型对比 —— 归组逻辑验收。
 * 用假事件序列驱动 applyCompareEvent，断言列状态机与指标归集。
 */
import {
  allReady,
  applyCompareEvent,
  buildCompareSpec,
  columnLabel,
  newColumn,
  type CompareColumn,
} from '../src/lib/chat-compare'
import type { ChatEvent } from '../src/lib/chat-types'

let pass = 0
const fail: string[] = []
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++ } else { fail.push(`${name}${detail ? ` —— ${detail}` : ''}`) }
}

const cols = (): CompareColumn[] => [
  newColumn('a', 'DeepSeek', 'deepseek-chat'),
  newColumn('b', 'GLM', 'glm-4'),
]

/* ================= spec 构建 ================= */

{
  const p = { id: 'm1', label: '', baseUrl: ' https://api.x.com/v1 ', apiKey: ' k ', model: ' m1-model ' }
  const s = buildCompareSpec(p, '你好', 'cmp-1')
  eq('三件套都 trim', `${s.baseUrl}|${s.apiKey}|${s.model}`, 'https://api.x.com/v1|k|m1-model')
  ok('单条用户消息', s.messages.length === 1 && s.messages[0].role === 'user' && s.messages[0].content === '你好')
  ok('纯文本路径：不带工具', s.tools === null)
  ok('带 requestId', s.requestId === 'cmp-1')
  ok('请求 usage', s.includeUsage === true)

  function eq(name: string, got: unknown, want: unknown): void {
    ok(name, String(got) === String(want), `got=${String(got)} want=${String(want)}`)
  }
}

/* ================= 归组状态机 ================= */

{
  let c = cols()
  ok('不认识的事件被忽略', applyCompareEvent(c, { type: 'start', requestId: 'zzz' } as ChatEvent) === c)

  c = applyCompareEvent(c, { type: 'start', requestId: 'a' })
  ok('start → streaming', c[0].status === 'streaming')
  ok('start 记录起点', c[0].startedAt !== null)
  ok('另一列不受影响', c[1].status === 'pending' && c[1].startedAt === null)

  c = applyCompareEvent(c, { type: 'delta', requestId: 'a', text: '你', kind: 'content', atMs: 0 })
  c = applyCompareEvent(c, { type: 'delta', requestId: 'a', text: '好', kind: 'content', atMs: 0 })
  c = applyCompareEvent(c, { type: 'delta', requestId: 'a', text: '<think>', kind: 'reasoning', atMs: 0 })
  eq('content 累积成正文', c[0].text, '你好')
  ok('reasoning 只计字符不进正文', c[0].reasoningChars === 7 && c[0].text === '你好')
  ok('首条 content 记了首字', c[0].firstTokenMs !== null)

  c = applyCompareEvent(c, { type: 'toolCall', requestId: 'a', round: 1, call: { id: 'x', name: 'n', args: '{}' } })
  ok('工具事件被忽略（纯文本对比）', c[0].text === '你好' && c[0].status === 'streaming')

  c = applyCompareEvent(c, { type: 'done', requestId: 'a', meta: { ttfbMs: 10, firstTokenMs: 120, totalMs: 900, chunks: 2, chars: 2, reasoningChars: 0, usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 }, finishReason: 'stop', model: 'deepseek-chat', toolCalls: [] } })
  eq('done → 完成', c[0].status, 'done')
  eq('totalMs 用服务端值', c[0].totalMs, 900)
  eq('tokens 归集', c[0].usage?.totalTokens, 7)

  // 取消不是失败
  c = applyCompareEvent(c, { type: 'start', requestId: 'b' })
  c = applyCompareEvent(c, { type: 'error', requestId: 'b', message: '已取消', code: 'ABORTED' })
  eq('ABORTED → aborted（非 error）', c[1].status, 'aborted')
  c = applyCompareEvent(c, { type: 'start', requestId: 'a' })
  c = applyCompareEvent(c, { type: 'error', requestId: 'a', message: '401 Unauthorized' })
  eq('无码错误 → error', c[0].status, 'error')
  includes('错误信息保留', c[0].error, '401')

  function includes(name: string, hay: string, needle: string): void {
    ok(name, hay.includes(needle), `hay=${hay}`)
  }
}

/* ================= 就绪检查与显示名 ================= */

{
  ok('空列表不可发', !allReady([]))
  ok('有未就绪档案不可发', !allReady([{ id: 'm', label: '', baseUrl: 'u', apiKey: '', model: 'x' }]))
  ok('全部就绪可发', allReady([{ id: 'm', label: '', baseUrl: 'u', apiKey: 'k', model: 'x' }]))
  eq('显示名回落模型名', columnLabel({ id: 'm', label: '', baseUrl: '', apiKey: '', model: 'glm-4' }), 'glm-4')
  eq('显示名优先用户命名', columnLabel({ id: 'm', label: '智谱', baseUrl: '', apiKey: '', model: 'glm-4' }), '智谱')
}

/* ================= 结果 ================= */

console.log(`chat-compare: ${pass} passed, ${fail.length} failed`)
if (fail.length) {
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
