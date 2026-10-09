/**
 * 文本编码检测 —— 启发式判定（不追求 chardet 库的全量打分），专治「打开乱码」
 * 场景下的第一步：先看这份字节流最可能是什么编码。
 *
 * 判定顺序：BOM → 全 ASCII → 严格 UTF-8 校验 → 空字节位置判 UTF-16 →
 * 双字节编码（GBK / Big5 / Shift-JIS / EUC-JP）按合法性比例打分 → 兜底
 * Windows-1252 / Latin-1。reasons 用英文记录每步依据，界面直接展示。
 * 全文件纯函数零 DOM 依赖；decodeWithEncoding 用 TextDecoder（浏览器与
 * Node ≥ 11 均为全局），不支持的标签 try/catch 返回空串。
 */

export interface CharDetResult {
  /** UTF-8 / UTF-16LE / UTF-16BE / UTF-32LE / UTF-32BE / GBK / Big5 /
   *  Shift-JIS / EUC-JP / Windows-1252 / Latin-1 / ASCII */
  encoding: string
  /** 文件头 BOM 的 hex 形式（如 'EF BB BF'）；无 BOM 为 null */
  bom: string | null
  /** 是否全部字节 < 0x80（任何 ASCII 兼容编码下语义相同） */
  asciiSubset: boolean
  /** 判定依据（英文），按推理顺序排列，界面逐条展示 */
  reasons: string[]
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf]
const BOM_UTF32LE = [0xff, 0xfe, 0x00, 0x00]
const BOM_UTF32BE = [0x00, 0x00, 0xfe, 0xff]

function hasBom(bytes: Uint8Array, bom: number[]): boolean {
  if (bytes.length < bom.length) return false
  return bom.every((b, i) => bytes[i] === b)
}

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

/**
 * 严格 UTF-8 校验：多字节序列必须完整、续字节 10xxxxxx、
 * 且排除超长编码 / 代理区 / 超出 U+10FFFF 的码点。
 */
function validateUtf8(bytes: Uint8Array): { valid: boolean; multiByte: number } {
  let multiByte = 0
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      i++
      continue
    }
    let len: number
    let cp: number
    if ((b & 0xe0) === 0xc0) {
      len = 2
      cp = b & 0x1f
    } else if ((b & 0xf0) === 0xe0) {
      len = 3
      cp = b & 0x0f
    } else if ((b & 0xf8) === 0xf0) {
      len = 4
      cp = b & 0x07
    } else return { valid: false, multiByte }

    if (i + len > bytes.length) return { valid: false, multiByte }
    for (let j = 1; j < len; j++) {
      if ((bytes[i + j] & 0xc0) !== 0x80) return { valid: false, multiByte }
      cp = (cp << 6) | (bytes[i + j] & 0x3f)
    }
    // 超长编码 / UTF-16 代理区 / 越界码点都不许过
    const min = len === 2 ? 0x80 : len === 3 ? 0x800 : 0x10000
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return { valid: false, multiByte }
    }
    multiByte++
    i += len
  }
  return { valid: true, multiByte }
}

/**
 * UTF-16 判分：成对看字节，「文本位 < 0x80 且另一位是 00」的配对占比。
 * little=true 时文本位在前（x 00 → LE），反之 BE。
 */
function utf16Score(bytes: Uint8Array, little: boolean): { score: number; pairs: number } {
  const pairs = Math.floor(bytes.length / 2)
  if (pairs === 0) return { score: 0, pairs: 0 }
  let good = 0
  for (let p = 0; p < pairs; p++) {
    const text = bytes[p * 2 + (little ? 0 : 1)]
    const nullByte = bytes[p * 2 + (little ? 1 : 0)]
    if (text < 0x80 && nullByte === 0) good++
  }
  return { score: good / pairs, pairs }
}

/**
 * 双字节编码判分：扫描字节流，高位字节作为首字节时能否与下一字节构成合法
 * 序列。返回（合法高位序列数, 非法高位字节数, 合法的单字节假名/控制前缀数）。
 */
interface BytePairScore {
  valid: number
  invalid: number
}

type PairRule = (lead: number, trail: number | undefined) => boolean

/** GBK：首 81–FE，尾 40–FE 除 7F */
const gbkPair: PairRule = (lead, trail) =>
  lead >= 0x81 &&
  lead <= 0xfe &&
  trail !== undefined &&
  trail >= 0x40 &&
  trail <= 0xfe &&
  trail !== 0x7f

/** Big5：首 81–FE，尾 40–7E 或 A1–FE */
const big5Pair: PairRule = (lead, trail) =>
  lead >= 0x81 &&
  lead <= 0xfe &&
  trail !== undefined &&
  ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0xa1 && trail <= 0xfe))

/** Shift-JIS：首 81–9F / E0–FC，尾 40–7E 或 80–FC */
const sjisPair: PairRule = (lead, trail) =>
  ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xfc)) &&
  trail !== undefined &&
  ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))

/** EUC-JP：首 A1–FE，尾 A1–FE；0x8E 开头是两字节假名 */
const eucjpPair: PairRule = (lead, trail) => {
  if (lead === 0x8e) return trail !== undefined && trail >= 0xa1 && trail <= 0xdf
  return lead >= 0xa1 && lead <= 0xfe && trail !== undefined && trail >= 0xa1 && trail <= 0xfe
}

/** Shift-JIS 的单字节半角假名（A1–DF）不算首字节 */
function isSjisSingle(b: number): boolean {
  return b >= 0xa1 && b <= 0xdf
}

function scorePairs(
  bytes: Uint8Array,
  rule: PairRule,
  single: (b: number) => boolean,
): BytePairScore {
  let valid = 0
  let invalid = 0
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      i++
      continue
    }
    if (single(b)) {
      valid++ // 合法单字节（半角假名）
      i++
      continue
    }
    if (rule(b, bytes[i + 1])) {
      valid++
      i += 2
    } else {
      invalid++
      i++
    }
  }
  return { valid, invalid }
}

/** 主入口：启发式编码检测（见文件头注释的判定顺序） */
export function detectEncoding(bytes: Uint8Array): CharDetResult {
  const reasons: string[] = []

  // 1) BOM —— UTF-32 要在 UTF-16 之前判（FF FE 00 00 是 FF FE 的前缀）
  if (hasBom(bytes, BOM_UTF32LE)) {
    reasons.push(`BOM: ${toHex(BOM_UTF32LE)} (UTF-32LE)`)
    return { encoding: 'UTF-32LE', bom: toHex(BOM_UTF32LE), asciiSubset: false, reasons }
  }
  if (hasBom(bytes, BOM_UTF32BE)) {
    reasons.push(`BOM: ${toHex(BOM_UTF32BE)} (UTF-32BE)`)
    return { encoding: 'UTF-32BE', bom: toHex(BOM_UTF32BE), asciiSubset: false, reasons }
  }
  if (hasBom(bytes, BOM_UTF8)) {
    reasons.push(`BOM: ${toHex(BOM_UTF8)} (UTF-8)`)
    return { encoding: 'UTF-8', bom: toHex(BOM_UTF8), asciiSubset: false, reasons }
  }
  if (hasBom(bytes, [0xff, 0xfe])) {
    reasons.push('BOM: FF FE (UTF-16LE)')
    return { encoding: 'UTF-16LE', bom: 'FF FE', asciiSubset: false, reasons }
  }
  if (hasBom(bytes, [0xfe, 0xff])) {
    reasons.push('BOM: FE FF (UTF-16BE)')
    return { encoding: 'UTF-16BE', bom: 'FE FF', asciiSubset: false, reasons }
  }
  reasons.push('no BOM found')

  // 2) 全 ASCII —— 但 NUL 字节不算「纯文本」：含 00 的流要留给 UTF-16 检查
  let highBytes = 0
  let nullBytes = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) highBytes++
    else if (bytes[i] === 0) nullBytes++
  }
  const asciiSubset = highBytes === 0
  if (asciiSubset && nullBytes === 0) {
    reasons.push(`all ${bytes.length} bytes < 0x80 → plain ASCII`)
    return { encoding: 'ASCII', bom: null, asciiSubset: true, reasons }
  }
  if (asciiSubset) {
    reasons.push(`${nullBytes} NUL bytes among ${bytes.length} (rest < 0x80) → suspect UTF-16 text`)
  } else {
    reasons.push(`${highBytes} bytes >= 0x80 (not ASCII)`)
  }

  // 3) 空字节位置判 UTF-16（ASCII 文本位旁出现 00）。
  //    放在严格 UTF-8 校验之前：UTF-16 编码的 ASCII 文本（x 00 x 00…）里
  //    00 本身是合法 UTF-8 序列，先做 UTF-8 校验会把这类流误收进 UTF-8。
  const le = utf16Score(bytes, true)
  const be = utf16Score(bytes, false)
  if (le.score >= 0.8) {
    reasons.push(`null bytes at odd positions: ${Math.round(le.score * 100)}% → UTF-16LE pattern`)
    return { encoding: 'UTF-16LE', bom: null, asciiSubset: false, reasons }
  }
  if (be.score >= 0.8) {
    reasons.push(`null bytes at even positions: ${Math.round(be.score * 100)}% → UTF-16BE pattern`)
    return { encoding: 'UTF-16BE', bom: null, asciiSubset: false, reasons }
  }

  // 4) 严格 UTF-8 校验
  const utf8 = validateUtf8(bytes)
  if (utf8.valid) {
    reasons.push(
      `strict UTF-8 validation passed (${utf8.multiByte} multi-byte sequences, 100% valid)`,
    )
    return { encoding: 'UTF-8', bom: null, asciiSubset: false, reasons }
  }
  reasons.push('strict UTF-8 validation failed (invalid sequence or overlong form)')

  // 5) 双字节编码打分：合法序列占「合法+非法」的比例，取最高且 ≥ 0.9。
  //    候选按「范围专属度从高到低」排序：Shift-JIS 的首字节区（81-9F/E0-FC）
  //    与其余几家重叠最少，先判；GBK 的范围几乎覆盖全部（首 81-FE、
  //    尾 40-FE 除 7F），平分时反而该让给更窄的——但简中 GBK 与日文 EUC-JP
  //    / 繁中 Big5 的合法域高度重叠且无法靠范围区分，此处按使用频率把
  //    GBK 排在两者之前。少于 2 个首字节尝试的流没有统计意义，直接跳过
  //    （避免孤立高位字节的 Latin-1 文本被凑成一对「合法」GBK 序列）。
  const candidates: { encoding: string; score: BytePairScore; rule: PairRule }[] = [
    { encoding: 'Shift-JIS', score: scorePairs(bytes, sjisPair, isSjisSingle), rule: sjisPair },
    { encoding: 'GBK', score: scorePairs(bytes, gbkPair, () => false), rule: gbkPair },
    { encoding: 'EUC-JP', score: scorePairs(bytes, eucjpPair, () => false), rule: eucjpPair },
    { encoding: 'Big5', score: scorePairs(bytes, big5Pair, () => false), rule: big5Pair },
  ]
  let best: { encoding: string; ratio: number; score: BytePairScore } | null = null
  for (const c of candidates) {
    const total = c.score.valid + c.score.invalid
    if (total < 2) continue
    const ratio = c.score.valid / total
    if (ratio >= 0.9 && (best === null || ratio > best.ratio)) {
      best = { encoding: c.encoding, ratio, score: c.score }
    }
  }
  if (best !== null) {
    const total = best.score.valid + best.score.invalid
    reasons.push(
      `${best.encoding}: valid multi-byte sequences: ${Math.round(best.ratio * 100)}% (${total} lead bytes)`,
    )
    return { encoding: best.encoding, bom: null, asciiSubset: false, reasons }
  }
  reasons.push('no multi-byte pattern reached 90% validity')

  // 6) 兜底：0x80–0x9F 区间是 Windows-1252 与 Latin-1 唯一的分野
  const c1Controls = bytes.some((b) => b >= 0x80 && b <= 0x9f)
  const encoding = c1Controls ? 'Windows-1252' : 'Latin-1'
  reasons.push(
    c1Controls
      ? 'bytes in 0x80–0x9F present → Windows-1252 fallback'
      : 'all high bytes in 0xA0–0xFF → Latin-1 fallback',
  )
  return { encoding, bom: null, asciiSubset: false, reasons }
}

/**
 * 按指定编码解码字节为文本（用于预览）。编码名即 TextDecoder 的标签
 * （'GBK' / 'Big5' / 'Shift-JIS' / 'EUC-JP' / 'windows-1252' 等均为合法标签），
 * 环境不支持该标签时返回空串而非抛错。
 */
export function decodeWithEncoding(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return ''
  }
}
