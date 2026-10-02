/**
 * Base58 / Base32 / Punycode —— 渲染进程与 MCP 服务端共用。
 *
 * 都是纯字节级算法：文本先进 UTF-8 字节，编码后按调用方需要转 ASCII 或 Hex。
 * Base58 用比特币字母表（无 0OIl）；Base32 按 RFC 4648（含 Base32Hex 变体）。
 */

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function utf8Bytes(s: string): Uint8Array {
  return textEncoder.encode(s)
}

export function bytesToUtf8(b: Uint8Array): string {
  return textDecoder.decode(b)
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:]/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('BAD_HEX')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/* ================= Base58 ================= */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B58_MAP: Map<string, number> = new Map([...B58_ALPHABET].map((c, i) => [c, i]))

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  // 前导零 → 前导 '1'（比特币惯例）
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  const digits: number[] = []
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58_ALPHABET[d]).join('')
}

export function base58Decode(s: string): Uint8Array {
  if (s === '') return new Uint8Array(0)
  let zeros = 0
  while (zeros < s.length && s[zeros] === '1') zeros++
  const bytes: number[] = []
  for (let i = zeros; i < s.length; i++) {
    const v = B58_MAP.get(s[i])
    if (v === undefined) throw new Error(`非法 Base58 字符 "${s[i]}"`)
    let carry = v
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  const out = new Uint8Array(zeros + bytes.length)
  out.fill(0, 0, zeros)
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]
  return out
}

/* ================= Base32 ================= */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const B32HEX_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
const B32_MAP: Map<string, number> = new Map([...B32_ALPHABET].map((c, i) => [c, i]))
const B32HEX_MAP: Map<string, number> = new Map([...B32HEX_ALPHABET].map((c, i) => [c, i]))

export type Base32Variant = 'rfc4648' | 'hex'

export function base32Encode(bytes: Uint8Array, variant: Base32Variant = 'rfc4648', padding = true): string {
  const alphabet = variant === 'hex' ? B32HEX_ALPHABET : B32_ALPHABET
  let out = ''
  let buffer = 0
  let bits = 0
  for (const b of bytes) {
    buffer = (buffer << 8) | b
    bits += 8
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31]
  if (padding) while (out.length % 8 !== 0) out += '='
  return out
}

export function base32Decode(s: string, variant: Base32Variant = 'rfc4648'): Uint8Array {
  const map = variant === 'hex' ? B32HEX_MAP : B32_MAP
  const clean = s.replace(/[\s=]/g, '').toUpperCase()
  if (clean === '') return new Uint8Array(0)
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const v = map.get(ch)
    if (v === undefined) throw new Error(`非法 Base32 字符 "${ch}"`)
    buffer = (buffer << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/* ================= Punycode / IDN（RFC 3492） ================= */

const BASE = 36
const TMIN = 1
const TMAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  // / 与 >> 之后都必须取整，否则 bias 会漂（RFC 3492 3.4 是整数运算）
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1
  delta += Math.floor(delta / numPoints)
  let k = 0
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN))
    k += BASE
  }
  return Math.floor(k + (((BASE - TMIN + 1) * delta) / (delta + SKEW)))
}

function encodeDigit(d: number): number {
  return d < 26 ? d + 97 : d - 26 + 48
}

function decodeDigit(cp: number): number {
  if (cp >= 48 && cp <= 57) return cp - 22
  if (cp >= 65 && cp <= 90) return cp - 65
  if (cp >= 97 && cp <= 122) return cp - 97
  throw new Error(`非法 Punycode 字符 U+${cp.toString(16)}`)
}

/** 单个标签（不含 xn-- 前缀）→ Punycode（不含前缀） */
export function punycodeEncodeLabel(input: string): string {
  const output: number[] = []
  const inputCodes = [...input].map((c) => c.codePointAt(0)!)
  const basic = inputCodes.filter((c) => c < INITIAL_N)
  for (const c of basic) output.push(c)
  const b = basic.length
  let h = b
  if (b > 0) output.push(45) // '-'
  let n = INITIAL_N
  let delta = 0
  let bias = INITIAL_BIAS
  while (h < inputCodes.length) {
    let m = Infinity
    for (const c of inputCodes) if (c >= n && c < m) m = c
    delta += (m - n) * (h + 1)
    n = m
    for (const c of inputCodes) {
      if (c < n) delta++
      if (c !== n) continue
      let q = delta
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
        if (q < t) break
        output.push(encodeDigit(t + ((q - t) % (BASE - t))))
        q = Math.floor((q - t) / (BASE - t))
      }
      output.push(encodeDigit(q))
      bias = adapt(delta, h + 1, h === b)
      delta = 0
      h++
    }
    delta++
    n++
  }
  return String.fromCodePoint(...output)
}

/**
 * 单个标签（不含 xn-- 前缀）← Punycode。
 *
 * 与 punycode.js 参考实现对应：`i` 是跨插入点持久累加的游标，每个码点的
 * 增量是 `i - oldi`；`n += floor(i / out)` 后 `i %= out` 回绕，每回绕一圈
 * 等价于 encode 侧 `delta += (m - n) * (h + 1)` 的那一跳。
 */
export function punycodeDecodeLabel(input: string): string {
  const codes = [...input].map((c) => c.codePointAt(0)!)
  const output: number[] = []
  const dash = codes.lastIndexOf(45)
  // 没有连字符 = 整串都是增量编码，没有基本码点前缀（参考实现 basic<0 置 0）
  const basicEnd = dash < 0 ? 0 : dash
  for (let j = 0; j < basicEnd; j++) {
    if (codes[j] >= 0x80) throw new Error('基本码点段含非 ASCII')
    output.push(codes[j])
  }
  let pos = basicEnd > 0 ? basicEnd + 1 : 0
  let i = 0
  let n = INITIAL_N
  let bias = INITIAL_BIAS
  while (pos < codes.length) {
    const oldi = i
    for (let w = 1, k = BASE; ; k += BASE) {
      if (pos >= codes.length) throw new Error('Punycode 输入不完整')
      const digit = decodeDigit(codes[pos++])
      i += digit * w
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
      if (digit < t) break
      w *= BASE - t
    }
    const out = output.length + 1
    bias = adapt(i - oldi, out, oldi === 0)
    n += Math.floor(i / out)
    i %= out
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/* ================= 域名级 IDN 互转 ================= */

/** 中文域名 → ASCII（xn-- 形式）。逐标签处理，已是 ASCII 的标签原样保留 */
export function idnToAscii(domain: string): string {
  return domain
    .split('.')
    .map((label) => {
      if (!label || /^xn--/i.test(label)) return label.toLowerCase()
      if (/^[\x20-\x7e]*$/.test(label)) return label
      return 'xn--' + punycodeEncodeLabel(label)
    })
    .join('.')
}

/** ASCII（xn--）域名 → Unicode。非 xn-- 标签原样保留，解不动的标签也原样留下 */
export function asciiToIdn(domain: string): string {
  return domain
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label
      try {
        return punycodeDecodeLabel(label.slice(4))
      } catch {
        return label
      }
    })
    .join('.')
}
