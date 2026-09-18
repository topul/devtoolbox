import React, { useState, useMemo } from 'react'
import { Btn, TA, Input, ErrorNote, Panel, Stat, Select, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { textL } from '../lib/locales/text'
import {
  applyLineOp,
  convertCaseAll,
  lineDiff,
  regexTest,
  textStats,
  LINE_OPS,
  type DiffLine,
} from '../lib/toolkit'

/* 实现全部来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码。 */

/* ================= Text Diff ================= */

export function DiffTool() {
  const l = useLocalized(textL).diff
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [result, setResult] = useState<DiffLine[] | null>(null)

  const compare = () => setResult(lineDiff(a, b))
  const stats = useMemo(() => {
    if (!result) return null
    return {
      add: result.filter(r => r.type === 'add').length,
      del: result.filter(r => r.type === 'del').length,
      same: result.filter(r => r.type === 'same').length,
    }
  }, [result])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TA value={a} onChange={setA} label={l.inputA} rows={8} />
        <TA value={b} onChange={setB} label={l.inputB} rows={8} />
      </div>
      <Btn variant="primary" onClick={compare}>{l.compare}</Btn>
      {result && stats && (
        <div className="space-y-3">
          <div className="flex gap-4 text-[12px]">
            <span className="text-phosphor">+ {stats.add} {l.added}</span>
            <span className="text-danger">− {stats.del} {l.deleted}</span>
            <span className="text-muted">= {stats.same} {l.unchanged}</span>
          </div>
          <div className="border border-line-soft bg-panel-2 max-h-[480px] overflow-auto">
            {result.map((r, i) => (
              <div key={i} className={`flex px-2 text-[12px] leading-6 ${
                r.type === 'add' ? 'bg-phosphor-faint text-phosphor' :
                r.type === 'del' ? 'bg-danger/10 text-danger line-through decoration-danger/50' : 'text-dim'
              }`}>
                <span className="w-6 shrink-0 select-none text-muted/60">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
                <span className="whitespace-pre-wrap break-all">{r.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= Regex Tester ================= */

export function RegexTool() {
  const l = useLocalized(textL).regex
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const matches = useMemo(() => {
    setErr(null)
    if (!pattern) return null
    try {
      return regexTest(pattern, flags, text)
    } catch (e) {
      setErr(l.errorPrefix + (e as Error).message)
      return null
    }
  }, [pattern, flags, text, l])

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <Input value={pattern} onChange={setPattern} label={l.patternLabel} placeholder={l.patternPh} />
        </div>
        <Select value={flags} onChange={setFlags} label={l.flagsLabel} options={l.flags} />
      </div>
      <div className="flex gap-2 flex-wrap">
        {l.presets.map(p => (
          <button key={p.name} onClick={() => setPattern(p.pattern)}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {p.name}
          </button>
        ))}
      </div>
      <TA value={text} onChange={setText} label={l.testText} rows={6} />
      <ErrorNote msg={err} />
      {matches && (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">{l.matchesPre}<span className="text-phosphor">{matches.length}</span>{l.matchesSuf}</div>
          <div className="border border-line-soft bg-panel-2 max-h-[320px] overflow-auto">
            {matches.map((m, i) => (
              <div key={i} className="flex gap-3 px-3 py-1.5 border-b border-line-soft last:border-0 text-[12px]">
                <span className="text-muted/60 w-8 shrink-0">#{i + 1}</span>
                <span className="text-phosphor break-all">{m.match}</span>
                <span className="text-muted shrink-0">@{m.index}</span>
                {m.groups.length > 0 && (
                  <span className="text-amber break-all">{l.groups}{m.groups.map(g => JSON.stringify(g)).join(', ')}</span>
                )}
              </div>
            ))}
            {matches.length === 0 && <div className="px-3 py-2 text-muted text-[12px]">{l.noMatch}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= Word Count ================= */

export function WordCountTool() {
  const l = useLocalized(textL).wordCount
  const [text, setText] = useState('')
  const s = useMemo(() => textStats(text), [text])
  return (
    <div className="space-y-3">
      <TA value={text} onChange={setText} label={l.label} rows={9} placeholder={l.ph} />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Stat label={l.chars} value={s.chars} />
        <Stat label={l.noSpace} value={s.charsNoSpace} />
        <Stat label={l.cjk} value={s.cjk} />
        <Stat label={l.words} value={s.words} />
        <Stat label={l.lines} value={s.lines} />
        <Stat label={l.paragraphs} value={s.paragraphs} />
        <Stat label={l.bytes} value={s.bytes} />
      </div>
    </div>
  )
}

/* ================= Case Converter ================= */

/** 展示名与编程风格的差异只在 SCREAMING 这一项，保持界面文案不变 */
const STYLE_LABEL: Record<string, string> = { SCREAMING_SNAKE: 'SCREAMING' }

export function CaseTool() {
  const l = useLocalized(textL).case
  const [input, setInput] = useState('')
  const out = useMemo(() => {
    const rows = convertCaseAll(input)
    if (!rows[0]?.value) return null
    return rows
  }, [input])
  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label={l.label} placeholder={l.ph} />
      {out && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {out.map(({ style, value }) => (
            <div key={style} className="border border-line-soft bg-panel-2 px-3 py-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">{STYLE_LABEL[style] ?? style}</div>
                <div className="text-phosphor text-[13px] break-all">{value}</div>
              </div>
              <CopyBtn text={value} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= Line Ops ================= */

export function LineOpsTool() {
  const l = useLocalized(textL).lineOps
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} rows={7} />
      <div className="flex gap-2 flex-wrap">
        {l.ops.map((name, i) => (
          <Btn key={name} onClick={() => setOutput(applyLineOp(input, LINE_OPS[i]))}>{name}</Btn>
        ))}
      </div>
      <TA value={output} readOnly label={l.output} rows={7} />
    </div>
  )
}
