/**
 * 哈希 / HMAC / 对称加密 —— 渲染进程与 MCP 服务端共用。
 * 依赖 crypto-js（CJS 包，必须默认导入，否则 ESM 具名导入会在运行时炸）。
 */
import CryptoJS from 'crypto-js'

export const HASH_ALGOS = ['MD5', 'SHA1', 'SHA256', 'SHA512', 'SHA3', 'RIPEMD160'] as const
export type HashAlgo = (typeof HASH_ALGOS)[number]

/** 界面上展示用的算法名（带连字符） */
export const HASH_LABELS: Record<HashAlgo, string> = {
  MD5: 'MD5',
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
  SHA3: 'SHA-3',
  RIPEMD160: 'RIPEMD160',
}

export function digest(algo: HashAlgo, text: string): string {
  const fn = (CryptoJS as unknown as Record<string, ((s: string) => CryptoJS.lib.WordArray) | undefined>)[algo]
  if (!fn) throw new Error('BAD_ALGO:' + algo)
  return fn(text).toString()
}

/** 一次算出全部算法，供界面表格使用 */
export function digestAll(text: string): { label: string; value: string }[] {
  return HASH_ALGOS.map((a) => ({ label: HASH_LABELS[a], value: digest(a, text) }))
}

export const HMAC_ALGOS = ['MD5', 'SHA1', 'SHA256', 'SHA512'] as const
export type HmacAlgo = (typeof HMAC_ALGOS)[number]

export function hmacDigest(algo: HmacAlgo, text: string, key: string): string {
  const fn = (CryptoJS as unknown as Record<string, ((m: string, k: string) => CryptoJS.lib.WordArray) | undefined>)['Hmac' + algo]
  if (!fn) throw new Error('BAD_ALGO:' + algo)
  return fn(text, key).toString()
}

export type AesMode = 'ECB' | 'CBC'

/**
 * 密钥派生沿用界面既有约定：密钥右侧补 \0 到 32 字节；
 * CBC 的 IV 取「补足 16 字节后反转」的结果。改动会破坏与历史密文的兼容性。
 */
function aesKey(key: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Utf8.parse(key.padEnd(32, '\0').slice(0, 32))
}
function aesIv(key: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Utf8.parse(key.padEnd(16, '\0').split('').reverse().join('').slice(0, 16))
}

export function aesEncrypt(plain: string, key: string, mode: AesMode): string {
  if (!key) throw new Error('NEED_KEY')
  const cfg: Record<string, unknown> = { mode: (CryptoJS.mode as unknown as Record<string, unknown>)[mode], padding: CryptoJS.pad.Pkcs7 }
  if (mode !== 'ECB') cfg.iv = aesIv(key)
  return CryptoJS.AES.encrypt(plain, aesKey(key), cfg as never).toString()
}

export function aesDecrypt(cipher: string, key: string, mode: AesMode): string {
  if (!key) throw new Error('NEED_KEY')
  const cfg: Record<string, unknown> = { mode: (CryptoJS.mode as unknown as Record<string, unknown>)[mode], padding: CryptoJS.pad.Pkcs7 }
  if (mode !== 'ECB') cfg.iv = aesIv(key)
  const out = CryptoJS.AES.decrypt(cipher.trim(), aesKey(key), cfg as never).toString(CryptoJS.enc.Utf8)
  if (!out) throw new Error('DECRYPT_EMPTY')
  return out
}
