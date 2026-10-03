/**
 * TOTP（RFC 6238）生成与校验 —— 渲染进程与 MCP 服务端共用。
 *
 * 用它做什么：调试任何走 TOTP 二次验证的接口时，需要一个能出码的东西。
 * 本模块**只做离线计算**，不发请求、不碰任何账号 —— 它算的是「这个密钥当前
 * 应该显示什么码」，不是「登录某个服务」。
 *
 * 参数取RFC 4226 的默认值：SHA-1、6 位、30 秒。Google / GitHub / 绝大多数
 * 验证器都用这套，所以默认值就是「和别人的密钥兼容」的那一套。
 */

import { base32Decode as decodeBase32, base32Encode as encodeBase32 } from './codecs'

/**
 * 解码 TOTP 用的 Base32 密钥。
 *
 * 复用 codecs里的实现（支持 rfc4648 / hex / crockford 多种变体），只在这里补两件事：
 *   1. 把它的中文错误码映射成本模块的稳定错误码；
 *   2. 容错常见笔误 —— 0↔O、1↔L↔I。这三个字符长得像，用户手输密钥时最容易搞错，
 *      报「非法字符」等于让人自己猜哪个字错了。
 */
/** 编码为 Base32（给「把密钥贴成 URL 里的 otpauth」这个场景用） */
export function encodeSecret(bytes: Uint8Array): string {
  return encodeBase32(bytes, 'rfc4648', false)
}

/**
 * 解码 TOTP 的 Base32 密钥。**导出来给界面做输入校验**：
 * 输入框可以在用户敲完时就告诉他「这个密钥长度不对」，而不是等点生成才报错。
 */
export function decodeSecret(secret: string): Uint8Array {
  const cleaned = secret.trim().replace(/[\s-]/g, '').toUpperCase()
  if (!cleaned) throw new Error('EMPTY_SECRET')
  // 先按原样试一次（绝大多数密钥没有笔误）
  try {
    return decodeBase32(cleaned)
  } catch { /* 落到下面的笔误修正 */ }
  const fixed = cleaned
    .replace(/0/g, 'O')
    .replace(/[1IL]/g, 'L')
  try {
    return decodeBase32(fixed)
  } catch {
    throw new Error('BAD_BASE32')
  }
}


/** 动态截断：取 HMAC 末字节的低 4 位作为偏移 */
/**
 * RFC 4226 的动态截断：取 HMAC 末字节低 4 位作偏移，取那 4 字节的 31 位。
 *
 * **必须用 `>>> 0` 收尾**：按位或 `|` 在 JS 里产出的是**有符号** 32 位整数，
 * 最高位为 1 时结果是负数。后续 `% 10 ** digits` 对负数会得到负余数，
 * 6 位时数值小不容易撞上，8 位及以上就会稳定算错。
 */
function dynamicTruncate(hash: Uint8Array): number {
  const offset = hash[hash.length - 1] & 0x0f
  const value = ((hash[offset] & 0x7f) << 24)
    | ((hash[offset + 1] & 0xff) << 16)
    | ((hash[offset + 2] & 0xff) << 8)
    | (hash[offset + 3] & 0xff)
  return value >>> 0
}

/** 把时间戳变成 8 字节大端计数器（RFC 4226 规定用 8 字节） */
function counterBytes(unixSeconds: number): Uint8Array {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  // 用 BigInt：8字节的高位在 JS 里用 number 会溢出到 2^53 之上
  view.setBigUint64(0, BigInt(Math.floor(unixSeconds)), false)
  return new Uint8Array(buf)
}

export interface TotpOptions {
  /** 码长度，默认 6 */
  digits?: number
  /** 时间步长（秒），默认 30 */
  period?: number
  /** 摘要算法，默认 SHA-1（兼容性最好） */
  algo?: 'SHA1' | 'SHA256' | 'SHA512'
}

/**
 * 生成 TOTP。
 *
 * @param secretBase32 服务商给的 Base32 密钥
 * @param atUnixSeconds 算哪个时刻的码，默认当前时间
 */
export async function totp(
  secretBase32: string,
  atUnixSeconds = Date.now() / 1000,
  opts: TotpOptions = {},
): Promise<string> {
  const digits = opts.digits ?? 6
  const period = opts.period ?? 30
  const key = decodeSecret(secretBase32)
  if (key.length === 0) throw new Error('EMPTY_SECRET')
  const counter = Math.floor(atUnixSeconds / period)
  const hash = await hmacFor(key, counterBytes(counter), opts.algo ?? 'SHA1')
  const code = dynamicTruncate(hash) % 10 ** digits
  return String(code).padStart(digits, '0')
}

/** 摘要算法名 → WebCrypto 认识的名字（注意 WebCrypto 要的是 `SHA-1` 带连字符，不是 `SHA1`） */
const WEBCRYPTO_HASH = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
} as const

async function hmacFor(key: Uint8Array, msg: Uint8Array, algo: 'SHA1' | 'SHA256' | 'SHA512'): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: WEBCRYPTO_HASH[algo] },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg as unknown as ArrayBuffer))
}

export interface TotpVerifyResult {
  valid: boolean
  /** 允许的漂移窗口（步）数 —— 服务端通常给 ±1 */
  window: number
}

/**
 * 校验一个 TOTP。
 *
 * 允许前后各 `window` 步：手机上显示的码与服务端时间差一两步很常见，
 * 卡死成 0 会让正常用户也校验失败。
 */
export async function totpVerify(
  secretBase32: string,
  code: string,
  atUnixSeconds = Date.now() / 1000,
  opts: TotpOptions & { window?: number } = {},
): Promise<TotpVerifyResult> {
  const window = opts.window ?? 1
  const target = code.trim()
  const current = Math.floor(atUnixSeconds / (opts.period ?? 30))
  for (let drift = -window; drift <= window; drift++) {
    const expected = await totp(secretBase32, (current + drift) * (opts.period ?? 30), opts)
    // 定长比较
    if (expected.length === target.length) {
      let diff = 0
      for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ target.charCodeAt(i)
      if (diff === 0) return { valid: true, window }
    }
  }
  return { valid: false, window }
}

/** 剩余秒数：距离当前步结束还有多久（进度条直接用它） */
export function totpRemaining(atUnixSeconds = Date.now() / 1000, period = 30): number {
  return period - Math.floor(atUnixSeconds % period)
}

/**
 * 解析 otpauth:// 链接（验证器扫码得到的就是它）。
 *
 * 格式：otpauth://totp/<issuer>:<account>?secret=...&issuer=...&digits=6&period=30
 */
export interface OtpauthMeta {
  issuer: string
  account: string
  secret: string
  digits: number
  period: number
  algo: 'SHA1' | 'SHA256' | 'SHA512'
}

export function parseOtpauth(url: string): OtpauthMeta {
  const u = new URL(url.trim())
  if (!u.protocol.startsWith('otpauth:')) throw new Error('NOT_OTPAUTH')
  const label = decodeURIComponent(u.pathname.replace(/^\//, ''))
  const colon = label.indexOf(':')
  const issuerFromLabel = colon >= 0 ? label.slice(0, colon) : ''
  const account = colon >= 0 ? label.slice(colon + 1) : label
  const q = u.searchParams
  const algoRaw = (q.get('algorithm') ?? 'SHA1').toUpperCase()
  const algo: OtpauthMeta['algo'] = algoRaw === 'SHA256' || algoRaw === 'SHA512' ? algoRaw : 'SHA1'
  return {
    issuer: q.get('issuer') ?? issuerFromLabel,
    account,
    secret: q.get('secret') ?? '',
    digits: Number(q.get('digits') ?? '6') || 6,
    period: Number(q.get('period') ?? '30') || 30,
    algo,
  }
}