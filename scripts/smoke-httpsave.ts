/**
 * 本地存储加固（http-utils.ts 的 saveJson / trimBodyForStorage）的断言。
 *
 * 背景：历史条目曾原样拷贝 bodyRaw，一条 2MB 正文就能顶穿 localStorage
 * 配额，且写失败静默吞掉——50 条历史一次全丢。这里把裁剪边界和失败感知
 * 逐条钉住。
 *
 * 运行：npm run smoke:httpsave
 */
import { saveJson, trimBodyForStorage, MAX_SAVED_BODY_CHARS } from '../src/lib/http-utils'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

/* ---------- trimBodyForStorage ---------- */

{
  const d = { bodyRaw: 'hello' }
  const r = trimBodyForStorage(d)
  eq('短正文原样返回', r.bodyRaw, 'hello')
  eq('不打标记', r.bodyTrimmed, undefined)
  ok('原对象不被修改（短正文返回自身）', r === d)
}
{
  const d = { bodyRaw: 'x'.repeat(MAX_SAVED_BODY_CHARS) }
  const r = trimBodyForStorage(d)
  eq('恰好等于上限不截断', r.bodyRaw.length, MAX_SAVED_BODY_CHARS)
  eq('不打标记', r.bodyTrimmed, undefined)
}
{
  const d = { bodyRaw: 'x'.repeat(MAX_SAVED_BODY_CHARS + 1) }
  const r = trimBodyForStorage(d)
  eq('超 1 字符即截断', r.bodyRaw.length, MAX_SAVED_BODY_CHARS)
  eq('打标记', r.bodyTrimmed, true)
  ok('其余字段保留', (d as unknown as { method?: string }).method === undefined && 'bodyRaw' in r)
}
{
  // 多余字段必须原样透传（Draft 里还有 method/url/headers 等）
  const d = { bodyRaw: 'x'.repeat(MAX_SAVED_BODY_CHARS + 1), method: 'POST', url: 'https://a.b' }
  const r = trimBodyForStorage(d)
  eq('透传 method', r.method, 'POST')
  eq('透传 url', r.url, 'https://a.b')
}
{
  const d = { bodyRaw: '' }
  eq('空正文不截断', trimBodyForStorage(d).bodyRaw, '')
}

/* ---------- saveJson 成败感知 ---------- */

// node 环境没有 localStorage：先装一个正常桩测成功路径，再换抛错桩测失败路径
type LS = { setItem: (k: string, v: string) => void; getItem: (k: string) => string | null }
const g = globalThis as unknown as { localStorage?: LS }
const real = g.localStorage

g.localStorage = { setItem: () => {}, getItem: () => null }
ok('写入成功返回 true', saveJson('k', { a: 1 }) === true)

g.localStorage = {
  setItem: () => { throw new Error('QuotaExceededError') },
  getItem: () => null,
}
ok('配额爆掉返回 false（不再静默）', saveJson('k', { a: 1 }) === false)

g.localStorage = real

/* ---------- 汇总 ---------- */

console.log(`smoke:httpsave — 通过 ${passed} 项`)
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
