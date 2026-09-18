/**
 * 随机标识生成 —— 渲染进程与 MCP 服务端共用。
 * 一律走 crypto 强随机源：Agent 自己编的 UUID / 密码往往不是真随机，这正是要给它的能力。
 */

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  const c = globalThis.crypto
  if (!c?.getRandomValues) throw new Error('NO_CRYPTO')
  c.getRandomValues(b)
  return b
}

/** 一次取 4 字节组成无符号 32 位整数 */
function rndUint32(): number {
  const b = randomBytes(4)
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
}

/** 均匀分布，无取模偏置（0x100000000 / range 整除段内取模） */
function rndInt(min: number, max: number): number {
  const range = max - min + 1
  if (range <= 1) return min
  const limit = Math.floor(0x100000000 / range) * range
  let v = rndUint32()
  while (v >= limit) v = rndUint32()
  return min + (v % range)
}

export interface UuidOptions {
  count?: number
  upper?: boolean
  noDash?: boolean
}

export function uuidV4(): string {
  const b = randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateUuids(opts: UuidOptions = {}): string[] {
  const n = Math.min(Math.max(opts.count ?? 5, 1), 500)
  let arr = Array.from({ length: n }, uuidV4)
  if (opts.noDash) arr = arr.map((u) => u.replace(/-/g, ''))
  if (opts.upper) arr = arr.map((u) => u.toUpperCase())
  return arr
}

export const PASSWORD_CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?/',
  ambiguous: 'Il1O0',
}

export interface PasswordOptions {
  length?: number
  lower?: boolean
  upper?: boolean
  digit?: boolean
  symbol?: boolean
  /** 剔除易混淆字符 Il1O0 */
  excludeAmbiguous?: boolean
}

export interface PasswordResult {
  password: string
  /** 熵值（bit），用于强度展示 */
  bits: number
  poolSize: number
}

export function generatePassword(opts: PasswordOptions = {}): PasswordResult {
  const {
    length = 16,
    lower = true,
    upper = true,
    digit = true,
    symbol = true,
    excludeAmbiguous = false,
  } = opts
  let pool = ''
  if (lower) pool += PASSWORD_CHARSETS.lower
  if (upper) pool += PASSWORD_CHARSETS.upper
  if (digit) pool += PASSWORD_CHARSETS.digit
  if (symbol) pool += PASSWORD_CHARSETS.symbol
  if (excludeAmbiguous) pool = pool.split('').filter((c) => !PASSWORD_CHARSETS.ambiguous.includes(c)).join('')
  if (!pool) throw new Error('EMPTY_CHARSET')
  const n = Math.min(Math.max(length, 4), 128)
  let out = ''
  for (let i = 0; i < n; i++) out += pool[rndInt(0, pool.length - 1)]
  return { password: out, bits: Math.round(n * Math.log2(pool.length)), poolSize: pool.length }
}

/* ================= 假数据 ================= */

export interface FakeLists {
  surnames: string[]
  givens: string[]
  phonePrefixes: string[]
  domains: string[]
  areas: string[]
  firstNames: string[]
  lastNames: string[]
  enDomains: string[]
}

export interface FakeRow {
  id: number
  name: string
  phone: string
  email: string
  idcard: string
  ip: string
  mac: string
}

const pick = <T>(arr: T[]): T => arr[rndInt(0, arr.length - 1)]

function rndIPv4(): string {
  return Array.from({ length: 4 }, () => rndInt(1, 254)).join('.')
}

function rndMac(): string {
  return Array.from({ length: 6 }, () => rndInt(0, 255).toString(16).padStart(2, '0')).join(':').toUpperCase()
}

/** 身份证号：GB 11643 校验位算法 */
function rndIdCardZh(areas: string[]): string {
  const area = pick(areas)
  const y = rndInt(1970, 2002)
  const m = rndInt(1, 12)
  const d = rndInt(1, 28)
  const body = area + y + String(m).padStart(2, '0') + String(d).padStart(2, '0') + String(rndInt(100, 999))
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const C = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = body.split('').reduce((acc, ch, i) => acc + parseInt(ch) * W[i], 0)
  return body + C[sum % 11]
}

function rndEmailRandom(domains: string[]): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const n = rndInt(5, 10)
  let u = ''
  for (let i = 0; i < n; i++) u += chars[rndInt(0, chars.length - 1)]
  return u + '@' + pick(domains)
}

export function generateFakeRows(locale: 'zh' | 'en', lists: FakeLists, count = 10): FakeRow[] {
  const n = Math.min(Math.max(count, 1), 100)
  return Array.from({ length: n }, (_, i) => {
    if (locale === 'zh') {
      const given = pick(lists.givens)
      return {
        id: i + 1,
        // 中文姓名两字或三字，与原界面生成结果保持一致
        name: pick(lists.surnames) + given + (rndInt(0, 1) === 1 ? pick(lists.givens) : ''),
        phone: pick(lists.phonePrefixes) + String(rndInt(10000000, 99999999)),
        email: rndEmailRandom(lists.domains),
        idcard: rndIdCardZh(lists.areas),
        ip: rndIPv4(),
        mac: rndMac(),
      }
    }
    const f = pick(lists.firstNames)
    const l = pick(lists.lastNames)
    return {
      id: i + 1,
      name: `${f} ${l}`,
      phone: `555-${String(rndInt(0, 999)).padStart(3, '0')}-${String(rndInt(0, 9999)).padStart(4, '0')}`,
      email: `${f.toLowerCase()}.${l.toLowerCase()}@${pick(lists.enDomains)}`,
      idcard: `${String(rndInt(0, 999)).padStart(3, '0')}-${String(rndInt(0, 99)).padStart(2, '0')}-${String(rndInt(0, 9999)).padStart(4, '0')}`,
      ip: rndIPv4(),
      mac: rndMac(),
    }
  })
}

export const FAKE_CSV_HEADER = 'id,name,phone,email,idcard,ip,mac'

export function fakeRowsToCsv(rows: FakeRow[]): string {
  return FAKE_CSV_HEADER + '\n' + rows.map((r) => Object.values(r).join(',')).join('\n')
}
