import React, { useState, useMemo, useEffect } from 'react'
import { Btn, TA, Input, Select, ErrorNote, Panel, KV, Stat, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { timeL } from '../lib/locales/time'
import {
  cronNextRuns,
  cronParseFields,
  dateDiff,
  dateToTimestamp,
  formatLocal,
  timestampToDate,
  type CronError,
} from '../lib/toolkit'

/* 实现全部来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码。
   toolkit 只返回结构化结果与错误码，文案在这里按当前语言渲染。 */

/* ================= Timestamp ================= */

export function TimestampTool() {
  const l = useLocalized(timeL).timestamp
  const [now, setNow] = useState(() => Date.now())
  const [ts, setTs] = useState('')
  const [unit, setUnit] = useState<'s' | 'ms'>('s')
  const [dateStr, setDateStr] = useState('')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const tsResult = useMemo((): { error: string | null; parts: ReturnType<typeof timestampToDate> | null } | null => {
    if (!ts.trim()) return null
    try {
      return { error: null, parts: timestampToDate(ts, unit) }
    } catch (e) {
      const code = (e as Error).message
      return { error: code === 'INVALID_NUMBER' ? l.errInvalid : l.errRange, parts: null }
    }
  }, [ts, unit, l])

  const strResult = useMemo((): { error: string | null; parts: ReturnType<typeof dateToTimestamp> | null } | null => {
    if (!dateStr.trim()) return null
    try {
      return { error: null, parts: dateToTimestamp(dateStr) }
    } catch {
      return { error: l.errParse, parts: null }
    }
  }, [dateStr, l])

  return (
    <div className="space-y-4">
      <Panel title={l.currentTitle}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Stat label={l.unixSec} value={Math.floor(now / 1000)} />
          <Stat label={l.unixMs} value={now} />
          <div className="border border-line-soft bg-panel-2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted">{l.localTime}</div>
            <div className="text-lg text-phosphor glow leading-tight">{formatLocal(new Date(now))}</div>
          </div>
        </div>
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title={l.tsToDateTitle}>
          <div className="space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Input value={ts} onChange={setTs} placeholder={l.tsPlaceholder} /></div>
              <Select value={unit} onChange={v => setUnit(v as 's' | 'ms')} options={[
                { value: 's', label: l.unitSec }, { value: 'ms', label: l.unitMs },
              ]} />
            </div>
            {tsResult?.error && <ErrorNote msg={tsResult.error} />}
            {tsResult?.parts && (
              <div>
                <KV k={l.local} v={<>{tsResult.parts.local} <CopyBtn text={tsResult.parts.local} /></>} />
                <KV k={l.utc} v={tsResult.parts.utc} />
                <KV k={l.iso} v={tsResult.parts.iso} />
              </div>
            )}
          </div>
        </Panel>
        <Panel title={l.dateToTsTitle}>
          <div className="space-y-3">
            <Input value={dateStr} onChange={setDateStr} placeholder="2026-08-13 12:00:00" />
            {strResult?.error && <ErrorNote msg={strResult.error} />}
            {strResult?.parts && (
              <div>
                <KV k={l.unixSec} v={<>{strResult.parts.unixSec} <CopyBtn text={String(strResult.parts.unixSec)} /></>} />
                <KV k={l.unixMs} v={<>{strResult.parts.unixMs} <CopyBtn text={String(strResult.parts.unixMs)} /></>} />
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ================= Crontab ================= */

export function CronTool() {
  const l = useLocalized(timeL).cron
  const [expr, setExpr] = useState('0 3 * * 1-5')

  const parsed = useMemo(() => cronParseFields(expr), [expr])

  const desc = useMemo(() => {
    if (!parsed.ok) return null
    return parsed.fields.map((f, i) => {
      const name = l.cronNames[i]
      switch (f.kind) {
        case 'all': return l.fieldAll(name)
        case 'step': return l.fieldStep(f.raw.slice(2), name)
        case 'list': return l.fieldList(name, f.raw)
        case 'range': return l.fieldRangeFmt(name, f.raw)
        default: return l.fieldEq(name, f.raw)
      }
    }).join(l.sep)
  }, [parsed, l])

  const errText = (e: CronError): string => {
    if (e.code === 'NEED_5_FIELDS') return l.errNeed5
    if (e.code === 'BAD_FIELD') return l.fieldParse(e.field)
    return l.fieldRange(e.field, e.min, e.max)
  }

  const next = useMemo(() => cronNextRuns(expr, 8), [expr])

  return (
    <div className="space-y-3">
      <Input value={expr} onChange={setExpr} label={l.label} placeholder={l.placeholder} />
      <div className="flex gap-2 flex-wrap">
        {l.presets.map(([name, e]) => (
          <button key={name} onClick={() => setExpr(e)}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {name}
          </button>
        ))}
      </div>
      {desc && (
        <Panel title={l.explainTitle}>
          <p className="text-[13px] text-bright">{desc}</p>
        </Panel>
      )}
      {!next.ok ? <ErrorNote msg={errText(next.error)} /> : (
        <Panel title={l.nextTitle}>
          {next.dates.map((d, i) => (
            <div key={i} className="flex gap-3 py-1 border-b border-line-soft last:border-0 text-[12.5px]">
              <span className="text-muted/60 w-8">#{i + 1}</span>
              <span className="text-phosphor">{d.toLocaleString(l.localeStr, { hour12: false })}</span>
              <span className="text-muted">{l.weekday}{l.dowNames[d.getDay()]}</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}

/* ================= Date Diff ================= */

export function DateDiffTool() {
  const l = useLocalized(timeL).dateDiff
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const r = useMemo(() => {
    if (!a || !b) return null
    try {
      return dateDiff(a, b)
    } catch {
      return { error: l.errInvalid }
    }
  }, [a, b, l])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={a} onChange={setA} label={l.dateA} placeholder={l.phA} />
        <Input value={b} onChange={setB} label={l.dateB} placeholder={l.phB} />
      </div>
      {r && 'error' in r && <ErrorNote msg={r.error!} />}
      {r && !('error' in r) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label={l.days} value={r.days} />
          <Stat label={l.weeks} value={r.weeks} />
          <Stat label={l.hours} value={r.hours.toLocaleString()} />
          <Stat label={l.minutes} value={r.minutes.toLocaleString()} />
          <Stat label={l.direction} value={<span className="text-sm">{r.direction === 1 ? l.dirLater : l.dirEarlier}</span>} />
        </div>
      )}
    </div>
  )
}
