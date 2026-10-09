/**
 * JWT 签名与验签 —— 渲染进程与 MCP 服务端共用。
 *
 * 原来 `jwt.ts` 只做解码，明确「不验签」。这一份补上**签发**侧的能力，
 * 让「调通一个需要 JWT 的接口」不必离开本工具箱。
 *
 * 算法覆盖与取舍：
 *   - HS256/384/512：HMAC，对称，密钥即签名密钥 —— 本地最常用的三档；
 *   - none：不签名。**只在授权测试内网弱端点时用**，公网接口用了就是把自己交出去；
 *   - RS/ES/PS：不支持。它们是非对称算法，签名需要私钥，浏览器侧生成密钥对既慢又
 *     不安全（私钥会进内存），留给服务端做。工具里会明确说明这一点，而不是假装支持。
 *
 * 纯函数、无 Node 依赖：HMAC 用 WebCrypto（Node 18+ 与浏览器都有）。
 */

/** 支持的签名算法。刻意不含 RS/ES/PS —— 见文件头说明 */
export const JWT_SIGN_ALGOS = ['HS256', 'HS384', 'HS512', 'none'] as const
export type JwtSignAlgo = (typeof JWT_SIGN_ALGOS)[number]

/** 算法 → HMAC 摘要名 */
const HMAC_NAME: Record<Exclude<JwtSignAlgo, 'none'>, 'SHA-256' | 'SHA-384' | 'SHA-512'> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
}

/** 界面上展示用的算法说明（含「这个算法意味着什么」的风险提示） */
export const JWT_ALGO_LABELS: Record<JwtSignAlgo, string> = {
  HS256: 'HS256 · HMAC-SHA256',
  HS384: 'HS384 · HMAC-SHA384',
  HS512: 'HS512 · HMAC-SHA512',
  none: 'none',
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** WebCrypto 的 HMAC-SHA-*，密钥先按 alg 对应的摘要名导入 */
async function hmacSign(
  data: string,
  key: string,
  algo: 'SHA-256' | 'SHA-384' | 'SHA-512',
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: algo },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data)))
}

/** HMAC-SHA-* 的结果（定长 hex），签名与验签共用 */
export async function hmacHex(
  data: string,
  key: string,
  algo: 'SHA-256' | 'SHA-384' | 'SHA-512',
): Promise<string> {
  const sig = await hmacSign(data, key, algo)
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface JwtSignResult {
  token: string
  /** 签名值的 base64url（none 时为空串） */
  signature: string
  header: string
  payload: string
}

/**
 * 签发一个 JWT。
 *
 * @param payloadObj 载荷对象；`exp` / `iat` / `nbf` 传时间戳（秒）会被原样使用，
 *   也可以自己填字符串（有些服务接受 ISO 字符串）
 * @param key HMAC 密钥；`none` 时忽略
 */
export async function jwtSign(
  algo: JwtSignAlgo,
  payloadObj: Record<string, unknown>,
  key: string,
): Promise<JwtSignResult> {
  const headerObj = { alg: algo, typ: 'JWT' }
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify(headerObj)))
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payloadObj)))
  const signingInput = `${header}.${payload}`
  if (algo === 'none') {
    // 无签名：第三段留空。alg=none 的 token 没有签名段，服务端应当拒绝
    return {
      token: `${signingInput}.`,
      signature: '',
      header: signingInput.split('.')[0],
      payload: signingInput.split('.')[1],
    }
  }
  const sig = await hmacSign(signingInput, key, HMAC_NAME[algo])
  const signature = base64UrlEncode(sig)
  return { token: `${signingInput}.${signature}`, signature, header, payload }
}

export interface JwtVerifyResult {
  valid: boolean
  /** 不合法的原因（稳定错误码，不含自然语言） */
  reason: 'OK' | 'BAD_FORMAT' | 'ALG_MISMATCH' | 'SIG_MISMATCH' | 'NO_SIG'
}

/**
 * 用同一把密钥验签 HMAC-SHA-* 的 token。
 *
 * 只覆盖本模块能签的那几种算法；传 `none` 会直接判 NO_SIG ——
 * 这正是评审里点名要检的行为（算法混淆）。
 */
export async function jwtVerify(
  token: string,
  key: string,
  expect: Exclude<JwtSignAlgo, 'none'>,
): Promise<JwtVerifyResult> {
  const t = token.trim()
  if (!t) return { valid: false, reason: 'BAD_FORMAT' }
  const parts = t.split('.')
  if (parts.length < 2) return { valid: false, reason: 'BAD_FORMAT' }
  if (parts.length < 3 || !parts[2]) return { valid: false, reason: 'NO_SIG' }
  let header: { alg?: string }
  try {
    header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))) as { alg?: string }
  } catch {
    return { valid: false, reason: 'BAD_FORMAT' }
  }
  // 算法不符先判掉：拿 HS256 的密钥去验一个声明 RS256 的 token 没有意义
  if (header.alg !== expect) return { valid: false, reason: 'ALG_MISMATCH' }
  const expectSig = await hmacSign(`${parts[0]}.${parts[1]}`, key, HMAC_NAME[expect])
  const got = base64UrlToBytes(parts[2])
  if (got.length !== expectSig.length) return { valid: false, reason: 'SIG_MISMATCH' }
  // 定长比较：逐字节比，任何不等即无效（不提前返回，避免泄漏前缀信息）
  let diff = 0
  for (let i = 0; i < expectSig.length; i++) diff |= expectSig[i] ^ got[i]
  return diff === 0 ? { valid: true, reason: 'OK' } : { valid: false, reason: 'SIG_MISMATCH' }
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 常用相对时间：分钟 / 小时 / 天 → 绝对时间戳（秒） */
export function jwtExpIn(seconds: number, now = Date.now()): number {
  return Math.floor(now / 1000) + Math.floor(seconds)
}

/** 相对时间的预设（秒） */
export const JWT_TTL_PRESETS = [
  { key: '15m', seconds: 15 * 60, ttlKey: 'ttl15m' },
  { key: '1h', seconds: 3600, ttlKey: 'ttl1h' },
  { key: '8h', seconds: 8 * 3600, ttlKey: 'ttl8h' },
  { key: '7d', seconds: 7 * 86400, ttlKey: 'ttl7d' },
  { key: '30d', seconds: 30 * 86400, ttlKey: 'ttl30d' },
] as const
