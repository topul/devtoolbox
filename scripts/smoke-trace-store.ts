/**
 * 链路存档（trace-store）纯逻辑验收：淘汰策略、大小计算、脏数据矫正。
 * IndexedDB 读写是薄封装（node 无 IDB），靠渲染冒烟兜底。
 */
import * as assert from 'node:assert'
import {
  TRACE_MAX_ENTRIES,
  coerceEntry,
  entryBytes,
  pickEvictions,
  type TraceArchiveEntry,
} from '../src/lib/trace-store'

let pass = 0
const fail: string[] = []
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++ } else { fail.push(`${name}${detail ? ` —— ${detail}` : ''}`) }
}

/* ================= pickEvictions ================= */

{
  ok('未超上限 → 不淘汰', pickEvictions([{ id: 'a', savedAt: 1 }], 10).length === 0)
  ok('恰好等于上限 → 不淘汰', pickEvictions([{ id: 'a', savedAt: 1 }, { id: 'b', savedAt: 2 }], 2).length === 0)
  const ev = pickEvictions([
    { id: 'old', savedAt: 1 },
    { id: 'new', savedAt: 9 },
    { id: 'mid', savedAt: 5 },
  ], 2)
  ok('超限淘汰最旧者', JSON.stringify(ev) === '["old"]')
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, savedAt: i }))
  const ev2 = pickEvictions(many, TRACE_MAX_ENTRIES)
  ok('60 条淘汰到上限：10 条', ev2.length === 60 - TRACE_MAX_ENTRIES, String(ev2.length))
  ok('淘汰的都是最旧的', ev2.every((id) => Number(id.slice(1)) < 10))
  ok('空列表安全', pickEvictions([], 50).length === 0)
  ok('cap 为 0 → 全部淘汰', pickEvictions([{ id: 'a', savedAt: 1 }], 0).length === 1)
}

/* ================= entryBytes ================= */

{
  const e: TraceArchiveEntry = { id: 'x', savedAt: 1, trace: { requestId: 'x', startedAt: 0, url: '', headers: [], rounds: [] } }
  ok('空链路字节数合理（<500）', entryBytes(e) > 0 && entryBytes(e) < 500, String(entryBytes(e)))
  const big: TraceArchiveEntry = { ...e, trace: { ...e.trace, rounds: [{ round: 1, requestBody: '中'.repeat(200_000), truncated: true, frames: [], framesTruncated: false, meta: null, tools: [] }] } }
  ok('20 万中文的请求体超 512KB 上限', entryBytes(big) > 512 * 1024, String(entryBytes(big)))
  ok('中文按 UTF-8 计 3 字节（字符数估算会漏）', entryBytes(big) > 600_000)
}

/* ================= coerceEntry ================= */

{
  const good: TraceArchiveEntry = { id: 'g', savedAt: 123, trace: { requestId: 'g', startedAt: 0, url: 'u', headers: [], rounds: [] } }
  const back = coerceEntry(JSON.parse(JSON.stringify(good)))
  ok('合法条目往返一致', !!back && back.id === 'g' && back.trace.rounds.length === 0)
  ok('非对象 → null', coerceEntry('x') === null && coerceEntry(null) === null && coerceEntry(42) === null)
  ok('缺 id → null', coerceEntry({ savedAt: 1, trace: {} }) === null)
  ok('缺 savedAt → null', coerceEntry({ id: 'a', trace: {} }) === null)
  ok('缺 trace → null', coerceEntry({ id: 'a', savedAt: 1 }) === null)
  ok('trace 缺 rounds → null', coerceEntry({ id: 'a', savedAt: 1, trace: { requestId: 'a' } }) === null)
  ok('savedAt 非有限数 → null', coerceEntry({ id: 'a', savedAt: 'x', trace: { requestId: 'a', rounds: [] } }) === null)
}

/* ================= 结果 ================= */

assert.ok(fail.length === 0, fail.join('; '))
console.log(`trace-store: ${pass} passed, ${fail.length} failed`)
