/**
 * IEEE 754 浮点位查看 —— 把一个 number 拆成 sign / exponent / mantissa 三段位型，
 * 以及把位型粘回去还原成数值（双向都给 MCP 与界面共用）。
 *
 * 32/64 位走 DataView 的 f32/f64 视图（平台原生、零误差）；16 位 half-float
 * 没有原生视图，按 IEEE 754 binary16 规范手写编解码（思路与 Three.js DataUtils
 * 同源：f32 位型重偏置 + round-to-nearest-even，未抄第三方实现）。
 * 全文件纯函数、零 DOM 依赖，浏览器渲染进程与 Node 均可运行。
 */
export type FloatWidth = 16 | 32 | 64

export interface FloatBitsResult {
  /** 定宽大写十六进制（16→4 位、32→8 位、64→16 位） */
  hex: string
  /** 按 `s eeeee mmm…` 插了两个空格的完整位串 */
  bin: string
  sign: '0' | '1'
  expBits: string
  mantissaBits: string
  /**
   * 实际指数（编码值 - bias）。
   * subnormal 编码值恒为 0，此处给有效指数 1 - bias（隐含位约定）；
   * inf/NaN 时该值无实义，仅按编码值 - bias 给出。
   */
  expValue: number
  isSpecial: 'normal' | 'zero' | 'inf' | 'nan' | 'subnormal'
}

/** 模块级共享的 8 字节视图：避免每次调用都分配（纯函数也可持有不可变缓冲） */
const DV = new DataView(new ArrayBuffer(8))

/**
 * f32 位型 → binary16 位型（round-to-nearest-even）。
 * 超出 half 范围（|x| > 65504 的舍入结果）溢出为无穷；幅度 < 2^-25 下溢为 ±0。
 */
function f32ToF16Bits(value: number): number {
  DV.setFloat32(0, value)
  const x = DV.getUint32(0)
  const sign = (x >>> 16) & 0x8000
  const exp32 = (x >>> 23) & 0xff
  const mant32 = x & 0x7fffff

  if (exp32 === 0xff) {
    // Inf / NaN：NaN 带上固定尾巴 0x7e00（quiet NaN 的惯用位型）
    return mant32 !== 0 ? sign | 0x7e00 : sign | 0x7c00
  }

  // 重偏置：f32 bias 127 → f16 bias 15，即 exp16 = exp32 - 112
  const exp16 = exp32 - 112

  if (exp16 >= 31) return sign | 0x7c00 // 溢出 → half 无穷
  if (exp16 <= 0) {
    if (exp16 < -10) return sign // 幅度 < 2^-25 → ±0
    // subnormal：目标值 = N × 2^-24（N 是 10 位尾数字段），
    // N = 含隐含位尾数 × 2^(exp16-14)，即右移 14 - exp16 位后按最近偶数舍入
    const mant = mant32 | 0x800000
    const shift = 14 - exp16 // 14..24
    const shifted = mant >>> shift
    const roundBits = mant & ((1 << shift) - 1)
    const halfway = 1 << (shift - 1)
    let result = shifted
    if (roundBits > halfway || (roundBits === halfway && (shifted & 1) === 1)) result++
    // result 进位到 0x400 时恰好升格为最小正规数（exp 位段自动变 1）
    return sign | result
  }

  // 正规数：尾数取高 10 位 + 最近偶数舍入；进位到 0x400 说明升到下一个 2 的幂
  let mant = mant32 >>> 13
  const roundBits = mant32 & 0x1fff
  if (roundBits > 0x1000 || (roundBits === 0x1000 && (mant & 1) === 1)) mant++
  if (mant === 0x400) return sign | ((exp16 + 1) << 10)
  return sign | (exp16 << 10) | mant
}

/** binary16 位型 → number（结果必然是 f32 可精确表示的值，fround 兜底） */
function f16BitsToNumber(h: number): number {
  const sign = (h & 0x8000) !== 0 ? -1 : 1
  const exp = (h >>> 10) & 0x1f
  const mant = h & 0x3ff
  if (exp === 0x1f) return mant === 0 ? sign * Infinity : NaN
  if (exp === 0) {
    if (mant === 0) return sign * 0 // 保留 -0
    return Math.fround(sign * mant * 2 ** -24) // subnormal：mant × 2^(1-15-10)
  }
  return Math.fround(sign * (1 + mant / 1024) * 2 ** (exp - 15))
}

/** 把整型位串按三段切并生成完整结果（三宽度共用） */
function assemble(bin: string, width: FloatWidth): FloatBitsResult {
  const expW = width === 16 ? 5 : width === 32 ? 8 : 11
  const bias = (1 << (expW - 1)) - 1
  const sign = bin[0] === '1' ? '1' : '0'
  const expBits = bin.slice(1, 1 + expW)
  const mantissaBits = bin.slice(1 + expW)
  const enc = parseInt(expBits, 2)
  const mantAllZero = /^0*$/.test(mantissaBits)

  let isSpecial: FloatBitsResult['isSpecial']
  let expValue: number
  if (enc === 0) {
    isSpecial = mantAllZero ? 'zero' : 'subnormal'
    expValue = 1 - bias // subnormal 的有效指数（隐含位约定）
  } else if (enc === (1 << expW) - 1) {
    isSpecial = mantAllZero ? 'inf' : 'nan'
    expValue = enc - bias
  } else {
    isSpecial = 'normal'
    expValue = enc - bias
  }

  const hexDigits = width / 4
  // 64 位整型超出 double 精度，用 BigInt 转 hex；16/32 位直接 parseInt
  const hex =
    width === 64
      ? BigInt('0b' + bin)
          .toString(16)
          .padStart(hexDigits, '0')
          .toUpperCase()
      : parseInt(bin, 2).toString(16).padStart(hexDigits, '0').toUpperCase()

  return {
    hex,
    bin: `${sign} ${expBits} ${mantissaBits}`,
    sign: sign as '0' | '1',
    expBits,
    mantissaBits,
    expValue,
    isSpecial,
  }
}

/** number → 位型（正向拆解） */
export function floatToBits(value: number, width: FloatWidth): FloatBitsResult {
  let bin: string
  if (width === 16) {
    bin = f32ToF16Bits(value).toString(2).padStart(16, '0')
  } else if (width === 32) {
    DV.setFloat32(0, value)
    bin = DV.getUint32(0).toString(2).padStart(32, '0')
  } else {
    DV.setFloat64(0, value)
    bin =
      DV.getUint32(0).toString(2).padStart(32, '0') + DV.getUint32(4).toString(2).padStart(32, '0')
  }
  return assemble(bin, width)
}

/**
 * 位型 → number（反向还原）。同时接受十六进制与二进制串：
 * `0x`/`0b` 前缀显式指定；无前缀时「纯 0/1 且长度超过 hex 定宽」按二进制，
 * 否则按十六进制（从本工具展示区复制的 hex / 带空格 bin 都能直接粘回来）。
 * 非法字符或超长返回 null。
 */
export function bitsToFloat(hexOrBin: string, width: FloatWidth): number | null {
  const raw = hexOrBin.trim().toLowerCase().replace(/[\s_]/g, '')
  if (raw.length === 0) return null
  const hexDigits = width / 4

  let isBin = false
  let s = raw
  if (s.startsWith('0b')) {
    isBin = true
    s = s.slice(2)
  } else if (s.startsWith('0x')) {
    s = s.slice(2)
  } else if (s.length > hexDigits) {
    isBin = /^[01]+$/.test(s)
  }

  if (s.length === 0) return null
  if (s.length > (isBin ? width : hexDigits)) return null

  let bin: string
  try {
    bin = BigInt(isBin ? '0b' + s : '0x' + s)
      .toString(2)
      .padStart(width, '0')
  } catch {
    return null // 非法字符（BigInt 前缀解析失败）
  }

  if (width === 16) return f16BitsToNumber(parseInt(bin, 2))
  if (width === 32) {
    DV.setUint32(0, parseInt(bin, 2) >>> 0)
    return DV.getFloat32(0)
  }
  DV.setUint32(0, Number(BigInt('0b' + bin.slice(0, 32))))
  DV.setUint32(4, Number(BigInt('0b' + bin.slice(32))))
  return DV.getFloat64(0)
}
