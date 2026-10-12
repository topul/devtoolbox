/**
 * HTTP 请求差异对比：两份原始请求并排解析，高亮方法/路径/头/body 的增删改。
 * 纯本地文本对比（toolkit/httpraw），用于整理越权 / 重放的学习记录。
 */
import React, { useMemo, useState } from 'react'
import { ErrorNote, Panel, TA, ToolShell, usePersistedState } from '../components/ui'
import { HandoffBadge, useDrainHandoff } from '../components/SendTo'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { diffRequests, parseRawRequest, type FieldDiff } from '../lib/toolkit/httpraw'
import { handoffToRaw } from '../lib/handoff'
import { SecNote } from './secnote'

const L = {
  zh: {
    a: '请求 A（基准）',
    b: '请求 B（对比）',
    ph: 'GET /api/orders/1001 HTTP/1.1\nHost: example.com\nCookie: session=user-a\n',
    result: '差异',
    same: '两个请求完全相同。',
    changed: '修改',
    added: 'B 新增',
    removed: 'B 删除',
    kindMethod: '方法',
    kindPath: '请求目标',
    kindHeader: '头',
    kindBody: 'Body',
    parseFail: '请求无法解析，请检查请求行',
  },
  en: {
    a: 'Request A (baseline)',
    b: 'Request B (compare)',
    ph: 'GET /api/orders/1001 HTTP/1.1\nHost: example.com\nCookie: session=user-a\n',
    result: 'Differences',
    same: 'The two requests are identical.',
    changed: 'changed',
    added: 'added in B',
    removed: 'removed in B',
    kindMethod: 'method',
    kindPath: 'target',
    kindHeader: 'header',
    kindBody: 'body',
    parseFail: 'Could not parse request — check the request line',
  },
}

const CHANGE_STYLE = {
  changed: 'border-amber/30 bg-amber/5',
  added: 'border-phosphor/25 bg-phosphor/5',
  removed: 'border-danger/35 bg-danger/5',
} as const

function DiffRow({ d, l }: { d: FieldDiff; l: (typeof L)['zh'] }): React.ReactElement {
  const kindLabel = {
    method: l.kindMethod,
    path: l.kindPath,
    header: `${l.kindHeader}${d.name ? ` · ${d.name}` : ''}`,
    body: l.kindBody,
  }[d.kind]
  const changeLabel = { changed: l.changed, added: l.added, removed: l.removed }[d.change]
  const showBody = d.kind === 'body'
  return (
    <div className={cn('rounded-md border px-3 py-2', CHANGE_STYLE[d.change])}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-phosphor">{kindLabel}</span>
        <span className="text-muted">·</span>
        <span className="text-muted">{changeLabel}</span>
      </div>
      {showBody ? (
        <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
          {d.change !== 'added' && (
            <pre className="codeblock whitespace-pre-wrap break-all text-[11px]">{d.before}</pre>
          )}
          {d.change !== 'removed' && (
            <pre className="codeblock whitespace-pre-wrap break-all text-[11px]">{d.after}</pre>
          )}
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]">
          {d.change !== 'added' && d.before !== '' && (
            <code className="rounded bg-panel-2 px-1.5 py-0.5 text-danger/90 break-all line-through decoration-danger/50">
              {d.before}
            </code>
          )}
          {d.change !== 'removed' && d.after !== '' && (
            <code className="rounded bg-panel-2 px-1.5 py-0.5 text-phosphor break-all">
              {d.after}
            </code>
          )}
        </div>
      )}
    </div>
  )
}

export function ReqDiffTool() {
  const l = useLocalized(L)
  const [a, setA] = usePersistedState('reqdiff', 'a', '')
  const [b, setB] = usePersistedState('reqdiff', 'b', '')
  const [fromA, setFromA] = useState<string | null>(null)
  const [fromB, setFromB] = useState<string | null>(null)
  // 两条分别送：送 A 时页面挂载消费 A，再送 B 时回来消费 B（A 已留在文本框里）
  useDrainHandoff('reqdiff-a', (env) => {
    setA(handoffToRaw(env))
    setFromA(env.sourceLabel)
  })
  useDrainHandoff('reqdiff-b', (env) => {
    setB(handoffToRaw(env))
    setFromB(env.sourceLabel)
  })

  const parsed = useMemo(() => {
    if (!a.trim() || !b.trim()) return null
    const pa = parseRawRequest(a)
    const pb = parseRawRequest(b)
    if (!pa.ok || !pb.ok) return { error: true as const }
    return { error: false as const, diffs: diffRequests(pa.request!, pb.request!) }
  }, [a, b])

  return (
    <ToolShell toolId="reqdiff">
      <SecNote scene="reqdiff" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          {fromA && <HandoffBadge label={fromA} onClear={() => setFromA(null)} />}
          <TA
            toolInput
            spellCheck
            value={a}
            onChange={(v) => {
              setA(v)
              setFromA(null)
            }}
            label={l.a}
            placeholder={l.ph}
            rows={9}
          />
        </div>
        <div className="space-y-1.5">
          {fromB && <HandoffBadge label={fromB} onClear={() => setFromB(null)} />}
          <TA
            toolInput
            spellCheck
            value={b}
            onChange={(v) => {
              setB(v)
              setFromB(null)
            }}
            label={l.b}
            placeholder={l.ph.replace('user-a', 'user-b').replace('1001', '1002')}
            rows={9}
          />
        </div>
      </div>
      {parsed?.error && <ErrorNote msg={l.parseFail} />}
      {parsed && !parsed.error && (
        <Panel title={`${l.result} · ${parsed.diffs.length}`}>
          {parsed.diffs.length === 0 ? (
            <p className="text-[12px] text-phosphor">{l.same}</p>
          ) : (
            <div className="space-y-2">
              {parsed.diffs.map((d, i) => (
                <DiffRow key={i} d={d} l={l} />
              ))}
            </div>
          )}
        </Panel>
      )}
    </ToolShell>
  )
}
