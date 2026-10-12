/**
 * Hex Dump：字节 ↔ 经典十六进制转储（偏移量 + Hex + ASCII 三栏）。
 *
 * 两种解码：
 *   - decodeHexDump：识别带偏移量的标准 dump（本工具自己的输出、hexdiff 等），
 *     逐行从行首连续消费 hex 对，按空格规则避开右侧 ASCII 列；
 *   - decodeHex：纯 hex 字符串（允许空格/换行），去空白后两两配对。
 */

export interface HexDumpOptions {
  bytesPerLine?: number
  uppercase?: boolean
}

const HEX = '0123456789abcdef'

function toHexPair(n: number, upper: boolean): string {
  const s = `${HEX[(n >> 4) & 0xf]}${HEX[n & 0xf]}`
  return upper ? s.toUpperCase() : s
}

/** 字节序列 → 标准 hexdump 文本 */
export function encodeHexDump(bytes: Uint8Array, opts: HexDumpOptions = {}): string {
  const width = opts.bytesPerLine ?? 16
  const upper = opts.uppercase ?? false
  const half = Math.max(width / 2, 1)
  const lines: string[] = []

  for (let off = 0; off < bytes.length; off += width) {
    const chunk = bytes.subarray(off, Math.min(off + width, bytes.length))
    let hexPart = ''
    let ascii = ''
    for (let i = 0; i < width; i++) {
      if (i === half) hexPart += ' '
      if (i < chunk.length) {
        const code = chunk[i]
        hexPart += `${toHexPair(code, upper)} `
        ascii += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '.'
      } else {
        hexPart += '   '
        ascii += ' '
      }
    }
    const offset =
      toHexPair((off >>> 24) & 0xff, false) +
      toHexPair((off >>> 16) & 0xff, false) +
      toHexPair((off >>> 8) & 0xff, false) +
      toHexPair(off & 0xff, false)
    lines.push(`${upper ? offset.toUpperCase() : offset}  ${hexPart} ${ascii}`)
  }
  return lines.join('\n')
}

export interface DecodeResult {
  ok: boolean
  bytes?: Uint8Array
  error?: string
}

const DUMP_OFFSET_RE = /^[0-9a-fA-F]{4,8}[ \t]{2,}/

/** 智能解码：含偏移量前缀就按 dump 逐行解析，否则按纯 hex 配对 */
export function decodeHex(input: string): DecodeResult {
  const lines = input.split(/\r?\n/)
  const looksLikeDump = lines.some((l) => l.trim() && DUMP_OFFSET_RE.test(l))
  return looksLikeDump ? decodeHexDump(input) : decodePlainHex(input)
}

/** 纯 hex：去除所有空白后两两配对 */
export function decodePlainHex(input: string): DecodeResult {
  const clean = input.replace(/\s+/g, '')
  if (!clean) return { ok: true, bytes: new Uint8Array(0) }
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    return { ok: false, error: '含非十六进制字符（只能出现 0-9 a-f 与空白）' }
  }
  if (clean.length % 2 !== 0) return { ok: false, error: '十六进制字符数为奇数，无法配对' }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return { ok: true, bytes }
}

/** 标准 dump：逐行去掉偏移后，从行首按严格空格规则连续取 hex 对 */
export function decodeHexDump(input: string): DecodeResult {
  const out: number[] = []
  let lastOffset = -1
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) continue
    const m = /^([0-9a-fA-F]{4,8})[ \t]+/.exec(line)
    if (!m) return { ok: false, error: `无法识别的行（缺少偏移量）：${line.slice(0, 32)}` }
    const offset = parseInt(m[1], 16)
    // 偏移量应严格递增；重叠/倒退通常意味着粘贴出错或不是同一份 dump
    if (offset <= lastOffset) {
      return { ok: false, error: `偏移量未递增（行 ${m[1]}），请确认只粘贴了一份连续 dump` }
    }
    lastOffset = offset
    const rest = line.slice(m[0].length)
    const rowBytes = parseDumpRow(rest)
    if (rowBytes === null) {
      return { ok: false, error: `偏移 ${m[1]} 行的 hex 区解析失败：${rest.slice(0, 24)}` }
    }
    out.push(...rowBytes)
  }
  return { ok: true, bytes: new Uint8Array(out) }
}

/**
 * 从 dump 行（已去偏移）的行首连续提取 hex 对。
 * 规则：字节之间恰好 1 个空格；分组处允许 2 空格（width=16 时在第 8 字节、
 * width=8 时在第 4 字节，即已消费字节数为 4 的倍数都算合法分组位置）；
 * 其他位置出现 2 个以上空格（或非 hex 字符）即认为 hex 区结束、进入 ASCII 列。
 */
function parseDumpRow(rest: string): number[] | null {
  const bytes: number[] = []
  let pos = 0
  while (pos < rest.length) {
    let spaces = 0
    while (rest[pos] === ' ') {
      pos++
      spaces++
    }
    if (bytes.length > 0) {
      if (spaces === 0) return null
      if (spaces > 2) break
      if (spaces === 2 && bytes.length % 4 !== 0) break
    }
    const pair = rest.slice(pos, pos + 2)
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      // 行首就不是 hex：空行（仅 ASCII 占位）允许返回空
      if (bytes.length === 0) return []
      break
    }
    bytes.push(parseInt(pair, 16))
    pos += 2
  }
  return bytes
}

/* ================= 文本便捷转换 ================= */

export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}
