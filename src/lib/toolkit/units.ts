/**
 * 数据单位换算 —— bit / Byte、KB(1000) 与 KiB(1024) 两套前缀混着用的场景
 * 一张表看全。factor 统一锚定「1 该单位 = 多少字节」（bit = 0.125），
 * 任意两单位换算就是一次乘除，MCP 与界面共用纯函数结果。
 */

export interface DataUnit {
  /** 语言中立的单位符号（换算接口与展示都用它） */
  id: string
  /** 英文全名，供下拉选项展示 */
  name: string
  /** 1 该单位 = factor 字节 */
  factor: number
}

export const DATA_UNITS: DataUnit[] = [
  { id: 'bit', name: 'Bit', factor: 0.125 },
  { id: 'B', name: 'Byte', factor: 1 },
  { id: 'KB', name: 'Kilobyte', factor: 1e3 },
  { id: 'KiB', name: 'Kibibyte', factor: 1024 },
  { id: 'MB', name: 'Megabyte', factor: 1e6 },
  { id: 'MiB', name: 'Mebibyte', factor: 1024 ** 2 },
  { id: 'GB', name: 'Gigabyte', factor: 1e9 },
  { id: 'GiB', name: 'Gibibyte', factor: 1024 ** 3 },
  { id: 'TB', name: 'Terabyte', factor: 1e12 },
  { id: 'TiB', name: 'Tebibyte', factor: 1024 ** 4 },
  { id: 'PB', name: 'Petabyte', factor: 1e15 },
  { id: 'PiB', name: 'Pebibyte', factor: 1024 ** 5 },
]

const FACTORS = new Map(DATA_UNITS.map((u) => [u.id, u.factor]))

/** value 个 from 单位 = 多少个 to 单位；未知单位返回 null */
export function convertDataUnit(value: number, from: string, to: string): number | null {
  const f = FACTORS.get(from)
  const t = FACTORS.get(to)
  if (f === undefined || t === undefined) return null
  return (value * f) / t
}

/**
 * 字节数 → 人类可读字符串。固定 1024 进制带 i 后缀（KiB/MiB/…），
 * 负数与 < 1 KiB 直接给 B；例：1536 → "1.5 KiB"。
 */
export function formatDataSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return String(bytes)
  if (bytes < 1024) return `${bytes} B` // 含负数
  const names = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < names.length - 1) {
    v /= 1024
    i++
  }
  // ≥100 去小数位，避免 "1234.5 KiB" 这类噪音
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${names[i]}`
}

/** value 个 from 单位换算到其余全部单位的对照表（不含 from 自身） */
export function unitConvertAll(value: number, from: string): { unit: string; value: number }[] {
  const f = FACTORS.get(from)
  if (f === undefined) return []
  return DATA_UNITS.filter((u) => u.id !== from).map((u) => ({
    unit: u.id,
    value: (value * f) / u.factor,
  }))
}
