/**
 * 响应快照纯函数（src/components/http/SnapshotPanel.tsx 导出）的断言。
 *
 * 快照是把响应体写进 localStorage 的功能：截断阈值差一行、上限差一条，
 * 用户数据就可能被静默丢掉，这里用边界值逐条钉住。
 *
 * 运行：npm run smoke:httpsnap
 */
import {
  snapshotFromResponse,
  addSnapshot,
  boundedDiff,
  MAX_SNAPSHOTS,
  MAX_BODY_CHARS,
  MAX_DIFF_LINES,
} from '../src/components/http/SnapshotPanel'
import type { HttpRequestResult } from '../src/lib/http-types'
import type { DecodedBody } from '../src/lib/http-utils'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

const RESP = {
  ok: true,
  url: 'https://api.example.com/x',
  method: 'GET',
  status: 200,
  statusText: 'OK',
  httpVersion: '1.1',
  headers: [] as [string, string][],
  bodyBase64: '',
  bodyBytes: 0,
  rawBodyBase64: '',
  rawBytes: 0,
  contentEncoding: '',
  decompressed: false,
  truncated: false,
  timings: { connectMs: 1, tlsMs: 1, ttfbMs: 1, totalMs: 42 },
  redirects: [],
  viaProxy: false,
  remoteAddress: '1.2.3.4',
  tls: null,
} satisfies HttpRequestResult as HttpRequestResult

const TEXT_DECODED = {
  ct: 'text/plain',
  bytes: new Uint8Array(0),
  text: 'hello',
  charset: 'utf-8',
  binary: false,
  pretty: null,
  cookies: [],
} satisfies DecodedBody as DecodedBody

/* ---------- snapshotFromResponse ---------- */

{
  const s = snapshotFromResponse(RESP, TEXT_DECODED)
  ok('正常文本构造快照', s !== null)
  eq('元信息透传', `${s!.method}|${s!.status}|${s!.durationMs}`, 'GET|200|42')
  eq('正文透传', s!.bodyText, 'hello')
  eq('未截断', s!.truncated, false)
}
{
  const big = { ...TEXT_DECODED, text: 'x'.repeat(MAX_BODY_CHARS + 1) }
  const s = snapshotFromResponse(RESP, big)!
  eq('超长截断到上限', s.bodyText.length, MAX_BODY_CHARS)
  eq('标记 truncated', s.truncated, true)
}
{
  const exact = { ...TEXT_DECODED, text: 'x'.repeat(MAX_BODY_CHARS) }
  const s = snapshotFromResponse(RESP, exact)!
  eq('恰好等于上限不截断', s.truncated, false)
}
{
  const bin = { ...TEXT_DECODED, binary: true }
  eq('二进制响应拒存', snapshotFromResponse(RESP, bin), null)
}

/* ---------- addSnapshot ---------- */

{
  const s = snapshotFromResponse(RESP, TEXT_DECODED)!
  const list = addSnapshot([], s)
  eq('空列表追加', list.length, 1)
  eq('新的在前', list[0].id, s.id)
}
{
  const list = Array.from({ length: MAX_SNAPSHOTS }, (_, i) => ({
    id: `s${i}`,
    at: i,
    method: 'GET',
    url: '',
    status: 200,
    bodyText: '',
    truncated: false,
    durationMs: 1,
  }))
  const next = addSnapshot(list, snapshotFromResponse(RESP, TEXT_DECODED)!)
  eq('超上限丢最旧', next.length, MAX_SNAPSHOTS)
  // 列表语义是「新在前」：新条目插到头部，超出上限时从末尾（最旧）挤掉
  eq('新的在最前', next[0].id !== `s${MAX_SNAPSHOTS - 1}`, true)
  ok(
    '末尾最旧的被挤出',
    next.every((x) => x.id !== `s${MAX_SNAPSHOTS - 1}`),
  )
  eq(
    '最前的还在',
    next.some((x) => x.id === 's0'),
    true,
  )
}
{
  const list = [
    {
      id: 'a',
      at: 0,
      method: 'GET',
      url: '',
      status: 200,
      bodyText: '',
      truncated: false,
      durationMs: 1,
    },
  ]
  eq('二进制入参原样返回', addSnapshot(list, null), list)
}

/* ---------- boundedDiff ---------- */

{
  const d = boundedDiff('a\nb\nc', 'a\nX\nc')
  eq(
    '单行修改产生 1 增 1 删',
    `${d.lines.filter((l) => l.type === 'add').length}/${d.lines.filter((l) => l.type === 'del').length}`,
    '1/1',
  )
  eq('未截断', d.truncated, false)
}
{
  const d = boundedDiff('', '')
  eq('空对空', d.lines.length, 0)
}
{
  const a = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `a${i}`).join('\n')
  const d = boundedDiff(a, 'x')
  eq('超行截断标记', d.truncated, true)
  ok('行数被夹住', a.split('\n').length > MAX_DIFF_LINES)
}
{
  // 截断后不再 O(m·n) 爆炸：两侧各 1 万行也能快速返回
  const big = Array.from({ length: 10_000 }, (_, i) => `line-${i}`).join('\n')
  const t0 = Date.now()
  boundedDiff(big, big + '\nextra')
  ok('万行 diff 秒回', Date.now() - t0 < 3000, `耗时 ${Date.now() - t0}ms`)
}

/* ---------- 汇总 ---------- */

console.log(`smoke:httpsnap — 通过 ${passed} 项`)
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
