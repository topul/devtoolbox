/**
 * 编解码纯函数层 —— 渲染进程与 MCP 服务端共用。
 *
 * 硬约束：本目录下的模块**不得**引入 DOM、React、electron 或任何 Node 内置模块。
 * 只有这样同一份实现才能既跑在浏览器渲染进程里，又跑在 Node 的 MCP 服务端里，
 * 否则两端各写一套，早晚走样。
 *
 * 这里是 `src/tools/*.tsx` 里原本内联逻辑的唯一定义处；界面只负责渲染与交互。
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** UTF-8 字符串 → Base64。urlSafe 用 -_ 替换 +/ 并去掉补位 = */
export function utf8ToBase64(input: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(input)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64_ALPHABET[b0 >> 2]
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f]
  }
  return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out
}

/** Base64 → UTF-8 字符串。容错：忽略空白、接受无补位、兼容 base64url 字母表 */
export function base64ToUtf8(input: string): string {
  const s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (!s) return ''
  if (/[^A-Za-z0-9+/]/.test(s)) throw new Error('INVALID_BASE64')
  const bytes = new Uint8Array(Math.floor((s.length * 6) / 8))
  let acc = 0
  let bits = 0
  let n = 0
  for (const ch of s) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[n++] = (acc >> bits) & 0xff
    }
  }
  // 非 fatal：解不出来宁可给替换字符，也别让调用方（尤其是 Agent）直接失败
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, n))
}

export function encodeUrlComponent(s: string): string {
  return encodeURIComponent(s)
}
export function decodeUrlComponent(s: string): string {
  return decodeURIComponent(s)
}
export function encodeUrlFull(s: string): string {
  return encodeURI(s)
}
export function decodeUrlFull(s: string): string {
  return decodeURI(s)
}

/** 非 ASCII 字符转 \uXXXX（ASCII 原样保留，与原界面行为一致） */
export function escapeUnicode(s: string): string {
  return s
    .split('')
    .map((c) => {
      const code = c.codePointAt(0)!
      return code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : c
    })
    .join('')
}

export function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** 全部字符转 \uXXXX，含 ASCII */
export function escapeUnicodeAll(s: string): string {
  return s
    .split('')
    .map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function htmlEntityEncode(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]!)
}

/** 数字实体（十进制 / 十六进制）编码每个字符 */
export function htmlEntityEncodeNumeric(s: string): string {
  return s
    .split('')
    .map((c) => '&#' + c.charCodeAt(0) + ';')
    .join('')
}

const HTML_NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  laquo: '\u00ab', raquo: '\u00bb', times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1',
  sect: '\u00a7', para: '\u00b6', deg: '\u00b0', euro: '\u20ac', pound: '\u00a3',
  yen: '\u00a5', cent: '\u00a2', bull: '\u2022', middot: '\u00b7', dagger: '\u2020',
  Dagger: '\u2021', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193',
  harr: '\u2194', check: '\u2713', cross: '\u2717', star: '\u2605', heart: '\u2665',
  alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', pi: '\u03c0',
}

/**
 * 实体解码。覆盖十进制 / 十六进制数字实体与常见命名实体。
 * 注意：原实现借用 DOM 的 textarea，能解全部 HTML5 命名实体；共享层不能用 DOM，
 * 因此只内建了常用表 —— 生僻命名实体（如 &CounterClockwiseContourIntegral;）不再解码。
 */
export function htmlEntityDecode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => HTML_NAMED[name] ?? m)
}

/** 每个字符转 0xNN，逗号分隔 */
export function encodeHex(s: string): string {
  return s
    .split('')
    .map((c) => '0x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(',')
}

export function decodeHex(s: string): string {
  return s
    .split(',')
    .map((h) => String.fromCharCode(parseInt(h.trim(), 16)))
    .join('')
}

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.',
}

const MORSE_REV: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k]),
)

export function encodeMorse(s: string): string {
  return s
    .toUpperCase()
    .split('')
    .map((c) => (c === ' ' ? '/' : (MORSE[c] ?? c)))
    .join(' ')
}

export function decodeMorse(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => (t === '/' ? ' ' : (MORSE_REV[t] ?? t)))
    .join('')
}

/**
 * 任意进制互转。用 BigInt 实现，因此不会像 parseInt 那样在 2^53 之后丢精度
 * （Agent 经常要处理雪花 ID、64 位掩码这类大整数）。
 */
export function radixConvert(input: string, from: number): {
  bin: string
  oct: string
  dec: string
  hex: string
} {
  const raw = input.trim().replace(/^0x/i, '').replace(/[\s_,]/g, '')
  if (!raw) throw new Error('EMPTY_INPUT')
  if (!Number.isInteger(from) || from < 2 || from > 36) throw new Error('BAD_RADIX')
  const negative = raw.startsWith('-')
  const digits = negative ? raw.slice(1) : raw
  const base = BigInt(from)
  let n = 0n
  for (const ch of digits.toLowerCase()) {
    const v = parseInt(ch, 36)
    if (Number.isNaN(v) || v >= from) throw new Error('BAD_DIGIT:' + ch)
    n = n * base + BigInt(v)
  }
  if (negative) n = -n
  return {
    bin: n.toString(2),
    oct: n.toString(8),
    dec: n.toString(10),
    hex: n.toString(16).toUpperCase(),
  }
}

/** 多编码器链：string-escape 工具用 */
export type ChainCodec = 'url' | 'doubleUrl' | 'html' | 'unicode' | 'hex' | 'base64'

export const CHAIN_CODECS: ChainCodec[] = ['url', 'doubleUrl', 'html', 'unicode', 'hex', 'base64']

export function chainEncode(codec: ChainCodec, s: string): string {
  switch (codec) {
    case 'url': return encodeURIComponent(s)
    case 'doubleUrl': return encodeURIComponent(encodeURIComponent(s))
    case 'html': return htmlEntityEncodeNumeric(s)
    case 'unicode': return escapeUnicodeAll(s)
    case 'hex': return encodeHex(s)
    case 'base64': return utf8ToBase64(s)
  }
}

export function chainDecode(codec: ChainCodec, s: string): string {
  switch (codec) {
    case 'url': return decodeURIComponent(s)
    case 'doubleUrl': return decodeURIComponent(decodeURIComponent(s))
    case 'html': return htmlEntityDecode(s)
    case 'unicode': return unescapeUnicode(s)
    case 'hex': return decodeHex(s)
    case 'base64': return base64ToUtf8(s)
  }
}
