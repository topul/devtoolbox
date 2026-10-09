/**
 * Skill 预设与工具白名单 —— 纯函数验收测试。
 *
 * 覆盖：allow 解析、预设 coerce/持久化往返、应用语义（覆盖 settings 子集）。
 * localStorage 用内存桩：验证 load/save 在脏数据下的行为，不碰真实存储。
 */
import * as assert from 'node:assert'
import {
  DEFAULT_SETTINGS,
  SKILLS_KEY,
  applySkill,
  blankSkill,
  coerceSkill,
  loadSettings,
  loadSkills,
  parseAllowList,
  saveSkills,
  type SkillPreset,
} from '../src/lib/chat-config'

/* ================= localStorage 桩 ================= */

let backing = new Map<string, string>()
const store = {
  getItem: (k: string): string | null => backing.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    backing.set(k, v)
  },
  removeItem: (k: string): void => {
    backing.delete(k)
  },
}
;(globalThis as Record<string, unknown>).localStorage = store

let pass = 0
const fail: string[] = []
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++
  } else {
    fail.push(`${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

/* ================= parseAllowList ================= */

{
  assert.deepStrictEqual(parseAllowList(''), [], '空串给空数组')
  ok('空串 → 空数组（全部允许）', parseAllowList('').length === 0)
  assert.deepStrictEqual(parseAllowList('a, b\nc'), ['a', 'b', 'c'], '混合分隔符')
  ok('逗号与换行混合分隔', JSON.stringify(parseAllowList('a, b\nc')) === '["a","b","c"]')
  ok('重复项去重', parseAllowList('a,a, b ,a').length === 2)
  ok('空 token 丢弃', parseAllowList(' , ,x,').length === 1)
  ok('全空白 → 空', parseAllowList(' \n , \n').length === 0)
  ok('保留原始大小写（工具名大小写敏感）', parseAllowList('Cidr_Info')[0] === 'Cidr_Info')
}

/* ================= coerceSkill ================= */

{
  ok(
    '完整对象原样通过',
    coerceSkill({
      id: 's1',
      label: '代码审查',
      system: '你是审查者',
      temperature: '0.2',
      maxTokens: '',
      topP: '',
      toolAllow: 'a,b',
      toolsEnabled: true,
    })?.label === '代码审查',
  )
  ok(
    '缺字段补默认',
    (() => {
      const s = coerceSkill({ id: 's2', label: 'x' })
      return !!s && s.system === '' && s.toolsEnabled === true && s.temperature === ''
    })(),
  )
  ok(
    '缺 id 补新 id',
    (() => {
      const s = coerceSkill({ label: 'x' })
      return !!s && s.id.startsWith('k')
    })(),
  )
  ok('非对象 → null', coerceSkill('nope' as unknown) === null)
  ok('null → null', coerceSkill(null) === null)
  ok('label 空白的丢弃', coerceSkill({ id: 's3', label: '   ' }) === null, '没有名字的预设没有意义')
  ok(
    '数字型字段进脏值被矫正为字符串',
    (() => {
      const s = coerceSkill({ id: 's4', label: 'x', temperature: 0.5 })
      return !!s && s.temperature === ''
    })(),
  )
  ok(
    'toolsEnabled 脏值回落 true',
    (() => {
      const s = coerceSkill({ id: 's5', label: 'x', toolsEnabled: 'yes' })
      return !!s && s.toolsEnabled === true
    })(),
  )
}

/* ================= 持久化往返 ================= */

{
  backing = new Map()
  ok('空存储 → 空列表', loadSkills().length === 0)

  const list: SkillPreset[] = [
    { ...blankSkill('翻译'), system: '你是翻译官', toolAllow: 'a', toolsEnabled: false },
    { ...blankSkill('默认'), system: '', toolsEnabled: true },
  ]
  saveSkills(list)
  const back = loadSkills()
  ok(
    '往返字段一致',
    back.length === 2 &&
      back[0].label === '翻译' &&
      back[0].toolsEnabled === false &&
      back[0].system === '你是翻译官',
  )

  backing.set(SKILLS_KEY, '{broken')
  ok('坏 JSON → 空列表（不抛）', loadSkills().length === 0)

  backing.set(SKILLS_KEY, JSON.stringify([{ label: '好预设' }, '垃圾', 42, { label: '' }]))
  ok('混入脏条目只保留合法的', loadSkills().length === 1 && loadSkills()[0].label === '好预设')

  backing.set(SKILLS_KEY, JSON.stringify({ not: 'an array' }))
  ok('非数组 → 空列表', loadSkills().length === 0)
}

/* ================= applySkill 语义 ================= */

{
  const s: SkillPreset = {
    ...blankSkill('审查'),
    system: '你是代码审查者',
    temperature: '0.1',
    maxTokens: '2048',
    topP: '0.9',
    toolAllow: 'read_file, grep',
    toolsEnabled: false,
  }
  const patch = applySkill(s)
  ok('应用覆盖 system', patch.system === '你是代码审查者')
  ok(
    '应用覆盖三个参数',
    patch.temperature === '0.1' && patch.maxTokens === '2048' && patch.topP === '0.9',
  )
  ok('应用覆盖白名单', patch.toolAllow === 'read_file, grep')
  ok('应用覆盖工具开关', patch.toolsEnabled === false)
  ok(
    '应用不携带 id/label（不动模型档案与其他状态）',
    !('id' in patch) && !('label' in patch) && !('proxy' in patch) && !('extraHeaders' in patch),
  )
  assert.deepStrictEqual(
    Object.keys(patch).sort(),
    ['maxTokens', 'system', 'temperature', 'toolAllow', 'toolsEnabled', 'topP'],
    '应用集合固定六项',
  )
  ok(
    '应用字段集合固定为 settings 子集',
    Object.keys(patch).every((k) => k in DEFAULT_SETTINGS),
  )
}

/* ================= settings 兼容（老数据无 toolAllow） ================= */

{
  backing = new Map()
  // 模拟升级前写入的 settings：没有 toolAllow 字段
  backing.set(
    'devtoolbox-chat-settings',
    JSON.stringify({ system: '旧系统提示', temperature: '0.5' }),
  )
  const st = loadSettings()
  ok('旧 settings 自动补 toolAllow 空串', st.toolAllow === '')
  ok('旧字段保留', st.system === '旧系统提示' && st.temperature === '0.5')
  ok('其余字段回落默认', st.maxRounds === DEFAULT_SETTINGS.maxRounds)
}

/* ================= 结果 ================= */

console.log(`skills: ${pass} passed, ${fail.length} failed`)
if (fail.length) {
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
