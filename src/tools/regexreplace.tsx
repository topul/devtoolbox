import React, { useState, useMemo } from 'react'
import {
  Btn, TA, Input, Select, ErrorNote, Panel, Collapse,
  ResultPanel, usePersistedState, ToolGuide,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { regexReplaceL } from '../lib/locales/regexreplace'
import {
  collectReplacements,
  buildReplacementPreview,
  type Replacement,
} from '../lib/toolkit'

/** 明细列表最多展示多少条 —— 超过就只给前N 条并说明总数 */
const DETAIL_LIMIT = 200

const FLAG_OPTIONS = [
  { value: 'g', label: 'g' },
  { value: 'gi', label: 'gi' },
  { value: 'gm', label: 'gm' },
  { value: 'gim', label: 'gim' },
  { value: 'gms', label: 'gms' },
]

/**
 * 正则替换。
 *
 * 与「正则测试」的区别：那个只读，这个改写。真实重构里需要的是
 * 「先看清会改哪些地方，再决定动不动手」—— 所以默认先给预览，
 * 点了应用才真的产出结果，而不是边输入边改原文。
 */
export function RegexReplaceTool() {
  const l = useLocalized(regexReplaceL)
  const [pattern, setPattern] = usePersistedState('regex-replace', 'pattern', '')
  const [replacement, setReplacement] = usePersistedState('regex-replace', 'replacement', '')
  const [flags, setFlags] = usePersistedState('regex-replace', 'flags', 'g')
  const [input, setInput] = usePersistedState('regex-replace', 'input', '')
  const [applied, setApplied] = useState<string | null>(null)

  // 正则只编译一次：模式或标志任一变化就重算
  const compiled = useMemo((): { re: RegExp; err: string | null } => {
    if (!pattern) return { re: /(?!) /, err: null } // 空模式不预览，但用永不匹配的正则占位
    try {
      return { re: new RegExp(pattern, flags), err: null }
    } catch (e) {
      return { re: /(?!) /, err: (e as Error).message }
    }
  }, [pattern, flags])

  // 预览：命中数 + 前 N 处明细。**不产出替换后的全文** ——
  // 用户改一个字符就重算全文会白费力气，输出等到点应用再生成。
  const preview = useMemo(() => {
    if (!pattern || compiled.err) return null
    return buildReplacementPreview(input, compiled.re, replacement, DETAIL_LIMIT)
  }, [input, pattern, replacement, compiled])

  const details = useMemo((): Replacement[] => {
    if (!pattern || compiled.err || !preview || preview.total === 0) return []
    return collectReplacements(input, compiled.re, replacement, DETAIL_LIMIT)
  }, [input, pattern, replacement, compiled, preview])

  // 实际受影响行数：这是用户判断「值不值得改」的关键数字
  const affectedLines = useMemo(() => {
    if (!details.length) return 0
    const lines = new Set<number>()
    for (const d of details) {
      // 从 index 反推行号：逐段累计换行，比对每行做一次 split 更省
      lines.add(countLinesBefore(input, d.index))
    }
    return lines.size
  }, [details, input])

  const run = () => {
    if (compiled.err) return
    try {
      const r = regexReplaceSafe(input, pattern, replacement, flags)
      setApplied(r)
    } catch {
      setApplied(null)
    }
  }

  const applyTip = applied
    ? { applied: l.applied.replace('{n}', String(countOccurrences(input, applied))) }
    : null

  return (
    <div className="space-y-3">
      <ToolGuide
        title={l.title}
        steps={[l.sub, l.helpTitle, l.preview]}
        note={l.replacePh}
      />

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
        <Input
          value={pattern}
          onChange={setPattern}
          label={l.pattern}
          placeholder={l.patternPh}
          toolInput
        />
        <Input
          value={replacement}
          onChange={setReplacement}
          label={l.replace}
          placeholder={l.replacePh}
        />
        <div className="w-28">
          <Select value={flags} onChange={setFlags} label={l.flags} options={FLAG_OPTIONS} />
        </div>
      </div>

      {compiled.err && <ErrorNote msg={l.invalid.replace('{msg}', compiled.err)} />}

      <TA value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} rows={6} />

      {/* 预览区：先看影响面再动手 */}
      {preview && preview.total > 0 && (
        <Panel
          title={l.preview}
          right={<span className="text-[11px] text-muted">{l.matchCount.replace('{n}', String(preview.total))}</span>}
        >
          <div className="space-y-2">
            <div className="text-[12px] text-muted">
              {l.linesAffected.replace('{n}', String(affectedLines))}
            </div>
            <div className="border border-line-soft max-h-[260px] overflow-auto">
              {details.map((d, i) => (
                <div
                  key={`${d.index}-${i}`}
                  className="flex items-baseline gap-2 px-2 py-1 border-b border-line-soft last:border-0 text-[12px]"
                >
                  <span className="text-muted/60 w-14 shrink-0 shrink-0 tabular-nums">{d.index}</span>
                  <span className="text-danger break-all line-through decoration-danger/40 shrink-0">
                    {d.match || '␀'}
                  </span>
                  <span className="text-muted shrink-0">→</span>
                  <span className="text-phosphor break-all">{d.replacement || '␀'}</span>
                </div>
              ))}
            </div>
            {preview.truncated && (
              <p className="text-[11px] text-muted">
                {l.matchCount.replace('{n}', String(preview.total))}
              </p>
            )}
          </div>
        </Panel>
      )}

      {preview && preview.total === 0 && pattern && !compiled.err && (
        <p className="text-[12px] text-muted">{l.noMatch}</p>
      )}

      <div className="flex gap-2">
        <Btn variant="primary" onClick={run} disabled={!pattern || !!compiled.err || (preview?.total ?? 0) === 0}>
          {l.apply}
        </Btn>
      </div>

      {applied !== null && (
        <ResultPanel title={l.copyResult} text={applied} maxHeight={360} />
      )}

      <Collapse title={l.helpTitle}>
        <ul className="text-[12px] text-muted space-y-1 list-none">
          {l.helpBody.map(x => <li key={x}>{x}</li>)}
        </ul>
      </Collapse>

      <Collapse title={l.tipsTitle}>
        <div className="space-y-1">
          {l.tips.map(t => (
            <button
              key={t.label}
              onClick={() => { setPattern(t.pattern); setReplacement(t.replace) }}
              className="w-full text-left px-2 py-1.5 border border-line-soft text-[12px] hover:border-phosphor/40 hover:bg-phosphor-faint transition-colors"
            >
              <span className="text-phosphor">{t.label}</span>
              <span className="text-muted ml-2 font-mono text-[11px]">{t.pattern}</span>
            </button>
          ))}
        </div>
      </Collapse>

      {applyTip && <p className="text-[11px] text-muted">{applyTip.applied}</p>}
    </div>
  )
}

/** 包一层把BAD_REGEX 变成 null 输出，界面只要处理「成功/失败」两种 */
function regexReplaceSafe(
  text: string, pattern: string, replacement: string, flags: string,
): string | null {
  try {
    return text.replace(new RegExp(pattern, flags), replacement)
  } catch {
    return null
  }
}

/** 数 input 里 index 之前有多少个换行 —— 即该位置所在的行号（0 起） */
function countLinesBefore(text: string, index: number): number {
  let n = 0
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

/** 统计替换结果里「与原文不同」的位置数，用于「已替换 N 处」提示 */
function countOccurrences(before: string, after: string): number {
  let n = 0
  const len = Math.min(before.length, after.length)
  for (let i = 0; i < len; i++) {
    if (before.charCodeAt(i) !== after.charCodeAt(i)) n++
  }
  return n + Math.abs(before.length - after.length)
}
