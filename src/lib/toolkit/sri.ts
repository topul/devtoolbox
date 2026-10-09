/**
 * SRI（Subresource Integrity）哈希生成 —— 渲染进程与 MCP 服务端共用的纯函数模块。
 *
 * SRI 的 integrity 值 = `algo-base64(digest)`，浏览器会拿它和实际下载到的
 * 资源摘要比对，不匹配就拒绝执行。摘要直接用 crypto-js 算（同步、双环境可跑）；
 * 字节转二进制串沿用 filehash.ts 的分块做法 —— Uint8Array 不能直接喂给
 * WordArray（会被当成 32 位字数组，结果错位），必须逐字节走 Latin1。
 */
import CryptoJS from 'crypto-js'

export type SriAlgo = 'sha256' | 'sha384' | 'sha512'

export interface SriResult {
  algo: SriAlgo
  /** 完整的 integrity 属性值，形如 sha384-<base64> */
  integrity: string
}

/** SRI 规范（W3C）支持的摘要算法里的三个 SHA-2 成员；浏览器推荐 sha384 */
export const SRI_ALGOS: SriAlgo[] = ['sha256', 'sha384', 'sha512']

const IMPL: Record<SriAlgo, 'SHA256' | 'SHA384' | 'SHA512'> = {
  sha256: 'SHA256',
  sha384: 'SHA384',
  sha512: 'SHA512',
}

/** integrity 值的格式：algo- + 标准 base64（含等号 padding） */
const SRI_RE = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/

/** Uint8Array → Latin1 二进制串：32KB 分块拼接，避免大文件爆栈（与 filehash.ts 同策略） */
function toLatin1(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return bin
}

/**
 * 计算字节流的 SRI integrity 值。algos 缺省时三个算法全算 ——
 * 一次读取产出全部候选，sha256 兼容旧浏览器、sha384 是当前的推荐默认。
 */
export function sriFromBytes(bytes: Uint8Array, algos: SriAlgo[] = SRI_ALGOS): SriResult[] {
  const wa = CryptoJS.enc.Latin1.parse(toLatin1(bytes))
  return algos.map((algo) => ({
    algo,
    integrity: `${algo}-${CryptoJS.enc.Base64.stringify(CryptoJS[IMPL[algo]](wa))}`,
  }))
}

/**
 * 解析 integrity 属性值，格式不合法返回 null。
 * 只接受单个值；多值形式（空格分隔的算法降级链）由调用方自行拆分后再逐个传入。
 */
export function parseSri(integrity: string): { algo: string; digestB64: string } | null {
  const m = integrity.trim().match(SRI_RE)
  if (!m) return null
  return { algo: m[1], digestB64: m[2] }
}
