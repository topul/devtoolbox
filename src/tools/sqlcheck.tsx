import React, { useState, useMemo } from 'react'
import {
  Btn,
  TA,
  Select,
  Panel,
  Collapse,
  ResultPanel,
  ErrorNote,
  usePersistedState,
  ToolGuide,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { sqlCheckL } from '../lib/locales/sqlcheck'
import {
  lintSql,
  parseExplain,
  suggestIndex,
  extractTable,
  whereColumns,
  type SqlIssue,
} from '../lib/toolkit'

const SAMPLE_SQL = `SELECT *
FROM users
WHERE name LIKE '%admin%'
  AND user_id = '10086'
  AND status NOT IN (0, 1, 2)
  AND org_id = 42
ORDER BY created_at
LIMIT 50000;`

const SAMPLE_EXPLAIN = `+------+-------------+-----------+-------------+-------+-------------+
| id   | select_type | table     | type        | rows | Extra        |
+------+-------------+-----------+-------------+-------+-------------+
|    1 | SIMPLE      | users     | ALL         | 152000 | Using where |
|    2 | SIMPLE      | orders    | index       | 12  | Using index|
+------+-------------+-----------+-------------+-------+-------------+`

const SEV_CLS: Record<SqlIssue['severity'], string> = {
  error: 'text-danger border-danger/40',
  warn: 'text-amber border-amber/40',
  info: 'text-muted border-line-soft',
}

/**
 * SQL 检查：静态规则 + EXPLAIN 解读。
 *
 * 全部本地计算，不连数据库 —— 跨平台、无需配连接串、也没有隐私顾虑。
 * 真实执行计划由用户从自己的库里贴进来（EXPLAIN 页签）。
 */
export function SqlCheckTool() {
  const l = useLocalized(sqlCheckL)
  const [tab, setTab] = useState<'lint' | 'explain'>('lint')

  return (
    <div className="space-y-3">
      <ToolGuide title={l.title} steps={[l.sub, l.check, l.explainInput]} note={l.localOnly} />

      <div className="flex gap-1.5">
        {(['lint', 'explain'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-2.5 py-1 text-[12px] border transition-colors ${
              tab === k
                ? 'border-phosphor text-phosphor'
                : 'border-line-soft text-muted hover:text-bright'
            }`}
          >
            {k === 'lint' ? l.tabLint : l.tabExplain}
          </button>
        ))}
      </div>

      {tab === 'lint' ? <LintTab /> : <ExplainTab />}
    </div>
  )
}

function LintTab() {
  const l = useLocalized(sqlCheckL)
  const [sql, setSql, { clear }] = usePersistedState('sql-check', 'sql', '')

  const issues = useMemo(() => {
    try {
      return lintSql(sql)
    } catch {
      return []
    }
  }, [sql])

  const suggestions = useMemo(() => {
    if (issues.length === 0) return []
    // 取表名与 WHERE 列：从第一条告警的 snippet 里粗略提取，
    // 精确解析在 toolkit 里，这里只为了给出可执行的 CREATE INDEX
    const table = extractTable(sql)
    return suggestIndex(table, whereColumns(sql), issues)
  }, [sql, issues])

  return (
    <div className="space-y-3">
      <Panel
        title={l.sql}
        right={
          <div className="flex gap-1.5">
            <Btn variant="ghost" onClick={() => setSql(SAMPLE_SQL)}>
              {l.loadSample}
            </Btn>
            <Btn variant="ghost" onClick={clear}>
              {l.clear}
            </Btn>
          </div>
        }
      >
        <TA value={sql} onChange={setSql} rows={8} placeholder={l.sqlPh} />
      </Panel>

      {issues.length === 0 ? (
        sql.trim() ? (
          <Panel title={l.issues}>
            <p className="text-[12px] text-phosphor">{l.noIssues}</p>
            <p className="text-[11.5px] text-muted mt-1">{l.noIssuesHint}</p>
          </Panel>
        ) : null
      ) : (
        <>
          <div className="text-[12px] text-muted">
            {l.issueCount.replace('{n}', String(issues.length))}
          </div>
          {issues.map((i, idx) => (
            <div
              key={`${i.line}-${i.rule}-${idx}`}
              className={`border-l-2 bg-panel-2 px-3 py-2 ${SEV_CLS[i.severity]}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[12.5px] font-medium">
                  {l.rules[i.message as keyof typeof l.rules] ?? i.message}
                </span>
                <span className="text-[11px] opacity-70">L{i.line}</span>
                <span className="text-[10.5px] opacity-60 ml-auto">{l.severity[i.severity]}</span>
              </div>
              <div className="text-[11.5px] opacity-85 mt-0.5">
                {l.hints[i.message as keyof typeof l.hints] ?? i.hint}
              </div>
              {i.snippet && (
                <pre className="text-[11px] opacity-60 mt-1 font-mono break-all">{i.snippet}</pre>
              )}
            </div>
          ))}
        </>
      )}

      {suggestions.length > 0 && (
        <Panel title={l.indexSuggest}>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.name}>
                <p className="text-[11.5px] text-muted mb-1">{s.reason}</p>
                <ResultPanel title={s.name} text={s.sql} maxHeight={80} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Collapse title={l.limitation}>
        <p className="text-[12px] text-muted">{l.limitation}</p>
      </Collapse>
    </div>
  )
}

function ExplainTab() {
  const l = useLocalized(sqlCheckL)
  const [input, setInput, { clear }] = usePersistedState('sql-check', 'explain', '')
  const [dialect, setDialect] = usePersistedState<'mysql' | 'postgres'>(
    'sql-check',
    'dialect',
    'mysql',
  )

  const result = useMemo(() => {
    if (!input.trim()) return null
    try {
      return parseExplain(input, dialect)
    } catch {
      return { tables: [], summary: [], unparsed: true }
    }
  }, [input, dialect])

  return (
    <div className="space-y-3">
      <Panel
        title={l.explainInput}
        right={
          <div className="flex gap-1.5">
            <Btn variant="ghost" onClick={() => setInput(SAMPLE_EXPLAIN)}>
              {l.loadSample}
            </Btn>
            <Btn variant="ghost" onClick={clear}>
              {l.clear}
            </Btn>
          </div>
        }
      >
        <div className="w-32 mb-2">
          <Select
            value={dialect}
            onChange={(v) => setDialect(v as 'mysql' | 'postgres')}
            label={l.dialect}
            options={[
              { value: 'mysql', label: 'MySQL' },
              { value: 'postgres', label: 'PostgreSQL' },
            ]}
          />
        </div>
        <TA value={input} onChange={setInput} rows={8} placeholder={l.explainPh} />
      </Panel>

      {!result && <p className="text-[12px] text-muted">{l.noExplain}</p>}

      {result?.unparsed && <ErrorNote msg={l.unparsed} />}

      {result && result.tables.length > 0 && (
        <div className="space-y-2">
          {result.tables.map((t, i) => (
            <div
              key={`${t.name}-${i}`}
              className={`border-l-2 bg-panel-2 px-3 py-2 ${
                t.risk === 'high'
                  ? 'border-danger'
                  : t.risk === 'mid'
                    ? 'border-amber'
                    : 'border-phosphor/40'
              }`}
            >
              <div className="flex items-baseline gap-2 text-[12.5px]">
                <span className="text-bright font-medium break-all">{t.name}</span>
                <span className="text-muted">{t.type || '—'}</span>
                <span className="text-muted ml-auto">
                  {t.risk === 'high' ? (
                    <span className="text-danger">{l.risk.high}</span>
                  ) : t.risk === 'mid' ? (
                    <span className="text-amber">{l.risk.mid}</span>
                  ) : (
                    <span className="text-phosphor">{l.risk.low}</span>
                  )}
                </span>
              </div>
              <div className="text-[11.5px] text-muted mt-0.5">
                {l.rows}: {t.rows.toLocaleString('en-US')}
                {' · '}
                {l.key}: {t.key || l.noKey}
                {!t.key && t.possibleKeys && ` · ${l.possibleKeys}: ${t.possibleKeys}`}
                {t.filtered > 0 && ` · ${l.filtered}: ${t.filtered}%`}
                {t.extra && ` · ${t.extra}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
