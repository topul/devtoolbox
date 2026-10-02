/**
 * JWT 安全分析 —— 渲染进程与 MCP 服务端共用。
 *
 * 覆盖三类常见问题：
 *   1. alg=none（无签名 token，任何 payload 都可信）
 *   2. 弱密钥（内置常见弱密钥词表，HMAC 逐条试）
 *   3. 算法混淆提示（RS256 站点若接受 HS256，攻击者可用公钥当 HMAC 密钥伪造）
 */
import CryptoJS from 'crypto-js'
import { jwtDecode } from './jwt'

export type JwtAlg = 'HS256' | 'HS384' | 'HS512'

export const JWT_HMAC_ALGOS: JwtAlg[] = ['HS256', 'HS384', 'HS512']

/** 词表：JWT 渗透里最常见的弱密钥（含空密钥） */
export const WEAK_JWT_KEYS: string[] = [
  '',
  'secret',
  'Secret',
  'SECRET',
  'your-256-bit-secret',
  'your-secret-key',
  'jwt-secret',
  'jwtsecret',
  'changeme',
  'change-me',
  'changeit',
  'password',
  'password123',
  '123456',
  '1234567890',
  'qwerty',
  'admin',
  'test',
  'testing',
  'dev',
  'development',
  'key',
  'mysecret',
  'my-secret',
  'supersecret',
  'super-secret',
  'topsecret',
  'top-secret',
  'shhhhh',
  'helloworld',
  'hello-world',
  'foobar',
  'abc123',
  'letmein',
  'token',
  'jwt',
  'secretkey',
  'secret-key',
  'private-key',
  'signing-key',
  'a-very-secret-key',
  'this-is-a-secret',
  'my-secret-key',
  'default',
  'example',
  'sample',
  'demo',
  'local',
  'localhost',
]

/** JWT alg 名 → crypto-js Hmac 函数名（HS256 → HmacSHA256） */
const CRYPTOJS_HMAC: Record<JwtAlg, string> = {
  HS256: 'HmacSHA256',
  HS384: 'HmacSHA384',
  HS512: 'HmacSHA512',
}

/** HMAC 签名（crypto-js 同步 API，SHA384 直接走 CryptoJS.HmacSHA384） */
function hmac(alg: JwtAlg, data: string, key: string): string {
  const fn = (CryptoJS as unknown as Record<string, ((m: string, k: string) => { toString(): string }) | undefined>)[CRYPTOJS_HMAC[alg]]
  if (!fn) throw new Error('BAD_ALGO:' + alg)
  return fn(data, key).toString()
}

/** base64url 解码签名段为字节 */
function signatureBytes(sigB64Url: string): Uint8Array {
  const clean = sigB64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  const bin = atobDefined(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** atob 的跨环境替代：base64 → 二进制字符串（复用 codec 的字母表语义） */
function atobDefined(s: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  let out = ''
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    buffer = (buffer << 6) | alphabet.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return out
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function hexToBytesLocal(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export interface JwtCrackResult {
  /** 解析出的 header.alg（小写归一前的原始值） */
  alg: string
  /** 是否存在签名段 */
  signed: boolean
  /** alg=none 类问题 */
  noneAlg: boolean
  /** 爆破命中的弱密钥（未命中为 null） */
  crackedKey: string | null
  /** 参与爆破的算法 */
  triedAlgo: JwtAlg | null
  /** 试了多少个密钥 */
  triedCount: number
  /** 非对称算法被用作 HMAC 的混淆风险提示（仅提示，不爆破） */
  confusionHint: boolean
  /** 其他值得提示的问题（如 kid 注入面） */
  notes: string[]
}

/**
 * 分析一个 JWT：
 * - alg=none 直接标记；
 * - HS256/384/512 用内置弱密钥词表爆破（只试常见密钥，不做全量字典）；
 * - RS/ES/PS 算法只给「算法混淆」提示，不尝试伪造。
 */
export function jwtAnalyze(token: string, extraKeys: string[] = []): JwtCrackResult {
  const decoded = jwtDecode(token)
  const algRaw = decoded.headerObj.alg
  const alg = typeof algRaw === 'string' ? algRaw : ''
  const notes: string[] = []

  const noneAlg = /^none$/i.test(alg)
  if (noneAlg) notes.push('alg=none')

  // kid / jku / x5u 注入面提示（只做静态提示，不发请求）
  if (typeof decoded.headerObj.kid === 'string' && /[./\\]|\.\./.test(decoded.headerObj.kid)) {
    notes.push('kid-suspicious')
  }
  if (typeof decoded.headerObj.jku === 'string') notes.push('jku-present')
  if (typeof decoded.headerObj.x5u === 'string') notes.push('x5u-present')

  const isHmac = JWT_HMAC_ALGOS.includes(alg.toUpperCase() as JwtAlg)
  const confusionHint = /^(RS|ES|PS)(256|384|512)$/.test(alg)

  if (!decoded.signed || !isHmac) {
    return {
      alg,
      signed: decoded.signed,
      noneAlg,
      crackedKey: null,
      triedAlgo: null,
      triedCount: 0,
      confusionHint,
      notes,
    }
  }

  const triedAlgo = alg.toUpperCase() as JwtAlg
  // 签名输入 = header.payload 两段原文（JWS 规范 RFC 7515）
  const signingInput = token.trim().split('.').slice(0, 2).join('.')
  const candidates = [...WEAK_JWT_KEYS, ...extraKeys]
  let crackedKey: string | null = null
  let expected: Uint8Array | null = null
  try {
    expected = signatureBytes(decoded.signature)
  } catch {
    expected = null
  }
  if (expected) {
    for (const key of candidates) {
      const sigHex = hmac(triedAlgo, signingInput, key)
      if (bytesEqual(hexToBytesLocal(sigHex), expected)) {
        crackedKey = key
        break
      }
    }
  }
  if (crackedKey !== null) notes.push('weak-key')

  return {
    alg,
    signed: true,
    noneAlg,
    crackedKey,
    triedAlgo,
    triedCount: candidates.length,
    confusionHint,
    notes,
  }
}

/**
 * 用指定密钥重签 token（验证「拿到弱密钥后能伪造任意身份」时演示用）。
 * alg 固定 HS256，与爆破命中的算法无关时调用方自行判断。
 */
export function jwtForge(payloadJson: string, key: string, alg: JwtAlg = 'HS256'): string {
  const header = JSON.stringify({ alg, typ: 'JWT' })
  const b64url = (s: string): string => {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoaLocal(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const signingInput = `${b64url(header)}.${b64url(payloadJson)}`
  const sig = hmac(alg, signingInput, key)
  // crypto-js 输出 hex；JWT 签名段要 base64url
  const sigBytes = hexToBytesLocal(sig)
  let bin = ''
  for (const b of sigBytes) bin += String.fromCharCode(b)
  const sigB64 = btoaLocal(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${signingInput}.${sigB64}`
}

function btoaLocal(bin: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bin.length; i += 3) {
    const b0 = bin.charCodeAt(i)
    const hasB1 = i + 1 < bin.length
    const hasB2 = i + 2 < bin.length
    const b1 = hasB1 ? bin.charCodeAt(i + 1) : 0
    const b2 = hasB2 ? bin.charCodeAt(i + 2) : 0
    out += alphabet[b0 >> 2]
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += hasB1 ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
    out += hasB2 ? alphabet[b2 & 0x3f] : '='
  }
  return out
}

/** payload 概览（界面展示用） */
export function jwtSummary(token: string): { alg: string; typ: string; iss?: string; sub?: string; exp?: string } {
  const d = jwtDecode(token)
  const h = d.headerObj
  const p = d.payloadObj
  return {
    alg: String(h.alg ?? ''),
    typ: String(h.typ ?? ''),
    iss: typeof p.iss === 'string' ? p.iss : undefined,
    sub: typeof p.sub === 'string' ? p.sub : undefined,
    exp: typeof p.exp === 'number' ? new Date(p.exp * 1000).toISOString() : undefined,
  }
}
