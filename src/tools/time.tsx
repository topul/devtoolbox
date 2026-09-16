import React, { useState, useMemo, useEffect } from 'react'
import { Btn, TA, Input, Select, ErrorNote, Panel, KV, Stat, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { timeL } from '../lib/locales/time'

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

  const tsResult = useMemo((): { error: string | null; date: Date | null } | null => {
    if (!ts.trim()) return null
    const n = parseFloat(ts)
    if (isNaN(n)) return { error: l.errInvalid, date: null }
    const ms = unit === 's' ? n * 1000 : n
    const d = new Date(ms)
    if (isNaN(d.getTime())) return { error: l.errRange, date: null }
    return { error: null, date: d }
  }, [ts, unit, l])

  const strResult = useMemo((): { error: string | null; date: Date | null } | null => {
    if (!dateStr.trim()) return null
    const d = new Date(dateStr.replace(/-/g, '/'))
    if (isNaN(d.getTime())) return { error: l.errParse, date: null }
    return { error: null, date: d }
  }, [dateStr, l])

  const fmt = (d: Date) => {
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  return (
    <div className="space-y-4">
      <Panel title={l.currentTitle}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Stat label={l.unixSec} value={Math.floor(now / 1000)} />
          <Stat label={l.unixMs} value={now} />
          <div className="border border-line-soft bg-panel-2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted">{l.localTime}</div>
            <div className="text-lg text-phosphor glow leading-tight">{fmt(new Date(now))}</div>
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
            {tsResult?.date && (
              <div>
                <KV k={l.local} v={<>{fmt(tsResult.date)} <CopyBtn text={fmt(tsResult.date)} /></>} />
                <KV k={l.utc} v={tsResult.date.toUTCString()} />
                <KV k={l.iso} v={tsResult.date.toISOString()} />
              </div>
            )}
          </div>
        </Panel>
        <Panel title={l.dateToTsTitle}>
          <div className="space-y-3">
            <Input value={dateStr} onChange={setDateStr} placeholder="2026-08-13 12:00:00" />
            {strResult?.error && <ErrorNote msg={strResult.error} />}
            {strResult?.date && (
              <div>
                <KV k={l.unixSec} v={<>{Math.floor(strResult.date.getTime() / 1000)} <CopyBtn text={String(Math.floor(strResult.date.getTime() / 1000))} /></>} />
                <KV k={l.unixMs} v={<>{strResult.date.getTime()} <CopyBtn text={String(strResult.date.getTime())} /></>} />
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ================= Crontab ================= */

function cronNextRuns(expr: string, count: number, c: typeof timeL['zh']['cron']): Date[] | string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return c.errNeed5
  const parseField = (f: string, min: number, max: number): number[] | string => {
    const vals = new Set<number>()
    for (const seg of f.split(',')) {
      const stepMatch = seg.match(/^(.+)\/(\d+)$/)
      let range = stepMatch ? stepMatch[1] : seg
      const step = stepMatch ? parseInt(stepMatch[2]) : 1
      let lo = min, hi = max
      if (range !== '*') {
        const m = range.match(/^(\d+)(?:-(\d+))?$/)
        if (!m) return c.fieldParse(f)
        lo = parseInt(m[1]); hi = m[2] ? parseInt(m[2]) : lo
        if (lo < min || hi > max) return c.fieldRange(f, min, max)
      }
      for (let i = lo; i <= hi; i += step) vals.add(i)
    }
    return [...vals].sort((a, b) => a - b)
  }
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]
  const sets: number[][] = []
  for (let i = 0; i < 5; i++) {
    const r = parseField(parts[i], ranges[i][0], ranges[i][1])
    if (typeof r === 'string') return r
    sets.push(r)
  }
  const out: Date[] = []
  const start = new Date()
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  const cursor = new Date(start)
  let guard = 0
  while (out.length < count && guard++ < 200000) {
    const mo = cursor.getMonth() + 1, dom = cursor.getDate(), dow = cursor.getDay()
    const h = cursor.getHours(), mi = cursor.getMinutes()
    if (sets[3].includes(mo) && sets[2].includes(dom) && sets[4].includes(dow) && sets[1].includes(h) && sets[0].includes(mi)) {
      out.push(new Date(cursor))
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return out
}

export function CronTool() {
  const l = useLocalized(timeL).cron
  const [expr, setExpr] = useState('0 3 * * 1-5')

  const desc = useMemo(() => {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return null
    return parts.map((p, i) => {
      if (p === '*') return l.fieldAll(l.cronNames[i])
      if (p.startsWith('*/')) return l.fieldStep(p.slice(2), l.cronNames[i])
      if (p.includes(',')) return l.fieldList(l.cronNames[i], p)
      if (p.includes('-')) return l.fieldRangeFmt(l.cronNames[i], p)
      return l.fieldEq(l.cronNames[i], p)
    }).join(l.sep)
  }, [expr, l])

  const next = useMemo(() => cronNextRuns(expr, 8, l), [expr, l])

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
      {typeof next === 'string' ? <ErrorNote msg={next} /> : (
        <Panel title={l.nextTitle}>
          {next.map((d, i) => (
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
    const da = new Date(a.replace(/-/g, '/')), db = new Date(b.replace(/-/g, '/'))
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return { error: l.errInvalid }
    const ms = Math.abs(db.getTime() - da.getTime())
    return {
      days: Math.floor(ms / 86400000),
      hours: Math.floor(ms / 3600000),
      minutes: Math.floor(ms / 60000),
      seconds: Math.floor(ms / 1000),
      weeks: (ms / 604800000).toFixed(1),
      direction: db >= da ? l.dirLater : l.dirEarlier,
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
          <Stat label={l.direction} value={<span className="text-sm">{r.direction}</span>} />
        </div>
      )}
    </div>
  )
}
