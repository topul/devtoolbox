import React, { useState, useMemo, useEffect } from 'react'
import { Btn, TA, Input, Select, ErrorNote, Panel, KV, Stat, CopyBtn } from '../components/ui'

/* ================= 时间戳 ================= */

export function TimestampTool() {
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
    if (isNaN(n)) return { error: '无效的时间戳', date: null }
    const ms = unit === 's' ? n * 1000 : n
    const d = new Date(ms)
    if (isNaN(d.getTime())) return { error: '超出有效范围', date: null }
    return { error: null, date: d }
  }, [ts, unit])

  const strResult = useMemo((): { error: string | null; date: Date | null } | null => {
    if (!dateStr.trim()) return null
    const d = new Date(dateStr.replace(/-/g, '/'))
    if (isNaN(d.getTime())) return { error: '无法解析日期，支持格式如 2026-08-13 12:00:00', date: null }
    return { error: null, date: d }
  }, [dateStr])

  const fmt = (d: Date) => {
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  return (
    <div className="space-y-4">
      <Panel title="当前时间">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Stat label="Unix 秒" value={Math.floor(now / 1000)} />
          <Stat label="Unix 毫秒" value={now} />
          <div className="border border-line-soft bg-panel-2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted">本地时间</div>
            <div className="text-lg text-phosphor glow leading-tight">{fmt(new Date(now))}</div>
          </div>
        </div>
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="时间戳 → 日期">
          <div className="space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><Input value={ts} onChange={setTs} placeholder="1755072000" /></div>
              <Select value={unit} onChange={v => setUnit(v as 's' | 'ms')} options={[
                { value: 's', label: '秒' }, { value: 'ms', label: '毫秒' },
              ]} />
            </div>
            {tsResult?.error && <ErrorNote msg={tsResult.error} />}
            {tsResult?.date && (
              <div>
                <KV k="本地时间" v={<>{fmt(tsResult.date)} <CopyBtn text={fmt(tsResult.date)} /></>} />
                <KV k="UTC" v={tsResult.date.toUTCString()} />
                <KV k="ISO 8601" v={tsResult.date.toISOString()} />
              </div>
            )}
          </div>
        </Panel>
        <Panel title="日期 → 时间戳">
          <div className="space-y-3">
            <Input value={dateStr} onChange={setDateStr} placeholder="2026-08-13 12:00:00" />
            {strResult?.error && <ErrorNote msg={strResult.error} />}
            {strResult?.date && (
              <div>
                <KV k="Unix 秒" v={<>{Math.floor(strResult.date.getTime() / 1000)} <CopyBtn text={String(Math.floor(strResult.date.getTime() / 1000))} /></>} />
                <KV k="Unix 毫秒" v={<>{strResult.date.getTime()} <CopyBtn text={String(strResult.date.getTime())} /></>} />
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ================= Crontab ================= */

const CRON_NAMES = ['分钟', '小时', '日期', '月份', '星期']
const MONTH_NAMES = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const DOW_NAMES = ['日', '一', '二', '三', '四', '五', '六']

function parseCronField(field: string, idx: number): string {
  if (field === '*') return '每' + CRON_NAMES[idx]
  if (field.startsWith('*/')) return `每 ${field.slice(2)} ${CRON_NAMES[idx]}`
  if (field.includes(',')) return `${CRON_NAMES[idx]}为 ${field} 时`
  if (field.includes('-')) return `${CRON_NAMES[idx]}在 ${field} 范围内`
  return `${CRON_NAMES[idx]} = ${field}`
}

function cronNextRuns(expr: string, count: number): Date[] | string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return '需要 5 段表达式：分 时 日 月 周'
  const parseField = (f: string, min: number, max: number): number[] | string => {
    const vals = new Set<number>()
    for (const seg of f.split(',')) {
      const stepMatch = seg.match(/^(.+)\/(\d+)$/)
      let range = stepMatch ? stepMatch[1] : seg
      const step = stepMatch ? parseInt(stepMatch[2]) : 1
      let lo = min, hi = max
      if (range !== '*') {
        const m = range.match(/^(\d+)(?:-(\d+))?$/)
        if (!m) return `字段 "${f}" 无法解析`
        lo = parseInt(m[1]); hi = m[2] ? parseInt(m[2]) : lo
        if (lo < min || hi > max) return `字段 "${f}" 超出范围 ${min}-${max}`
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
  const [expr, setExpr] = useState('0 3 * * 1-5')

  const desc = useMemo(() => {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return null
    return parts.map((p, i) => parseCronField(p, i)).join('，')
  }, [expr])

  const next = useMemo(() => cronNextRuns(expr, 8), [expr])

  const PRESETS = [
    ['每分钟', '* * * * *'], ['每小时整点', '0 * * * *'], ['每天凌晨 3 点', '0 3 * * *'],
    ['工作日 9:30', '30 9 * * 1-5'], ['每 5 分钟', '*/5 * * * *'], ['每月 1 号零点', '0 0 1 * *'],
  ]

  return (
    <div className="space-y-3">
      <Input value={expr} onChange={setExpr} label="Cron 表达式（分 时 日 月 周）" placeholder="*/5 * * * *" />
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map(([name, e]) => (
          <button key={name} onClick={() => setExpr(e)}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {name}
          </button>
        ))}
      </div>
      {desc && (
        <Panel title="语义解析">
          <p className="text-[13px] text-bright">{desc}</p>
        </Panel>
      )}
      {typeof next === 'string' ? <ErrorNote msg={next} /> : (
        <Panel title="接下来 8 次执行时间">
          {next.map((d, i) => (
            <div key={i} className="flex gap-3 py-1 border-b border-line-soft last:border-0 text-[12.5px]">
              <span className="text-muted/60 w-8">#{i + 1}</span>
              <span className="text-phosphor">{d.toLocaleString('zh-CN', { hour12: false })}</span>
              <span className="text-muted">星期{DOW_NAMES[d.getDay()]}</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}

/* ================= 日期差 ================= */

export function DateDiffTool() {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const r = useMemo(() => {
    if (!a || !b) return null
    const da = new Date(a.replace(/-/g, '/')), db = new Date(b.replace(/-/g, '/'))
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return { error: '日期格式无效' }
    const ms = Math.abs(db.getTime() - da.getTime())
    return {
      days: Math.floor(ms / 86400000),
      hours: Math.floor(ms / 3600000),
      minutes: Math.floor(ms / 60000),
      seconds: Math.floor(ms / 1000),
      weeks: (ms / 604800000).toFixed(1),
      direction: db >= da ? 'B 晚于 A' : 'B 早于 A',
    }
  }, [a, b])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={a} onChange={setA} label="日期 A" placeholder="2026-01-01 或 2026-01-01 08:00" />
        <Input value={b} onChange={setB} label="日期 B" placeholder="2026-08-13" />
      </div>
      {r && 'error' in r && <ErrorNote msg={r.error!} />}
      {r && !('error' in r) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="相差天数" value={r.days} />
          <Stat label="周" value={r.weeks} />
          <Stat label="小时" value={r.hours.toLocaleString()} />
          <Stat label="分钟" value={r.minutes.toLocaleString()} />
          <Stat label="方向" value={<span className="text-sm">{r.direction}</span>} />
        </div>
      )}
    </div>
  )
}
