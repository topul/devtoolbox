/**
 * 文件校验和 —— 与 hash.ts（文本）互补的「字节级」哈希。
 *
 * 为什么单独一个模块：文件可能几十 MB，不能像文本那样整体转成 crypto-js 的
 * WordArray（内存翻倍还容易爆栈），这里按 32KB 分块喂给 progressive hasher。
 * 算法只保留文件校验真正会用的四种（MD5 / SHA-1 / SHA-256 / SHA-512）——
 * RIPEMD160 / SHA3 是文本哈希工具的场景。
 */
import CryptoJS from 'crypto-js'

export const FILE_HASH_ALGOS = ['MD5', 'SHA1', 'SHA256', 'SHA512'] as const
export type FileHashAlgo = (typeof FILE_HASH_ALGOS)[number]

/** crypto-js algo 工厂的名字（SHA256 在 crypto-js 里就叫 SHA256） */
const IMPL: Record<FileHashAlgo, 'MD5' | 'SHA1' | 'SHA256' | 'SHA512'> = {
  MD5: 'MD5',
  SHA1: 'SHA1',
  SHA256: 'SHA256',
  SHA512: 'SHA512',
}

const CHUNK = 0x8000 // 32KB：逐块 update，避免整文件转二进制字符串

/** 字节流的单算法摘要（hex 小写） */
export function digestBytes(algo: FileHashAlgo, bytes: Uint8Array): string {
  const hasher = CryptoJS.algo[IMPL[algo]].create()
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    let bin = ''
    for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j])
    hasher.update(CryptoJS.enc.Latin1.parse(bin))
  }
  return hasher.finalize().toString(CryptoJS.enc.Hex)
}

/** 全部算法一次算完（同一个文件只读一遍就出四种校验和） */
export function digestBytesAll(bytes: Uint8Array): { algo: FileHashAlgo; value: string }[] {
  return FILE_HASH_ALGOS.map((algo) => ({ algo, value: digestBytes(algo, bytes) }))
}

/** 与期望值比对：忽略大小写、允许粘进「MD5=xxx」「<hash>  file.zip」这类常见格式 */
export function extractChecksum(input: string): string {
  const m = input.trim().match(/([a-f0-9]{32,128})/i)
  return m ? m[1].toLowerCase() : input.trim().toLowerCase()
}

export function checksumMatches(actual: string, expectedInput: string): boolean {
  const expected = extractChecksum(expectedInput)
  return expected.length >= 32 && actual.toLowerCase() === expected
}
