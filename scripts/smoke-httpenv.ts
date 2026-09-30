/**
 * 环境变量插值引擎（src/lib/toolkit/env.ts）的断言。
 *
 * 插值是「看起来对、拼进请求才发现错」的重灾区：变量值里再带占位符会不会
 * 递归展开、缺失变量是静默放行还是阻断、名字里的空格和非法字符怎么处理，
 * 这里用真实样例逐条钉住。
 *
 * 运行：npm run smoke:httpenv
 */
import { applyEnvVars, listEnvVars, mergeMissing } from '../src/lib/toolkit/env'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

/* ---------- 基本替换 ---------- */

{
  const r = applyEnvVars('https://{{base_url}}/get', { base_url: 'api.example.com' })
  eq('单变量替换', r.text, 'https://api.example.com/get')
  eq('无缺失', r.missing.length, 0)
}
{
  const r = applyEnvVars('{{a}}-{{a}}-{{b}}', { a: '1', b: '2' })
  eq('多变量多次出现', r.text, '1-1-2')
}
{
  const r = applyEnvVars('{{ spaced }}', { spaced: 'ok' })
  eq('占位符内空白容忍', r.text, 'ok')
}
{
  const r = applyEnvVars('{{api-key}}', { 'api-key': 'v' })
  eq('连字符变量名', r.text, 'v')
}

/* ---------- 缺失变量 ---------- */

{
  const r = applyEnvVars('http://{{host}}:{{port}}/x', { host: 'h' })
  eq('缺失变量保留占位符', r.text, 'http://h:{{port}}/x')
  eq('缺失列表按序去重', JSON.stringify(r.missing), JSON.stringify(['port']))
}
{
  const r = applyEnvVars('{{x}}{{x}}{{y}}', {})
  eq('空变量表全部缺失', JSON.stringify(r.missing), JSON.stringify(['x', 'y']))
}
{
  const r = applyEnvVars('{{a}}', { a: undefined as unknown as string })
  eq('显式 undefined 视为缺失', r.missing.length, 1)
}
{
  const r = applyEnvVars('没有占位符', { a: 'b' })
  eq('无占位符原样返回', r.text, '没有占位符')
}

/* ---------- 防递归 / 边界 ---------- */

{
  // 变量值里再带 {{...}}：单遍替换，绝不二次展开（否则可构造自引用死循环）
  const r = applyEnvVars('{{a}}', { a: '{{a}}' })
  eq('值内占位符不二次展开', r.text, '{{a}}')
  eq('值内占位符不算缺失', r.missing.length, 0)
}
{
  const r = applyEnvVars('{{a}}', { a: '前{{b}}后' })
  eq('值内其它占位符同样不展开', r.text, '前{{b}}后')
}
{
  // 数字开头的名字不在合法名集合内，保持原样（避免和模板语义冲突）
  const r = applyEnvVars('{{1abc}} {{a-b-c}}', { 'a-b-c': 'v' })
  eq('数字开头名不匹配', r.text, '{{1abc}} v')
}
{
  const r = applyEnvVars('{{}} {{ a b }}', {})
  eq('空名与含空格名不匹配', r.text, '{{}} {{ a b }}')
}
{
  const r = applyEnvVars('行1\n行2 {{x}}\r\n行3', { x: 'V' })
  eq('换行符原样保留', r.text, '行1\n行2 V\r\n行3')
}
{
  // JSON 正文里的插值：值注入后仍是合法 JSON 的常规场景
  const r = applyEnvVars('{"token": "{{token}}"}', { token: 't-123' })
  eq('JSON 正文插值', r.text, '{"token": "t-123"}')
}

/* ---------- listEnvVars / mergeMissing ---------- */

{
  eq('提取去重', JSON.stringify(listEnvVars('{{b}} {{a}} {{b}}')), JSON.stringify(['b', 'a']))
  eq('提取空', listEnvVars('无引用').length, 0)
}
{
  const merged = mergeMissing([{ missing: ['x', 'y'] }, { missing: ['y', 'z'] }, { missing: [] }])
  eq('mergeMissing 合并去重', JSON.stringify(merged), JSON.stringify(['x', 'y', 'z']))
}

/* ---------- 汇总 ---------- */

console.log(`smoke:httpenv — 通过 ${passed} 项`)
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
