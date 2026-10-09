/**
 * SSE 帧解析器（src/lib/sse-parser.ts）的断言。
 *
 * 流式解析的死亡区：chunk 边界劈在半行上、\r 与 \r\n 混用、多行 data、
 * 注释与未知字段——这里用跨包样例逐条钉住。
 *
 * 运行：npm run smoke:sse
 */
import { SseDecoder } from '../src/lib/sse-parser'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

/* ---------- 基本帧 ---------- */

{
  const d = new SseDecoder()
  const frames = d.push('data: hello\n\n')
  eq('单帧 data', frames.length, 1)
  eq('事件名缺省 message', frames[0].event, 'message')
  eq('data 剥除冒号后单个空格', frames[0].data, 'hello')
}
{
  const d = new SseDecoder()
  const frames = d.push('data:你好\n\n') // 冒号后无空格也不剥
  eq('冒号后无空格不剥', frames[0].data, '你好')
}
{
  const d = new SseDecoder()
  const frames = d.push('event: tick\ndata: 1\ndata: 2\n\n')
  eq('event 字段生效', frames[0].event, 'tick')
  eq('多行 data 合并 \\n', frames[0].data, '1\n2')
}
{
  const d = new SseDecoder()
  const frames = d.push(': keep-alive\ndata: x\n\n')
  eq('注释被忽略', frames.length, 1)
}
{
  const d = new SseDecoder()
  const frames = d.push('data: a\r\n\r\ndata: b\r\n\r\n')
  eq('CRLF 行尾', frames.map((f) => f.data).join(','), 'a,b')
}
{
  const d = new SseDecoder()
  // W3C 规范：连续多个 data 行且无空行分隔 = 同一事件的多行 data
  const frames = d.push('data: a\rdata: b\r\r')
  eq('裸 CR 行尾', frames.length, 1)
  eq('裸 CR 多行 data 合并', frames[0].data, 'a\nb')
}

/* ---------- 跨 chunk 断帧 ---------- */

{
  const d = new SseDecoder()
  eq('半帧不产出', d.push('data: he').length, 0)
  eq('续上后产出', d.push('llo\n\n').length, 1)
}
{
  const d = new SseDecoder()
  d.push('data: he')
  const frames = d.push('llo\n\ndata: x\n\nda')
  eq('一包两帧+半帧', frames.map((f) => f.data).join(','), 'hello,x')
  eq(
    '残留 data: 前缀在缓冲',
    d
      .push('ta: y\n\n')
      .map((f) => f.data)
      .join(','),
    'y',
  )
}
{
  // chunk 劈在 \r 与 \n 中间：\r 先当行尾，下一包的 \n 是空行（等同分帧，不能当半行残留）
  const d = new SseDecoder()
  d.push('data: a\r')
  const frames = d.push('\ndata: b\n\n')
  eq('\\r 劈开时按行尾处理', frames.map((f) => f.data).join(','), 'a,b')
}

/* ---------- id / retry ---------- */

{
  const d = new SseDecoder()
  const f1 = d.push('id: 42\ndata: a\n\n')[0]
  eq('id 携带', f1.id, '42')
  const f2 = d.push('data: b\n\n')[0]
  eq('id 持久到后续帧', f2.id, '42')
  eq('retry 携带', d.push('retry: 3000\ndata: c\n\n')[0].retry, 3000)
  eq('非法 retry 忽略', d.push('retry: abc\ndata: d\n\n')[0].retry, undefined)
}

/* ---------- end / 空帧 ---------- */

{
  const d = new SseDecoder()
  eq('空输入无帧', d.push('').length, 0)
  d.push('data: tail')
  eq(
    '未完成帧 end 吐出',
    d
      .end()
      .map((f) => f.data)
      .join(','),
    'tail',
  )
  eq('end 后无残留', d.end().length, 0)
}
{
  const d = new SseDecoder()
  eq('仅注释无帧', d.push(': ping\n').length, 0)
  eq('未知字段忽略', d.push('foo: bar\ndata: z\n\n').length, 1)
}

/* ---------- 汇总 ---------- */

console.log(`smoke:sse — 通过 ${passed} 项`)
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
