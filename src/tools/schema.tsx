import React, { useMemo, useState } from 'react'
import { Panel, Btn, TA, ErrorNote, CopyBtn, ToolGuide } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { schemaL } from '../lib/locales/schema'
import {
  parseToolSchema,
  renderSchema,
  summarizeIssues,
  SCHEMA_TARGETS,
  ToolSchemaError,
  type NormalizedTool,
  type SchemaIssue,
  type SchemaTarget,
} from '../lib/toolkit'
import { MCP_TOOLS } from '../lib/mcp-catalog'

/**
 * Tool Schema 互转。
 *
 * 三件事在这里发生：解析（三种输入形态归一）、转换（运行时形态 ⇄ 代码形态）、体检。
 * 体检比转换更值钱 —— schema 写错的表现是「模型乱填参数」，但几乎没人会怀疑 schema 本身。
 */

/** 示例里的说明文字也要跟着语言走，否则英文界面会露出中文 */
function buildExample(l: { toolDesc: string; city: string; days: string; unit: string; tags: string; options: string; alert: string }): string {
  return JSON.stringify(
    [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: l.toolDesc,
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: l.city },
              days: { type: 'integer', description: l.days },
              unit: { type: 'string', enum: ['c', 'f'], description: l.unit },
              tags: { type: 'array', items: { type: 'string' }, description: l.tags },
              options: {
                type: 'object',
                description: l.options,
                properties: {
                  includeAlert: { type: 'boolean', description: l.alert },
                },
                required: ['includeAlert'],
              },
            },
            required: ['city', 'unit'],
          },
        },
      },
    ],
    null,
    2,
  )
}

/** issue 的 path 形如 tools[name].properties.x，取出工具名用于按工具过滤 */
function issueTool(path: string): string | null {
  const m = path.match(/^tools\[([^\]]*)\]/)
  return m ? m[1] : null
}

export function ToolSchemaTool(): React.ReactElement {
  const l = useLocalized(schemaL)
  const [input, setInput] = useState(() => buildExample(l.sample))
  const [target, setTarget] = useState<SchemaTarget>('typescript')
  const [pick, setPick] = useState<number | 'all'>('all')

  const parsed = useMemo((): { tools: NormalizedTool[]; issues: SchemaIssue[]; error: string | null } => {
    try {
      const r = parseToolSchema(input)
      return { ...r, error: null }
    } catch (e) {
      const code = e instanceof ToolSchemaError ? e.code : 'INVALID_JSON'
      return { tools: [], issues: [], error: l.errors[code] ?? code }
    }
  }, [input, l])

  // 输入变化后原来的下标可能越界，这里收敛回「全部」
  const activePick: number | 'all' = typeof pick === 'number' && pick < parsed.tools.length ? pick : 'all'

  const output = useMemo(() => {
    const list = activePick === 'all' ? parsed.tools : [parsed.tools[activePick]].filter(Boolean)
    if (!list.length) return ''
    return renderSchema(list as NormalizedTool[], target)
  }, [parsed.tools, activePick, target])

  const issues = useMemo(() => {
    if (activePick === 'all') return parsed.issues
    const name = parsed.tools[activePick]?.name
    return parsed.issues.filter((i) => issueTool(i.path) === name)
  }, [parsed, activePick])

  const stats = summarizeIssues(parsed.issues)

  const loadSelf = (): void => {
    setInput(
      JSON.stringify(
        {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
        null,
        2,
      ),
    )
    setPick('all')
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted leading-relaxed max-w-[1100px]">{l.intro}</p>

      <ToolGuide title={l.guideTitle} steps={l.guideSteps} />

      <div className="grid grid-cols-1 min-[1700px]:grid-cols-2 gap-3">
        <Panel
          title={l.inputLabel}
          right={
            <div className="flex gap-1.5">
              <Btn variant="ghost" onClick={() => { setInput(buildExample(l.sample)); setPick('all') }}>{l.loadExample}</Btn>
              <Btn variant="ghost" onClick={loadSelf} title={l.loadSelfHint}>{l.loadSelf}</Btn>
              <Btn variant="ghost" onClick={() => { setInput(''); setPick('all') }}>{l.clear}</Btn>
            </div>
          }
        >
          <TA value={input} onChange={setInput} rows={18} placeholder={l.inputPlaceholder} />
          {parsed.error && <div className="mt-2"><ErrorNote msg={parsed.error} /></div>}

          {parsed.tools.length > 1 && (
            <div className="mt-2">
              <div className="text-[11px] text-muted mb-1.5">{l.filterLabel.replace('{n}', String(parsed.tools.length))}</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setPick('all')}
                  className={`px-2 py-0.5 text-[11.5px] border ${activePick === 'all' ? 'border-phosphor/50 text-phosphor bg-phosphor/5' : 'border-line-soft text-muted hover:text-bright'}`}
                >
                  {l.filterAll}
                </button>
                {parsed.tools.map((t, i) => (
                  <button
                    key={`${t.name}-${i}`}
                    onClick={() => setPick(i)}
                    className={`px-2 py-0.5 text-[11.5px] border font-mono ${activePick === i ? 'border-phosphor/50 text-phosphor bg-phosphor/5' : 'border-line-soft text-muted hover:text-bright'}`}
                  >
                    {t.name || '—'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title={l.targetLabel} right={output ? <CopyBtn text={output} /> : undefined}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {SCHEMA_TARGETS.map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className={`px-2.5 py-1 text-[11.5px] border ${target === t ? 'border-phosphor/50 text-phosphor bg-phosphor/5' : 'border-line-soft text-muted hover:text-bright'}`}
              >
                {l.targets[t]}
              </button>
            ))}
          </div>
          <TA value={output} readOnly rows={18} label={l.outputLabel} />
          <p className="text-[11px] text-muted mt-2 leading-relaxed">{l.fmtNote}</p>
        </Panel>
      </div>

      <Panel
        title={l.issuesTitle}
        right={
          parsed.issues.length > 0 ? (
            <span className="text-[11px] text-muted">{l.issuesSummary(stats.errors, stats.warns)}</span>
          ) : undefined
        }
      >
        {!parsed.error && issues.length === 0 && <p className="text-[12px] text-phosphor">{l.issuesClean}</p>}
        {issues.length > 0 && (
          <div className="space-y-0">
            {issues.map((i, idx) => (
              <div key={`${i.path}-${i.code}-${idx}`} className="flex flex-wrap items-baseline gap-x-2 py-1.5 border-b border-line-soft last:border-0">
                <span className={`text-[11px] shrink-0 ${i.level === 'error' ? 'text-danger' : 'text-amber'}`}>
                  {i.level === 'error' ? l.levelError : l.levelWarn}
                </span>
                <span className="text-[12px] text-bright">{l.issueCodes[i.code] ?? i.code}</span>
                <span className="text-[11px] text-muted font-mono break-all">{i.path}</span>
                {i.detail !== undefined && <span className="text-[11px] text-muted/80 font-mono">{i.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <p className="text-[11px] text-muted leading-relaxed">{l.descNote}</p>
    </div>
  )
}
