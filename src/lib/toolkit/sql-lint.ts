/**
 * SQL 静态检查 + EXPLAIN 解读 —— 纯本地，不连数据库。
 *
 * 两段能力：
 *   1. `lintSql`：按常见慢查询成因做规则检查
 *   2. `parseExplain`：解析用户粘进来的 EXPLAIN 输出（MySQL 8 JSON / PG JSON / 传统文本表）
 *
 * **误报是这类工具的生命线问题**。一个到处误报的检查器等于没有 ——
 * 用户会养成「忽略告警」的习惯，下次真有问题也不信。所以设计上：
 *   - 先把注释与字符串字面量替换成等长空格再分析（保留列号，让告警能定位）
 *   - 每条规则的 `severity` 分级：会索引失效的（LIKE '%x'）是 error，
 *     只是风格问题的（SELECT *）是 warn，不该混在一起让人以为都是大问题
 *   - 大量豁免：COUNT(*) 不是 SELECT *、IS NOT NULL 不是函数包裹、IN 不是 NOT IN
 *
 * 不连数据库是有意的取舍：跨平台、不需要用户配连接串，也不会有隐私顾虑。
 * 真实执行计划交给 `parseExplain` —— 用户从自己的库里贴进来。
 */

/* ================= 类型 ================= */

/** 告警级别 */
export type SqlSeverity = 'error' | 'warn' | 'info'

/** 一条静态检查告警 */
export interface SqlIssue {
  /** 稳定的规则 id（界面用它做图标与配色，不解析文案） */
  rule: string
  severity: SqlSeverity
  /** 中文说明由界面词条负责，这里只放规则标识 */
  message: string
  /** 修复建议（中文由界面负责，这里给的是可执行的 SQL 片段） */
  hint: string
  /** 1 起的行号 */
  line: number
  /** 原文那一行，方便用户对照 */
  snippet: string
}

/** EXPLAIN 里的一个访问节点 */
export interface ExplainTable {
  name: string
  /** 访问类型：ALL / index / ref / eq_ref / range / Seq Scan / Index Scan … */
  type: string
  /** 预估扫描行数 */
  rows: number
  /** 命中的索引 */
  key: string
  /** 优化器考虑过但没用的索引（possible_keys） */
  possibleKeys: string
  /** 过滤后剩余行占比（%），0 表示未知 */
  filtered: number
  /** Extra 信息 */
  extra: string
  /** 风险判定 */
  risk: 'high' | 'mid' | 'low'
  /** 判定理由 */
  note: string
}

/** EXPLAIN 解析结果 */
export interface ExplainResult {
  tables: ExplainTable[]
  summary: string[]
  /** 解析失败时为 true */
  unparsed: boolean
}

/** 一条索引建议 */
export interface IndexSuggestion {
  table: string
  name: string
  columns: string[]
  reason: string
  sql: string
}

/* ================= 预处理：剥离注释与字符串 ================= */

/**
 * 只剥注释，**保留字符串字面量**。
 *
 * 与 blankLiterals 的区别：有些规则必须看到字面量的内容
 * （`LIKE '%x'` 里的前导 %、`col = '123'` 里的数字），
 * 但绝不能看到注释里的内容 —— 否则 `-- WHERE name LIKE '%x'`
 * 这行注释会凭空造出一条告警。
 */
function stripComments(sql: string): string {
  const out = sql.split('')
  const n = sql.length
  let i = 0
  while (i < n) {
    const c = sql[i]
    const c2 = sql[i + 1]
    if ((c === '-' && c2 === '-') || c === '#') {
      while (i < n && sql[i] !== '\n') { out[i] = ' '; i++ }
      continue
    }
    if (c === '/' && c2 === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2 }
      continue
    }
    i++
  }
  return out.join('')
}

/**
 * 把注释与字符串字面量替换成等长空格。
 *
 * 为什么要等长而不是删掉：告警要带列号/行号去原文里定位，长度变了定位就全错。
 *
 * 处理三种：`-- 行注释`、`/* 块注释 *\/`、`'单引号'`、`"双引号标识符"`。
 * 顺带处理 MySQL 的 `# 行注释` 与反引号。
 */
function blankLiterals(sql: string): string {
  const out = sql.split('')
  const n = sql.length
  let i = 0
  // 记录每行起始偏移，供行号换算
  while (i < n) {
    const c = sql[i]
    const c2 = sql[i + 1]

    // -- 行注释 与 # 行注释
    if ((c === '-' && c2 === '-') || c === '#') {
      while (i < n && sql[i] !== '\n') { out[i] = ' '; i++ }
      continue
    }
    // /* 块注释 */
    if (c === '/' && c2 === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2 }
      continue
    }
    // '...' 与 "..." 与 `...`：整体抹成空格
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out[i] = ' '
      i++
      while (i < n) {
        if (sql[i] === '\\' && i + 1 < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
        if (sql[i] === quote) {
          // '' 是转义（SQL 里 'it''s'），不结束
          if (sql[i + 1] === quote) { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
          out[i] = ' '
          i++
          break
        }
        if (sql[i] !== '\n') out[i] = ' '
        i++
      }
      continue
    }
    i++
  }
  return out.join('')
}

/** 把字符下标换算成 1 起的行号 */
function lineAt(sql: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < sql.length; i++) {
    if (sql.charCodeAt(i) === 10) line++
  }
  return line
}

/** 取某一行原文 */
function lineText(sql: string, line: number): string {
  return sql.split('\n')[line - 1]?.trim() ?? ''
}

/* ================= 规则检查 ================= */

/** 可能被索引的列名：出现在 WHERE 后、且是简单标识符。
 *  导出是为了让 MCP 执行体与界面共用同一份 —— 之前两边各抄一份正则，
 *  其中一份把行尾锚点写成了 `\$`（字面美元），导致索引建议永远为空。 */
export function whereColumns(masked: string): string[] {
  // 粗略切出 WHERE ...（到 GROUP/ORDER/LIMIT/结尾）
  const m = /\bwhere\b([\s\S]*?)(?=\bgroup\b|\border\b|\blimit\b|\bhaving\b|$)/i.exec(masked)
  if (!m) return []
  const seg = m[1]
  const cols = new Set<string>()
  // `col = ...` / `col >= ...` / `col <op> ...`
  // 前缀允许省略：WHERE 后的第一个条件前没有 and/or，只靠「标识符 + 比较符」识别。
  // 风险是把字面量里的内容当列名 —— 但字面量在 masked 里已被抹成空格，不会误伤。
  const re = /(?:\bwhere\b|\band\b|\bor\b)?\s*\b([a-z_][a-z0-9_.]*)\s*(?:=|<>|!=|<=|>=|<|>|\blike\b|\bin\b|\bbetween\b)/gi
  let r: RegExpExecArray | null
  while ((r = re.exec(seg)) !== null) cols.add(r[1].toLowerCase())
  // 补一段：`col` 紧跟在括号后（IN (1,2) 的值列表里不能取，靠上面的模式已经覆盖）
  return [...cols]
}

export function extractTable(sql: string): string {
  // 取第一个 FROM / JOIN 后面的表名
  const m = /\b(?:from|join)\s+`?([a-z_][a-z0-9_]*)`?/i.exec(stripComments(sql))
  return m ? m[1] : ''
}

/**
 * 静态检查。
 *
 * @param sql 原始 SQL
 * @returns 告警列表；没有问题时是空数组
 */
export function lintSql(sql: string): SqlIssue[] {
  if (!sql.trim()) return []
  const masked = blankLiterals(sql)
  // 规则里要看字面量内容的（LIKE 的前导 %、隐式转换的数字）用这个：
  // 注释已去掉、字面量还在
  const noComments = stripComments(sql)
  const issues: SqlIssue[] = []
  const add = (rule: string, severity: SqlSeverity, message: string, hint: string, index: number): void => {
    const line = lineAt(masked, index)
    issues.push({ rule, severity, message, hint, line, snippet: lineText(sql, line) })
  }

  /* --- SELECT * --- */
  // 排除 COUNT(*)：它不是"取了所有列"
  const starRe = /select\s+(?:distinct\s+)?\*/gi
  let m: RegExpExecArray | null
  while ((m = starRe.exec(masked)) !== null) {
    // 前面紧邻 COUNT( 的跳过
    const before = masked.slice(Math.max(0, m.index - 8), m.index)
    if (/count\s*\(\s*$/i.test(before)) continue
    add('select-star', 'warn', 'SELECT_STAR',
      '列出实际需要的列：加列会改缓存失效逻辑，减列能减少 I/O', m.index)
  }

  /* --- 前导通配 LIKE ---
   * 必须在**原文**上找：blankLiterals 把 '%abc' 抹成了 '   '，
   * 前缀 % 消失了，规则就永远不触发。
   * 列名 / 关键字的匹配才用 masked（避免注释与字符串里的关键字误报）。
   */
  const likeRe = /\blike\s+'%/gi
  while ((m = likeRe.exec(noComments)) !== null) {
    add('like-prefix', 'error', 'LIKE_PREFIX',
      '前导 % 让 B-Tree 索引完全失效。改用全文检索，或把高频前缀拆出来单独建索引', m.index)
  }

  /* --- NOT IN --- */
  const notInRe = /\bnot\s+in\s*\(/gi
  while ((m = notInRe.exec(masked)) !== null) {
    add('not-in', 'warn', 'NOT_IN',
      'NOT IN 在列表有 NULL 时结果恒为空，且优化器常改写成更慢的计划。改用 NOT EXISTS', m.index)
  }

  /* --- OR 条件 --- */
  const orRe = /\bor\b/gi
  while ((m = orRe.exec(masked)) !== null) {
    add('or-condition', 'info', 'OR',
      'OR 的各分支难以同时走索引。确认每个分支都命中索引，否则考虑 UNION ALL', m.index)
  }

  /* --- 逗号连接（笛卡尔积风险）--- */
  const commaJoin = /\bfrom\s+[a-z_][a-z0-9_]*\s*,\s*[a-z_]/i.exec(masked)
  if (commaJoin) {
    add('cross-join', 'warn', 'CROSS_JOIN',
      '逗号连接容易漏写连接条件，变成笛卡尔积。改用显式 JOIN ... ON', commaJoin.index)
  }

  /* --- 函数包裹列 --- */
  const fnRe = /\b(year|month|day|date|upper|lower|trim|substring|substr|concat|abs|left|right|round|length|lower)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)/gi
  while ((m = fnRe.exec(masked)) !== null) {
    const fn = m[1].toLowerCase()
    const col = m[2]
    let hint = '函数包裹列会让索引失效。改成范围条件'
    if (fn === 'year' || fn === 'month' || fn === 'day' || fn === 'date') {
      hint = `函数包裹列会让索引失效。改成范围条件：${col} >= '2026-01-01' AND ${col} < '2027-01-01'`
    }
    add('function-on-column', 'warn', 'FUNCTION_ON_COLUMN', hint, m.index)
  }

  /* --- 隐式类型转换 ---
   *
   * 诚实的局限：**静态分析无法知道某列是数字还是字符串**。`WHERE id = '123'`
   * 只有拿到表结构才能判断。因此这里只报「高概率是数字列」的形态：
   *   - 列名以 id 结尾或叫 phone/age/price 等（命名约定）
   *   - 右边是纯数字（不带引号给数字列也可能反向出问题）
   * 其余情况宁可漏报也不误报 —— 误报多了用户就不看了。
   */
  const NUMERIC_HINT = /(?:^|_)(?:id|no|num|count|qty|amount|price|age|year|month|day|phone|mobile|zip|code)$/i
  const colSet = new Set(whereColumns(masked))

  // 形态 A：col = '123'（列名像数字列，右边是数字字符串）
  const litRe = /\b([a-z_][a-z0-9_]*)\s*=\s*'([^']*)'/gi
  while ((m = litRe.exec(noComments)) !== null) {
    const col = m[1].toLowerCase()
    if (!colSet.has(col)) continue
    if (!NUMERIC_HINT.test(col)) continue
    if (!/^-?\d+(\.\d+)?$/.test(m[2].trim())) continue
    add('implicit-conversion', 'error', 'IMPLICIT_CONVERSION',
      `${col} 看起来是数字列，却与字符串比较，索引会失效。去掉引号：${col} = ${m[2].trim()}`, m.index)
  }

  // 形态 B：col = 123（列名像字符串列，右边是裸数字）
  const numLitRe = /\b(name|title|code|status|type|email|phone_number|label|desc|description)\s*=\s*(\d+)\b/gi
  while ((m = numLitRe.exec(masked)) !== null) {
    add('implicit-conversion', 'warn', 'IMPLICIT_CONVERSION',
      `${m[1]} 看起来是字符串列，却与数字比较。给值加引号：${m[1]} = '${m[2]}'`, m.index)
  }

  /* --- 大 LIMIT --- */
  const limitRe = /\blimit\s+(\d+)/gi
  while ((m = limitRe.exec(masked)) !== null) {
    const n = Number(m[1])
    if (n >= 10000) {
      add('big-limit', 'warn', 'BIG_LIMIT',
        `一次取 ${n} 行通常不是真实需求。确认是否该用分页，并给排序字段建索引`, m.index)
    }
  }

  /* --- 大 OFFSET --- */
  const offRe = /\blimit\s+\d+\s+offset\s+(\d+)/gi
  while ((m = offRe.exec(masked)) !== null) {
    const n = Number(m[1])
    if (n >= 10000) {
      add('large-offset', 'warn', 'LARGE_OFFSET',
        `OFFSET ${n} 要求数据库先扫描并丢弃前 ${n} 行。改用游标分页：WHERE id > <上一页最后一个 id>`, m.index)
    }
  }

  // 同规则同行不重复
  const seen = new Set<string>()
  return issues.filter(i => {
    const k = `${i.line}:${i.rule}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/* ================= EXPLAIN 解析 ================= */

/** 按扫描行数与访问类型判风险 */
function judgeRisk(type: string, rows: number): { risk: ExplainTable['risk']; note: string } {
  const t = type.toUpperCase()
  // 全表扫描类
  if (t === 'ALL' || t === 'SEQ SCAN' || t === 'TABLE SCAN') {
    if (rows >= 10000) {
      return { risk: 'high', note: `全表扫描 ${rows.toLocaleString('en-US')} 行` }
    }
    return { risk: 'mid', note: `全表扫描 ${rows.toLocaleString('en-US')} 行（表小的话可接受）` }
  }
  // 走索引但扫的行数仍然很多
  if (rows >= 100000) {
    return { risk: 'mid', note: `虽然走了索引，但要扫 ${rows.toLocaleString('en-US')} 行` }
  }
  return { risk: 'low', note: `走索引（${type || '—'}），扫描 ${rows.toLocaleString('en-US')} 行` }
}

/** 递归展开 PG 的 Plan 树 */
function walkPgPlan(node: unknown, out: ExplainTable[]): void {
  if (!node || typeof node !== 'object') return
  const o = node as Record<string, unknown>
  const name = String(o['Relation Name'] ?? o['Index Name'] ?? '')
  const type = String(o['Node Type'] ?? '')
  if (name || type) {
    const rows = Number(o['Plan Rows'] ?? o['Actual Rows'] ?? 0) || 0
    const j = judgeRisk(type, rows)
    out.push({
      name: name || '(unnamed)',
      type,
      rows,
      key: String(o['Index Name'] ?? ''),
      possibleKeys: '',
      filtered: 0,
      extra: String(o['Filter'] ?? o['Hash Cond'] ?? o['Join Filter'] ?? ''),
      risk: j.risk,
      note: j.note,
    })
  }
  const children = o.Plans
  if (Array.isArray(children)) for (const c of children) walkPgPlan(c, out)
}

/**
 * 递归展开 MySQL 8 的 `EXPLAIN FORMAT=JSON`。
 *
 * 形状是 `{ query_block: { table: {...} } }`，
 * `query_block` 里可能直接是 `table`，也可能是 `ordering_operation` /
 * `nested_loop` 之类的包装节点，所以每一层都要往下看。
 */
function walkMysqlJson(node: unknown, out: ExplainTable[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 8) return
  const o = node as Record<string, unknown>

  if (o.table_name) {
    const type = String(o.access_type ?? '')
    const rows = Number(o.rows_examined_per_scan ?? 0) || 0
    const j = judgeRisk(type, rows)
    out.push({
      name: String(o.table_name),
      type,
      rows,
      key: String(o.key ?? ''),
      possibleKeys: Array.isArray(o.possible_keys) ? o.possible_keys.map(String).join(', ') : '',
      filtered: Number(o.filtered ?? 0) || 0,
      extra: String(o.Extra ?? ''),
      risk: j.risk,
      note: j.note,
    })
  }

  // join 的每个分支
  const loop = o.nested_loop
  if (Array.isArray(loop)) {
    for (const branch of loop) {
      const b = branch as Record<string, unknown>
      if (b && typeof b === 'object' && b.table) walkMysqlJson(b.table, out, depth + 1)
    }
  }
  // 常见的包装节点：继续往下走
  for (const key of ['table', 'query_block', 'ordering_operation', 'grouping_operation', 'duplicates_removal', 'materialize_from_subquery', 'attached_subqueries']) {
    if (o[key]) walkMysqlJson(o[key], out, depth + 1)
  }
}

/** 解析传统文本表（MySQL CLI / markdown 表格的 EXPLAIN 输出） */
function parseTextTable(text: string, dialect: 'mysql' | 'postgres'): ExplainTable[] {
  const out: ExplainTable[] = []
  // 有表头时按列名定位，MySQL 8 的 12 列与 5.7 的 10 列都能对上
  let colMap: Record<string, number> | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 5) continue
    // 分隔行（CLI 无此行，markdown 是 | --- | :---: |）
    if (cells.every(c => /^:?-+:?$/.test(c))) continue
    // 表头行：记录列名 → 下标
    if (cells.some(c => /^table$/i.test(c)) && cells.some(c => /^type$/i.test(c))) {
      colMap = {}
      cells.forEach((c, i) => { colMap![c.toLowerCase()] = i })
      continue
    }
    let name: string, type: string, rows: number, key: string, possibleKeys: string, filtered: number, extra: string
    if (colMap) {
      const g = (k: string) => (colMap![k] != null ? cells[colMap![k]] ?? '' : '')
      name = g('table')
      type = g('type')
      rows = Number(g('rows').replace(/[^\d.]/g, '')) || 0
      key = g('key')
      possibleKeys = g('possible_keys')
      filtered = Number(g('filtered').replace(/[^\d.]/g, '')) || 0
      extra = g('extra')
    } else {
      // 无表头：退回旧的固定列序假设（PG 少一列 select_type）
      const off = dialect === 'postgres' ? 1 : 0
      name = cells[2 + off]
      type = cells[3 + off]
      rows = Number(cells[4 + off]?.replace(/[^\d.]/g, '')) || 0
      key = cells[5 + off] ?? ''
      possibleKeys = ''
      filtered = 0
      extra = cells.slice(6).join(' ')
    }
    if (!name) continue
    const j = judgeRisk(type, rows)
    out.push({ name, type, rows, key, possibleKeys, filtered, extra, risk: j.risk, note: j.note })
  }
  return out
}

/**
 * 解析 MySQL 结果集导出的行对象数组（Navicat / DBeaver 复制为 JSON）。
 * 列名大小写不敏感，取 table / type / rows / key / Extra。
 */
function fromMysqlRows(rows: unknown[], out: ExplainTable[]): void {
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(r as Record<string, unknown>)) {
      o[k.toLowerCase()] = (r as Record<string, unknown>)[k]
    }
    const str = (v: unknown) => (v == null ? '' : String(v))
    const name = str(o.table)
    if (!name) continue
    const type = str(o.type)
    const rowNum = Number(str(o.rows).replace(/[^\d.]/g, '')) || 0
    const j = judgeRisk(type, rowNum)
    out.push({
      name, type, rows: rowNum,
      key: str(o.key),
      possibleKeys: str(o.possible_keys),
      filtered: Number(str(o.filtered).replace(/[^\d.]/g, '')) || 0,
      extra: str(o.extra),
      risk: j.risk, note: j.note,
    })
  }
}

/**
 * 解析 EXPLAIN 输出。
 *
 * 优先按 JSON 解析（MySQL 8 / PG 都支持 `EXPLAIN (FORMAT JSON)`），
 * 失败再退回文本表格 —— 用户从 CLI 复制出来的通常是后者。
 *
 * @param input 粘进来的文本或 JSON
 * @param dialect 方言，影响文本表格的列序假设
 */
export function parseExplain(input: string, dialect: 'mysql' | 'postgres' = 'mysql'): ExplainResult {
  const raw = input.trim()
  if (!raw) {
    // 解析不出来时给一句可执行的提示 —— 空数组加「无法识别」等于让用户猜
  return { tables: [], summary: ['UNPARSED'], unparsed: true }
  }

  // 尝试 JSON
  try {
    const parsed: unknown = JSON.parse(raw)
    const tables: ExplainTable[] = []
    if (Array.isArray(parsed)) {
      // PG: [ { Plan: {...} } ]
      for (const item of parsed) walkPgPlan((item as Record<string, unknown>)?.Plan, tables)
      // MySQL 结果集导出的行对象数组（Navicat / DBeaver）
      if (!tables.length) fromMysqlRows(parsed, tables)
    } else if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>
      if ('Plan' in o) walkPgPlan(o.Plan, tables)
      if ('query_block' in o) walkMysqlJson(o.query_block, tables)
      if (!tables.length) fromMysqlRows([o], tables)
    }
    if (tables.length) return { tables, summary: buildSummary(tables), unparsed: false }
  } catch {
    // 不是 JSON，走文本表格
  }

  const tables = parseTextTable(raw, dialect)
  if (tables.length) return { tables, summary: buildSummary(tables), unparsed: false }

  return { tables: [], summary: ['UNPARSED'], unparsed: true }
}

function buildSummary(tables: ExplainTable[]): string[] {
  const out: string[] = []
  const high = tables.filter(t => t.risk === 'high')
  const mid = tables.filter(t => t.risk === 'mid')
  for (const t of high) out.push(`HIGH:${t.name} ${t.note}`)
  for (const t of mid) out.push(`MID:${t.name} ${t.note}`)
  const total = tables.reduce((n, t) => n + t.rows, 0)
  if (total > 0) out.push(`TOTAL_ROWS:${total}`)
  return out
}

/* ================= 索引建议 ================= */

/** 常见的主键/唯一列名：这些列通常已有索引，不该再建议 */
const LIKELY_KEY = new Set(['id', 'pk', '_id', 'uuid', 'guid'])

/**
 * 根据 WHERE 列与告警类型给索引建议。
 *
 * 多个列**合并成一条复合索引**而不是给多条单列：复合索引的列顺序有讲究，
 * 而且给用户三条单列建议只会让他建三个重复的索引。
 *
 * @param table 表名；传空串表示从 SQL 里没解析出来
 * @param columns 参与过滤的列
 * @param issues 静态检查结果（决定建议的理由）
 */
export function suggestIndex(
  table: string,
  columns: readonly string[],
  issues: readonly SqlIssue[],
): IndexSuggestion[] {
  const t = (table || 't').replace(/[^a-z0-9_]/gi, '')
  if (!t || columns.length === 0) return []

  const cols = columns
    .map(c => c.split('.').pop() ?? c) // t.col → col
    .map(c => c.toLowerCase())
    .filter(c => c && !LIKELY_KEY.has(c)) // id 之类通常是主键
    .filter((c, i, arr) => arr.indexOf(c) === i) // 去重

  if (cols.length === 0) return []

  // 挑一个最能解释「为什么要这个索引」的规则
  const REASON: Record<string, string> = {
    'like-prefix': '前导 % 让索引失效，索引可让等值/后缀匹配走索引',
    'function-on-column': '列被函数包裹时索引失效，改为范围条件后可走索引',
    'implicit-conversion': '隐式类型转换使索引失效',
    'or-condition': 'OR 分支各自走索引',
    'large-offset': '游标分页需要该列有序索引',
    'not-in': 'NOT EXISTS 改写后可用该列索引',
    'select-star': '减少读取的列可降低 I/O',
  }
  const reason = issues.map(i => REASON[i.rule]).find(Boolean) ?? '常用过滤条件'

  const name = `idx_${t}_${cols.join('_')}`.slice(0, 60)
  return [{
    table: t,
    name,
    columns: cols,
    reason,
    sql: `CREATE INDEX ${name} ON ${t} (${cols.join(', ')});`,
  }]
}
