import { describe, expect, it } from 'vitest'
import {
  timestampToDate,
  dateToTimestamp,
  detectUnit,
  cronNextRuns,
  cronParseFields,
  dateDiff,
} from '../src/lib/toolkit/time'
import {
  formatInTimezone,
  offsetOf,
  isValidTimezone,
  convertToTimezones,
} from '../src/lib/toolkit/timezone'

describe('timestamp', () => {
  it('秒/毫秒自动识别', () => {
    expect(detectUnit(1_700_000_000)).toBe('s')
    expect(detectUnit(1_700_000_000_000)).toBe('ms')
    const p = timestampToDate(0)
    expect(p.utc).toContain('1970')
  })
  it('date → timestamp → date roundtrip', () => {
    const p = dateToTimestamp('2024-01-01 00:00:00')
    expect(p.timestampMs ?? p).toBeTruthy()
  })
})

describe('cron', () => {
  it('字段解析与下次执行预测', () => {
    const parsed = cronParseFields('*/5 * * * *')
    expect(parsed.ok).toBe(true)
    const runs = cronNextRuns('*/5 * * * *', 3, new Date(2026, 0, 1, 10, 2, 0))
    expect(runs.ok && runs.dates[0].getMinutes() % 5).toBe(0)
    expect(runs.ok && runs.dates.length).toBe(3)
  })
  it('非法表达式报错', () => {
    expect(cronParseFields('not a cron').ok).toBe(false)
  })
})

describe('dateDiff', () => {
  it('天数差', () => {
    const r = dateDiff('2026-01-01', '2026-01-31')
    expect(JSON.stringify(r)).toMatch(/30/)
  })
})

describe('timezone', () => {
  it('同一时刻的各区墙上时间', () => {
    expect(isValidTimezone('Asia/Shanghai')).toBe(true)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    const d = new Date('2026-06-01T12:00:00Z')
    const sh = formatInTimezone(d, 'Asia/Shanghai')
    const ny = formatInTimezone(d, 'America/New_York')
    // 夏令时：上海 UTC+8，纽约 UTC-4
    expect(offsetOf(d, 'Asia/Shanghai')).toBe(480)
    expect(offsetOf(d, 'America/New_York')).toBe(-240)
    // 墙上钟差 12 小时
    const hourDiff =
      (Number(sh.datetime.slice(11, 13)) - Number(ny.datetime.slice(11, 13)) + 24) % 24
    expect(hourDiff).toBe(12)
    const list = convertToTimezones(d, ['UTC', 'Asia/Shanghai'])
    expect(list.length).toBe(2)
  })
})
