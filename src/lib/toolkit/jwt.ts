/**
 * JWT 解析 —— 渲染进程与 MCP 服务端共用。
 * 只做解码，不验签：验签需要密钥，属于调用方的事。
 */
import { base64ToUtf8 } from './codec'

export interface JwtDecoded {
  headerObj: Record<string, unknown>
  payloadObj: Record<string, unknown>
  header: string
  payload: string
  signature: string
  /** 是否存在签名段（alg=none 的 token 没有第三段） */
  signed: boolean
}

export function jwtDecode(token: string): JwtDecoded {
  const t = token.trim()
  if (!t) throw new Error('EMPTY_INPUT')
  const parts = t.split('.')
  if (parts.length < 2) throw new Error('BAD_FORMAT')
  const headerObj = JSON.parse(base64ToUtf8(parts[0])) as Record<string, unknown>
  const payloadObj = JSON.parse(base64ToUtf8(parts[1])) as Record<string, unknown>
  return {
    headerObj,
    payloadObj,
    header: JSON.stringify(headerObj, null, 2),
    payload: JSON.stringify(payloadObj, null, 2),
    signature: parts[2] ?? '',
    signed: parts.length >= 3 && !!parts[2],
  }
}

/** 相对当前时间，token 是否已过期（有 exp 时才有意义） */
export function jwtIsExpired(payload: Record<string, unknown>, now = Date.now()): boolean | null {
  const exp = payload.exp
  if (typeof exp !== 'number') return null
  return exp * 1000 < now
}
