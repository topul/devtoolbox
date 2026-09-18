/**
 * 会话存储的断言。
 *
 * 这块逻辑关乎「用户聊了一年的记录还在不在」，所以按数据安全的标准测：
 * 正常读写只是及格线，**损坏恢复、写入原子性、超限拒写**才是重点。
 *
 * 运行：npm run smoke:chatstore
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createChatStore } from '../electron/main/chat-store'
import { CHAT_STORE_FILENAME, titleFromText } from '../src/lib/chatstore-types'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtb-chatstore-'))
const dir = path.join(tmpRoot, 'store')

const ID_A = 'sess-aaaaaaaa-1111'
const ID_B = 'sess-bbbbbbbb-2222'

const turnsA = [
  { id: 't1', role: 'user', blocks: [{ kind: 'text', text: '你好' }], status: 'done' },
  { id: 't2', role: 'assistant', blocks: [{ kind: 'text', text: '你好，有什么可以帮你' }], status: 'done', rounds: 1 },
]

/* ================= 空目录 ================= */

{
  const store = createChatStore(dir)
  const list = store.list()
  eq('空目录 list 成功', list.ok, true)
  eq('空目录无会话', list.sessions.length, 0)
  eq('空目录没有当前会话', list.activeId, null)
  ok('空目录不产生文件（读操作不该写盘）', !fs.existsSync(store.filePath()))
}

/* ================= 新建 / 读取 ================= */

{
  const store = createChatStore(dir)
  const res = store.save({ id: ID_A, title: '第一个会话', turns: turnsA })
  eq('保存成功', res.ok, true)
  ok('文件已落盘', fs.existsSync(store.filePath()))

  const list = store.list()
  eq('列表里有 1 个会话', list.sessions.length, 1)
  eq('标题正确', list.sessions[0].title, '第一个会话')
  eq('条数正确', list.sessions[0].turnCount, 2)
  eq('首个会话自动成为当前会话', list.activeId, ID_A)

  const loaded = store.load(ID_A)
  eq('读取成功', loaded.ok, true)
  eq('内容逐字节一致', JSON.stringify(loaded.turns), JSON.stringify(turnsA))
}

/* ================= 更新 ================= */

{
  const store = createChatStore(dir)
  const before = store.list().sessions[0]
  // 隔开一毫秒，避免 updatedAt 与 createdAt 相同导致断言失去意义
  const t0 = Date.now()
  while (Date.now() === t0) { /* spin */ }

  const turnsA2 = [...turnsA, { id: 't3', role: 'user', blocks: [{ kind: 'text', text: '再来一句' }], status: 'done' }]
  store.save({ id: ID_A, title: '改过的标题', turns: turnsA2 })

  const after = store.list().sessions[0]
  eq('更新后条数变化', after.turnCount, 3)
  eq('标题被更新', after.title, '改过的标题')
  eq('createdAt 保持不变', after.createdAt, before.createdAt)
  ok('updatedAt 前进', after.updatedAt > before.updatedAt)
  eq('不会多出会话', store.list().sessions.length, 1)
}

{
  // 标题传空时保留原标题（别让界面一次空输入把标题抹掉）
  const store = createChatStore(dir)
  store.save({ id: ID_A, title: '   ', turns: turnsA })
  eq('空标题不会覆盖已有标题', store.list().sessions[0].title, '改过的标题')
}

/* ================= 多会话与排序 ================= */

{
  const store = createChatStore(dir)
  const t0 = Date.now()
  while (Date.now() === t0) { /* spin */ }
  store.save({ id: ID_B, title: '第二个会话', turns: [{ id: 'b1', role: 'user', blocks: [], status: 'done' }] })

  const list = store.list()
  eq('两个会话', list.sessions.length, 2)
  eq('按 updatedAt 降序（最近的在最前）', list.sessions[0].id, ID_B)
  eq('当前会话没被后来的会话抢走', list.activeId, ID_A)

  store.setActive(ID_B)
  eq('可以切换当前会话', store.list().activeId, ID_B)
  store.setActive(null)
  eq('可以清空当前会话', store.list().activeId, null)
}

/* ================= 删除 ================= */

{
  const store = createChatStore(dir)
  store.setActive(ID_A)
  store.remove(ID_A)
  const list = store.list()
  eq('删除后只剩 1 个', list.sessions.length, 1)
  eq('删掉的会话读不回来', store.load(ID_A).ok, false)
  eq('当前会话被删时置空', list.activeId, null)

  store.remove(ID_B)
  eq('全删光', store.list().sessions.length, 0)
  eq('删除不存在的会话不报错', store.remove(ID_B).ok, true)
}

/* ================= 非法输入 ================= */

{
  const store = createChatStore(dir)
  for (const bad of ['', 'x', '../../etc/passwd', 'a b c', 's'.repeat(80), null as unknown as string]) {
    eq(`save 拒绝非法 id ${JSON.stringify(bad)}`, store.save({ id: bad, title: 'x', turns: [] }).ok, false)
    eq(`load 拒绝非法 id ${JSON.stringify(bad)}`, store.load(bad).ok, false)
    eq(`remove 拒绝非法 id ${JSON.stringify(bad)}`, store.remove(bad).ok, false)
  }
  eq('save 拒绝非数组 turns', store.save({ id: ID_A, title: 'x', turns: 'nope' as unknown as unknown[] }).ok, false)
  eq('setActive 拒绝非法 id', store.setActive('../../x').ok, false)
  eq('非法操作后仍无会话', store.list().sessions.length, 0)
}

/* ================= 超限拒写 ================= */

{
  const store = createChatStore(dir)
  const huge = 'x'.repeat(25 * 1024 * 1024)
  const res = store.save({ id: 'sess-huge-0001', title: '巨无霸', turns: [{ id: 'h1', role: 'user', blocks: [huge], status: 'done' }] })
  eq('超过单文件上限时拒写', res.ok, false)
  eq('拒写带 tooLarge 标记', res.tooLarge, true)
  eq('拒写后列表仍为空（没写进去半个文件）', store.list().sessions.length, 0)
}

/* ================= 损坏恢复 ================= */

{
  const dir2 = path.join(tmpRoot, 'corrupt')
  fs.mkdirSync(dir2, { recursive: true })
  const file = path.join(dir2, CHAT_STORE_FILENAME)
  const garbage = '{ 这不是 JSON，是半截文件'
  fs.writeFileSync(file, garbage, 'utf8')

  const store = createChatStore(dir2)
  const list = store.list()
  eq('损坏文件不会让 list 失败', list.ok, true)
  eq('损坏后从空开始', list.sessions.length, 0)
  eq('明确回报 recovered', list.recovered, true)

  const backups = fs.readdirSync(dir2).filter((n) => n.includes('.corrupt-'))
  eq('原件被旁置为备份', backups.length, 1)
  eq('备份内容就是原始内容（没被覆盖）', fs.readFileSync(path.join(dir2, backups[0]), 'utf8'), garbage)
}

{
  // 形状不对（sessions 不是数组）同样按损坏处理，且重建后能正常用
  const dir3 = path.join(tmpRoot, 'shape')
  fs.mkdirSync(dir3, { recursive: true })
  fs.writeFileSync(path.join(dir3, CHAT_STORE_FILENAME), JSON.stringify({ version: 1, sessions: 'oops' }), 'utf8')

  const store = createChatStore(dir3)
  eq('形状不对也按损坏处理', store.list().recovered, true)
  eq('重建后可以正常保存', store.save({ id: ID_A, title: '恢复后', turns: [] }).ok, true)
  eq('重建后能读回来', store.list().sessions.length, 1)
}

{
  // 单个会话的字段坏掉时，只丢那一条，不连累其它会话
  const dir4 = path.join(tmpRoot, 'partial')
  fs.mkdirSync(dir4, { recursive: true })
  fs.writeFileSync(
    path.join(dir4, CHAT_STORE_FILENAME),
    JSON.stringify({
      version: 1,
      activeId: ID_A,
      sessions: [
        { id: ID_A, title: '好的', createdAt: 1, updatedAt: 2, turns: [] },
        { id: 'bad id with spaces', title: '坏的', createdAt: 1, updatedAt: 2, turns: [] },
        { id: ID_B, title: '缺 turns' },
        null,
      ],
    }),
    'utf8',
  )
  const store = createChatStore(dir4)
  const list = store.list()
  eq('坏条目被丢掉、好条目保留', list.sessions.length, 1)
  eq('保留的是好的那个', list.sessions[0].id, ID_A)
  eq('activeId 有效时保留', list.activeId, ID_A)
  eq('部分损坏不算整体损坏', list.recovered ?? false, false)
}

/* ================= 写入原子性 ================= */

{
  const dir5 = path.join(tmpRoot, 'atomic')
  const store = createChatStore(dir5)
  store.save({ id: ID_A, title: '原子写', turns: turnsA })
  const leftovers = fs.readdirSync(dir5).filter((n) => n.endsWith('.tmp'))
  eq('不留下临时文件', leftovers.length, 0)

  const stat = fs.statSync(store.filePath())
  ok('文件非空', stat.size > 0)
  const parsed = JSON.parse(fs.readFileSync(store.filePath(), 'utf8'))
  eq('文件里带版本号', parsed.version, 1)
}

/* ================= 缓存与复用 ================= */

{
  // 同一实例内多次 save 不丢数据
  const dir6 = path.join(tmpRoot, 'cache')
  const store = createChatStore(dir6)
  for (let i = 0; i < 5; i++) {
    store.save({ id: ID_A, title: `第 ${i} 次`, turns: new Array(i + 1).fill({ id: `t${i}`, role: 'user', blocks: [], status: 'done' }) })
  }
  eq('连续写入后条数正确', store.list().sessions[0].turnCount, 5)
  eq('标题是最后一次写入的', store.list().sessions[0].title, '第 4 次')

  // 新实例读同一个目录，数据仍在
  const reopened = createChatStore(dir6)
  eq('换实例也能读到', reopened.list().sessions.length, 1)
  eq('内容一致', reopened.load(ID_A).turns.length, 5)
}

/* ================= 标题生成 ================= */

{
  eq('短标题原样', titleFromText('帮忙看看'), '帮忙看看')
  eq('多余空白被压平', titleFromText('  分  行\n文本 '), '分 行 文本')
  eq('过长被截断并加省略号', titleFromText('x'.repeat(40)).length, 29)
  eq('空文本给空串', titleFromText('   '), '')
}

/* ================= 收尾 ================= */

fs.rmSync(tmpRoot, { recursive: true, force: true })

console.log('')
if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`✓ 会话存储：${passed} 项断言全部通过`)
