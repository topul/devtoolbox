/**
 * SQL 静态检查 + EXPLAIN 解读冒烟。
 *
 * 两段能力：
 *   1. `lintSql` —— 纯本地规则检查，不需要数据库。规则来自常见的慢查询成因。
 *   2. `parseExplain` —— 解析用户粘进来的 EXPLAIN 结果（JSON 格式，MySQL 8 / PG 都能给）。
 *
 * **误报是这个工具的生命线问题**：一个到处误报的检查器等于没有 —— 用户会养成
 * 「忽略告警」的习惯，下次真有问题也不信。所以这里的重点是
 * 「什么情况下不该报」与注释/字符串里的关键字不该被当成代码。
 */
import {
  lintSql,
  parseExplain,
  suggestIndex,
  type SqlIssue,
} from '../src/lib/toolkit/sql-lint'

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

/* ================= 1. 基础 ================= */
{
  eq(lintSql('').length, 0, '空 SQL 无问题')
  eq(lintSql('SELECT 1').length, 0, '最简查询无问题')
  eq(lintSql('   \n\t  ').length, 0, '空白输入无问题')
}

{
  // 注释与字符串里的关键字不该被当成代码 —— 这是误报的头号来源
  const sql = `-- WHERE name LIKE '%x%'\n/* SELECT * FROM users WHERE 1=1 */\nSELECT id FROM t WHERE note = 'a NOT IN (1,2)'`
  const issues = lintSql(sql)
  eq(issues.length, 0, '注释与字符串字面量里的关键字不产生告警')
}

{
  // 去掉注释后确实有问题的，注释不影响检测
  const issues = lintSql('-- 注释\nSELECT * FROM users')
  ok(issues.some(i => i.rule === 'select-star'), '注释不影响真实问题检出')
}

/* ================= 2. SELECT * ================= */
{
  const issues = lintSql('SELECT * FROM users')
  const star = issues.find(i => i.rule === 'select-star')
  ok(!!star, '检出 SELECT *')
  eq(star!.severity, 'warn', 'SELECT * 是 warn 而非 error（很多场景是合理的）')
  ok(star!.line > 0, '带行号')
  ok(star!.hint.length > 0, '带修复建议')
}

{
  eq(lintSql('SELECT id, name FROM users').length, 0, '显式列名不报')
  // COUNT(*) 不是问题
  eq(lintSql('SELECT COUNT(*) FROM users').length, 0, 'COUNT(*) 不算 SELECT *')
}

/* ================= 3. 隐式类型转换 ================= */
{
  const issues = lintSql("SELECT * FROM users WHERE user_id = '123'")
  ok(issues.some(i => i.rule === 'implicit-conversion'), '字符串字面量与数字列比较 → 隐式转换')
}

{
  // 形态 B：字符串列（按命名约定）与裸数字比较
  const issues = lintSql('SELECT id FROM users WHERE name = 123')
  ok(issues.some(i => i.rule === 'implicit-conversion'), '字符串列与裸数字比较 → 隐式转换')
}

{
  // 反过来：字符串列 = 字符串字面量，不报
  eq(lintSql("SELECT id FROM users WHERE name = 'abc'").length, 0, '字符串比字符串不报隐式转换')
}

{
  // 命名不像数字列的一律不报 —— 宁可漏报不误报
  eq(lintSql("SELECT id FROM t WHERE foo = '123'").length, 0,
    '列名无法判断类型时不报（静态分析的固有局限）')
}

/* ================= 4. NOT IN ================= */
{
  const issues = lintSql('SELECT id FROM users WHERE id NOT IN (1, 2, 3)')
  ok(issues.some(i => i.rule === 'not-in'), '检出 NOT IN')
}

{
  const issues = lintSql('SELECT id FROM users WHERE status NOT IN (1,2)')
  ok(issues.some(i => i.rule === 'not-in'), 'NOT IN + 小列表也报（优化器通常改写成 NOT EXISTS）')
}

{
  eq(lintSql('SELECT id FROM users WHERE id IN (1,2,3)').length, 0, 'IN 不报（IN 通常没问题）')
}

/* ================= 5. 前导通配 LIKE ================= */
{
  const issues = lintSql("SELECT id FROM users WHERE name LIKE '%abc'")
  const like = issues.find(i => i.rule === 'like-prefix')
  ok(!!like, '检出前导通配 LIKE')
  eq(like!.severity, 'error', '前导 % 是 error（索引必然失效）')
}

{
  eq(lintSql("SELECT id FROM users WHERE name LIKE 'abc%'").length, 0, '后缀通配不报（能用索引）')
}

/* ================= 6. 函数包裹索引列 ================= */
{
  const issues = lintSql('SELECT id FROM users WHERE YEAR(created_at) = 2026')
  ok(issues.some(i => i.rule === 'function-on-column'), '列被函数包裹 → 索引失效')
  ok(issues.some(i => i.rule === 'function-on-column' && i.hint.includes('2026-01-01')), '建议里给出范围改写形式')
}

{
  ok(lintSql('SELECT id FROM t WHERE LOWER(name) = \'x\'').some(i => i.rule === 'function-on-column'),
    'LOWER(col) 也算函数包裹')
  // 常见豁免：ISNULL 在部分方言里仍能走索引
  ok(!lintSql('SELECT id FROM t WHERE name IS NOT NULL').some(i => i.rule === 'function-on-column'),
    'IS NOT NULL 不算函数包裹')
}

/* ================= 7. OR 与笛卡尔积 ================= */
{
  const issues = lintSql('SELECT id FROM users WHERE a = 1 OR b = 2')
  ok(issues.some(i => i.rule === 'or-condition'), '检出 OR 条件（可能导致索引失效）')
  eq(lintSql('SELECT id FROM users WHERE a = 1 AND b = 2').length, 0, 'AND 不报')
}

{
  const issues = lintSql('SELECT * FROM a, b WHERE a.id = b.aid')
  const cross = issues.find(i => i.rule === 'cross-join')
  ok(!!cross, '检出逗号连接（可能是笛卡尔积）')
  ok(cross!.hint.includes('JOIN'), '建议里提示改用 JOIN')
}

{
  eq(lintSql('SELECT id FROM a JOIN b ON a.id = b.aid').length, 0, '显式 JOIN 不报笛卡尔积')
}

/* ================= 8. 分页 ================= */
{
  const issues = lintSql('SELECT * FROM users LIMIT 1000000')
  ok(issues.some(i => i.rule === 'big-limit'), '检出超大 LIMIT')
}

{
  const issues = lintSql('SELECT * FROM users LIMIT 10 OFFSET 1000000')
  const off = issues.find(i => i.rule === 'large-offset')
  ok(!!off, '检出大OFFSET')
  ok(off!.hint.includes('WHERE id >'), '建议用游标（keyset）改写')
}

/* ================= 9. 多条规则同时命中 ================= */
{
  const sql = `SELECT *
FROM users
WHERE name LIKE '%x'
  AND user_id = '123'
  AND status NOT IN (1,2,3)
ORDER BY created_at
LIMIT 1000000`
  const issues = lintSql(sql)
  const rules = new Set(issues.map(i => i.rule))
  ok(rules.has('select-star'), '多规则：select-star')
  ok(rules.has('like-prefix'), '多规则：like-prefix')
  ok(rules.has('implicit-conversion'), '多规则：implicit-conversion')
  ok(rules.has('not-in'), '多规则：not-in')
  ok(rules.has('big-limit'), '多规则：big-limit')
  // 行号要能定位
  const star = issues.find(i => i.rule === 'select-star')!
  eq(star.line, 1, 'SELECT * 在第 1 行')
  const like = issues.find(i => i.rule === 'like-prefix')!
  eq(like.line, 3, 'LIKE 在第 3 行')
}

/* ================= 10. 去重与排序 ================= */
{
  // 同一条规则同一行只报一次
  const issues = lintSql("SELECT * FROM t WHERE a LIKE '%x' AND b LIKE '%y'")
  const likes = issues.filter(i => i.rule === 'like-prefix')
  ok(likes.length >= 1, '多行都有 LIKE 时分别报出')
  const uniq = new Set(issues.map(i => `${i.line}:${i.rule}`))
  eq(issues.length, uniq.size, '同规则的告警不重复')
}

{
  const issues = lintSql('SELECT * FROM t')
  const keys = issues.map(i => i.rule)
  eq(new Set(keys).size, keys.length, '规则不重复出现')
}

/* ================= 11. EXPLAIN 解析（JSON 格式） ================= */
{
  // MySQL 8 的 EXPLAIN FORMAT=JSON
  const my = {
    query_block: {
      table: {
        table_name: 'users',
        access_type: 'ALL',
        possible_keys: null,
        rows_examined_per_scan: 152000,
        filtered: '100.00',
        cost_info: { query_cost: '152043.12' },
      },
    },
  }
  const r = parseExplain(JSON.stringify(my), 'mysql')
  ok(r.tables.length >= 1, `解析出 ${r.tables.length} 张表`)
  eq(r.tables[0].name, 'users', '表名正确')
  eq(r.tables[0].type, 'ALL', '访问类型 ALL')
  ok(r.tables[0].rows > 10000, `扫描行数被识别为大（${r.tables[0].rows}）`)
  ok(r.tables[0].risk === 'high', `全表扫描风险判为 high（实际 ${r.tables[0].risk}）`)
  ok(r.summary.length > 0, '给出优化建议')
}

{
  // PostgreSQL 的 EXPLAIN (FORMAT JSON)
  const pg = [
    {
      'Plan': {
        'Node Type': 'Seq Scan',
        'Relation Name': 'orders',
        'Startup Cost': 0,
        'Total Cost': 50000,
        'Plan Rows': 300000,
        'Plans': [
          { 'Node Type': 'Index Scan', 'Relation Name': 'users', 'Index Name': 'users_pkey', 'Total Cost': 8, 'Plan Rows': 1 },
        ],
      },
    },
  ]
  const r = parseExplain(JSON.stringify(pg), 'postgres')
  ok(r.tables.length >= 2, `递归解析嵌套 Plan（${r.tables.length} 个节点）`)
  const seq = r.tables.find(t => t.type === 'Seq Scan')
  ok(!!seq, '找到 Seq Scan 节点')
  eq(seq!.name, 'orders', 'Seq Scan 的表名')
  const idx = r.tables.find(t => t.type === 'Index Scan')
  ok(!!idx, '找到嵌套的 Index Scan 节点')
  ok(idx!.name === 'users' && (idx!.name.includes('users')), '嵌套节点表名正确')
}

{
  // 传统格式（非 JSON）也要能看
  const text = `+----+-------------+-------+-------------+-------+---------------+
| id | select_type | table | type        | rows | Extra        |
+----+-------------+-------+-------------+-------+---------------+
| 1 | SIMPLE      | users | ALL         | 152000| Using where |
| 2 | SIMPLE      | orders| index       | 10   | Using index  |
+----+-------------+-------+-------------+-------+---------------+`
  const r = parseExplain(text, 'mysql')
  ok(r.tables.length >= 2, `从文本表格里解析出 ${r.tables.length} 行`)
  const users = r.tables.find(t => t.name === 'users')
  ok(!!users && users.type === 'ALL', '文本格式的 ALL 检出')
  ok(!!r.tables.find(t => t.name === 'orders' && t.type === 'index'), '文本格式的 index 检出')
}

{
  // 全是 index 访问 → 低风险
  const text = `| 1 | SIMPLE | users | index | 1 | Using index |`
  const r = parseExplain(text, 'mysql')
  ok(r.tables[0].risk !== 'high', '全index 访问不是高风险')
}

{
  // 无法识别
  const r = parseExplain('完全不是 explain 输出', 'mysql')
  eq(r.tables.length, 0, '无法识别时返回空表列表而不是崩')
  ok(r.summary.length > 0, '无法识别时给一句提示')
}

{
  const r = parseExplain('', 'mysql')
  eq(r.tables.length, 0, '空输入不崩')
}

{
  // dialect 不识别 → 不崩，按 mysql 试
  const r = parseExplain('{"query_block":{"table":{"table_name":"t","access_type":"ALL","rows_examined_per_scan":1}}}', 'oracle')
  eq(r.tables.length, 1, '未知方言按 JSON 试，不崩')
}

/* ================= 12. 索引建议 ================= */
{
  const issues: SqlIssue[] = [
    { rule: 'like-prefix', severity: 'error', message: 'x', hint: 'y', line: 1, snippet: 'SELECT *' },
  ]
  const s = suggestIndex('users', ['name'], issues)
  eq(s.length, 1, '给出一条索引建议')
  ok(s[0].name.includes('users'), '索引名带表名')
  ok(s[0].columns.includes('name'), '索引列正确')
}

{
  // 已有主键的表不建议重复建
  eq(suggestIndex('users', ['id'], [{ rule: 'function-on-column', severity: 'warn', message: 'x', hint: 'y', line: 1, snippet: 's' }]).length, 0,
    'id 列不建议建索引（通常已是主键）')
}

{
  // 多列建议合并成一条复合索引，而不是给多条单列
  const s = suggestIndex('users', ['org_id', 'status', 'created_at'], [
    { rule: 'select-star', severity: 'warn', message: 'x', hint: 'y', line: 1, snippet: 's' },
  ])
  eq(s.length, 1, '多列合并成一条复合索引')
  ok(s[0].columns.length === 3, `复合索引含 3 列（实际 ${s[0].columns.length}）`)
}

{
  eq(suggestIndex('t', [], []).length, 0, '无问题无列时不给建议')
}

{
  // 同名去重
  const s = suggestIndex('users', ['name'], [
    { rule: 'a', severity: 'warn', message: 'x', hint: 'y', line: 1, snippet: 's' },
    { rule: 'b', severity: 'warn', message: 'x', hint: 'y', line: 2, snippet: 's' },
  ])
  eq(s.length, 1, '同表同列只给一条建议（不重复）')
}

/* ================= 结果 ================= */

if (fails.length) {
  console.error(`\n✗ smoke:sqlcheck 失败：${pass} 通过 / ${fails.length} 失败`)
  process.exit(1)
}
console.log(`✓ smoke:sqlcheck ${pass} 项全部通过`)
