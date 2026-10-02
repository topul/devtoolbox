/**
 * 时区互转 —— 渲染进程与 MCP 服务端共用。
 * 全部基于 Intl.DateTimeFormat，不依赖 Node 内置模块。
 */

export interface TimezoneEntry {
  /** IANA 标识，如 Asia/Shanghai */
  id: string
  /** 城市名（界面自行拼装本地化文案，这里只给原始字符串） */
  city: string
}

/** 常用时区清单：覆盖开发运维日常会碰到的地区。city 用英文 —— toolkit 是语言中立的共享层，本地化交给界面 */
export const COMMON_TIMEZONES: TimezoneEntry[] = [
  { id: 'UTC', city: 'UTC' },
  { id: 'Asia/Shanghai', city: 'Shanghai' },
  { id: 'Asia/Hong_Kong', city: 'Hong Kong' },
  { id: 'Asia/Taipei', city: 'Taipei' },
  { id: 'Asia/Tokyo', city: 'Tokyo' },
  { id: 'Asia/Singapore', city: 'Singapore' },
  { id: 'Asia/Kolkata', city: 'Kolkata' },
  { id: 'Asia/Dubai', city: 'Dubai' },
  { id: 'Europe/London', city: 'London' },
  { id: 'Europe/Berlin', city: 'Berlin' },
  { id: 'Europe/Paris', city: 'Paris' },
  { id: 'Europe/Moscow', city: 'Moscow' },
  { id: 'America/New_York', city: 'New York' },
  { id: 'America/Chicago', city: 'Chicago' },
  { id: 'America/Denver', city: 'Denver' },
  { id: 'America/Los_Angeles', city: 'Los Angeles' },
  { id: 'America/Sao_Paulo', city: 'São Paulo' },
  { id: 'Australia/Sydney', city: 'Sydney' },
  { id: 'Pacific/Auckland', city: 'Auckland' },
]

/** 本机时区 ID（Intl 保证存在；取不到时兜底 UTC） */
export function localTimezoneId(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export interface ZonedTime {
  timezone: string
  /** 该时区下的完整日期时间，YYYY-MM-DD HH:mm:ss */
  datetime: string
  /** 时区缩写 / 名称，如 GMT+8、CST */
  abbr: string
  /** 与 UTC 的偏移（分钟），东为正 */
  offsetMinutes: number
  /** 这一天是星期几（0=周日） */
  weekday: number
}

/** 取某时区在某一瞬间的格式化时间 */
export function formatInTimezone(d: Date, timezone: string): ZonedTime {
  if (!isValidTimezone(timezone)) throw new Error('BAD_TIMEZONE:' + timezone)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(d)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  // en-CA 的小时 24 点时可能输出 "24"，归一到 00
  const hour = get('hour') === '24' ? '00' : get('hour')
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    timezone,
    datetime: `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`,
    abbr: abbrOf(d, timezone),
    offsetMinutes: offsetOf(d, timezone),
    weekday: weekdayMap[get('weekday')] ?? 0,
  }
}

/** 同一瞬间在各时区的展示（转换工具主输出） */
export function convertToTimezones(d: Date, timezones: string[]): ZonedTime[] {
  return timezones.map((tz) => formatInTimezone(d, tz))
}

/**
 * 把「某时区墙上的时间」解析成 UTC Date。
 * 实现方式：先按 UTC 猜解，再用 Intl 反推偏移差迭代校正（两次迭代足够收敛，
 * 因为偏移只能是 15 分钟整数倍）。
 */
export function zonedTimeToUtc(
  local: string,
  timezone: string,
): Date {
  if (!isValidTimezone(timezone)) throw new Error('BAD_TIMEZONE:' + timezone)
  const m = local.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (!m) throw new Error('BAD_DATETIME')
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m
  // 先当作 UTC 解析
  let guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  for (let i = 0; i < 3; i++) {
    const off = offsetOf(new Date(guess), timezone)
    const next = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - off * 60000
    if (next === guess) break
    guess = next
  }
  return new Date(guess)
}

/** 时区当前与 UTC 的偏移（分钟）。用 Intl 的 timeZoneName 反推 */
export function offsetOf(d: Date, timezone: string): number {
  if (!isValidTimezone(timezone)) throw new Error('BAD_TIMEZONE:' + timezone)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(d)
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  // 墙上的时间 - 真实 UTC 时间 = 偏移（分钟）
  return Math.round((asUtc - d.getTime()) / 60000)
}

/** GMT+8 / UTC 形式的缩写 */
export function abbrOf(d: Date, timezone: string): string {
  if (timezone === 'UTC' || timezone === 'Etc/UTC') return 'UTC'
  const off = offsetOf(d, timezone)
  const sign = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return mm === '00' ? `GMT${sign}${hh}` : `GMT${sign}${hh}:${mm}`
}

/** 时区 ID 是否被当前引擎认识 */
export function isValidTimezone(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id })
    return true
  } catch {
    return false
  }
}

/** 引擎支持的时区 ID 全集（时区选择器用） */
export function availableTimezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (Array.isArray(list) && list.length) return list
  } catch {
    /* 老引擎不支持 supportedValuesOf，走 COMMON 兜底 */
  }
  return COMMON_TIMEZONES.map((t) => t.id)
}

/** UTC±HH:MM 字符串（如 +08:00） */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}
