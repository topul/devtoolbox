/**
 * 时间处理 —— 渲染进程与 MCP 服务端共用。
 * 覆盖：时间戳 ⇄ 日期、日期差、crontab 解析与下次执行时间推算。
 */

export interface TimeParts {
  date: Date
  unixSec: number
  unixMs: number
  /** 本地时间 YYYY-MM-DD HH:mm:ss */
  local: string
  utc: string
  iso: string
}

/** 与原界面完全一致的本地时间格式（补零到秒） */
export function formatLocal(d: Date): string {
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function describeDate(d: Date): TimeParts {
  return {
    date: d,
    unixSec: Math.floor(d.getTime() / 1000),
    unixMs: d.getTime(),
    local: formatLocal(d),
    utc: d.toUTCString(),
    iso: d.toISOString(),
  }
}

/** 自动识别秒 / 毫秒 / 微秒 / 纳秒量级的时间戳（Agent 传进来的数经常带单位歧义） */
export function detectUnit(n: number): 's' | 'ms' | 'us' | 'ns' {
  const abs = Math.abs(n)
  if (abs < 1e11) return 's'
  if (abs < 1e14) return 'ms'
  if (abs < 1e17) return 'us'
  return 'ns'
}

export function timestampToDate(input: string | number, unit?: 's' | 'ms' | 'us' | 'ns' | 'auto'): TimeParts {
  const n = typeof input === 'number' ? input : parseFloat(String(input).trim())
  if (Number.isNaN(n)) throw new Error('INVALID_NUMBER')
  const u = !unit || unit === 'auto' ? detectUnit(n) : unit
  const ms = u === 's' ? n * 1000 : u === 'ms' ? n : u === 'us' ? n / 1000 : n / 1e6
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) throw new Error('OUT_OF_RANGE')
  return describeDate(d)
}

export function nowParts(): TimeParts {
  return describeDate(new Date())
}

/** 解析人类可写的日期串（- 替换成 / 以按本地时区解释，避免被当成 UTC） */
export function dateToTimestamp(input: string): TimeParts {
  const d = new Date(input.trim().replace(/-/g, '/'))
  if (Number.isNaN(d.getTime())) throw new Error('INVALID_DATE')
  return describeDate(d)
}

export interface DateDiffResult {
  days: number
  weeks: string
  hours: number
  minutes: number
  seconds: number
  /** b 晚于 a 时为 1，否则 -1 */
  direction: 1 | -1
}

export function dateDiff(a: string, b: string): DateDiffResult {
  const da = new Date(a.trim().replace(/-/g, '/'))
  const db = new Date(b.trim().replace(/-/g, '/'))
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) throw new Error('INVALID_DATE')
  const ms = Math.abs(db.getTime() - da.getTime())
  return {
    days: Math.floor(ms / 86400000),
    weeks: (ms / 604800000).toFixed(1),
    hours: Math.floor(ms / 3600000),
    minutes: Math.floor(ms / 60000),
    seconds: Math.floor(ms / 1000),
    direction: db >= da ? 1 : -1,
  }
}

/* ================= crontab ================= */

export type CronFieldKind = 'all' | 'step' | 'list' | 'range' | 'single'

export interface CronField {
  raw: string
  kind: CronFieldKind
  values: number[]
}

export type CronError =
  | { code: 'NEED_5_FIELDS'; got: number }
  | { code: 'BAD_FIELD'; field: string }
  | { code: 'OUT_OF_RANGE'; field: string; min: number; max: number }

const CRON_RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]

function parseCronField(f: string, min: number, max: number): number[] | CronError {
  const vals = new Set<number>()
  for (const seg of f.split(',')) {
    const stepMatch = seg.match(/^(.+)\/(\d+)$/)
    const range = stepMatch ? stepMatch[1] : seg
    const step = stepMatch ? parseInt(stepMatch[2]) : 1
    if (step < 1) return { code: 'BAD_FIELD', field: f }
    let lo = min
    let hi = max
    if (range !== '*') {
      const m = range.match(/^(\d+)(?:-(\d+))?$/)
      if (!m) return { code: 'BAD_FIELD', field: f }
      lo = parseInt(m[1])
      hi = m[2] ? parseInt(m[2]) : lo
      if (lo < min || hi > max) return { code: 'OUT_OF_RANGE', field: f, min, max }
    }
    for (let i = lo; i <= hi; i += step) vals.add(i)
  }
  return [...vals].sort((a, b) => a - b)
}

function classifyField(raw: string): CronFieldKind {
  if (raw === '*') return 'all'
  if (/^\*\//.test(raw)) return 'step'
  if (raw.includes(',')) return 'list'
  if (raw.includes('-')) return 'range'
  return 'single'
}

/** 只做解析，便于界面按语言渲染说明文案 */
export function cronParseFields(expr: string): { ok: true; fields: CronField[] } | { ok: false; error: CronError } {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { ok: false, error: { code: 'NEED_5_FIELDS', got: parts.length } }
  const fields: CronField[] = []
  for (let i = 0; i < 5; i++) {
    const r = parseCronField(parts[i], CRON_RANGES[i][0], CRON_RANGES[i][1])
    if (!Array.isArray(r)) return { ok: false, error: r }
    fields.push({ raw: parts[i], kind: classifyField(parts[i]), values: r })
  }
  return { ok: true, fields }
}

/**
 * 推算接下来 count 次触发时间（本地时区，兼容标准 5 段 cron）。
 * 注意：dom 与 dow 同时被限定时按 cron 惯例取「或」语义，本实现沿用原界面的严格「与」语义，
 * 因此 `0 0 1 * 1` 这类组合的结果与真实 cron 不同 —— 保持既有行为，避免界面结果突变。
 */
export function cronNextRuns(
  expr: string,
  count = 8,
  from: Date = new Date(),
): { ok: true; dates: Date[] } | { ok: false; error: CronError } {
  const parsed = cronParseFields(expr)
  if (!parsed.ok) return parsed
  const sets = parsed.fields.map((f) => f.values)

  const out: Date[] = []
  const start = new Date(from)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  const cursor = new Date(start)
  let guard = 0
  while (out.length < count && guard++ < 200000) {
    const mo = cursor.getMonth() + 1
    const dom = cursor.getDate()
    const dow = cursor.getDay()
    const h = cursor.getHours()
    const mi = cursor.getMinutes()
    if (sets[3].includes(mo) && sets[2].includes(dom) && sets[4].includes(dow) && sets[1].includes(h) && sets[0].includes(mi)) {
      out.push(new Date(cursor))
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return { ok: true, dates: out }
}
