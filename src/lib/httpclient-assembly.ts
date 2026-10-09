/**
 * HTTP 客户端：表单状态 → 可发送请求的派生层。
 *
 * 从 src/tools/httpclient.tsx 拆出：multipart 拼装、正文编码、认证头合并、
 * 中立文档（RequestDoc）组装全是 useMemo / useCallback 派生，不持有状态——
 * 输入是表单 state，输出发送、导出、代码生成共用同一份，避免多处组装互相漂移。
 */
import { useCallback, useMemo } from 'react'
import type { Row } from '../components/http/KVEditor'
import {
  authHeaderPairs,
  BODY_CT,
  bodyFromParts,
  buildFinalHeaders,
  type AuthState,
  type BodyMode,
  type OptState,
  type PickedFile,
} from './httpclient-model'
import { b64ToBytes, buildQueryRows, bytesToB64 } from './http-utils'
import type { RequestBody, RequestDoc } from './http-codegen'

export interface RequestAssemblyInput {
  method: string
  url: string
  headers: Row[]
  bodyMode: BodyMode
  bodyRaw: string
  fields: Row[]
  auth: AuthState
  options: OptState
  filePick: PickedFile | null
  fileFields: { id: string; name: string }[]
  fileFieldData: Record<string, PickedFile>
}

export function useRequestAssembly(i: RequestAssemblyInput) {
  const multipart = useMemo(() => {
    if (i.bodyMode !== 'multipart') return null
    const boundary = `----DevToolboxBoundary${Math.random().toString(36).slice(2, 10)}`
    const lines: string[] = []
    for (const f of i.fields.filter((x) => x.enabled && x.name)) {
      lines.push(`--${boundary}`)
      lines.push(`Content-Disposition: form-data; name="${f.name}"`)
      lines.push('')
      lines.push(f.value)
    }
    lines.push(`--${boundary}--`)
    lines.push('')
    return { boundary, body: lines.join('\r\n') }
  }, [i.bodyMode, i.fields])

  /** multipart 含文件字段时走字节拼装（文本 part 用 UTF-8 编码，文件 part 直接还原字节） */
  const multipartBinary = useMemo(() => {
    if (i.bodyMode !== 'multipart') return null
    const withFile = i.fileFields.filter((f) => f.name && i.fileFieldData[f.id])
    if (withFile.length === 0) return null
    const boundary = `----DevToolboxBoundary${Math.random().toString(36).slice(2, 10)}`
    const enc = new TextEncoder()
    const parts: Uint8Array[] = []
    const pushText = (s: string): void => {
      parts.push(enc.encode(s))
    }
    for (const f of i.fields.filter((x) => x.enabled && x.name)) {
      pushText(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`,
      )
    }
    for (const f of withFile) {
      const file = i.fileFieldData[f.id]
      pushText(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${file.name}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      )
      parts.push(b64ToBytes(file.base64))
      pushText('\r\n')
    }
    pushText(`--${boundary}--\r\n`)
    const total = parts.reduce((n, p) => n + p.length, 0)
    const body = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      body.set(p, off)
      off += p.length
    }
    return { boundary, base64: bytesToB64(body) }
  }, [i.bodyMode, i.fields, i.fileFields, i.fileFieldData])

  const builtBody = useMemo((): {
    text: string | null
    base64: string | null
    contentType: string | null
  } => {
    if (i.bodyMode === 'none') return { text: null, base64: null, contentType: null }
    if (i.bodyMode === 'binary') {
      return i.filePick
        ? { text: null, base64: i.filePick.base64, contentType: i.filePick.contentType }
        : { text: null, base64: null, contentType: null }
    }
    if (i.bodyMode === 'form') {
      const body = buildQueryRows(i.fields)
      return body
        ? { text: body, base64: null, contentType: BODY_CT.form }
        : { text: null, base64: null, contentType: null }
    }
    if (i.bodyMode === 'multipart') {
      const ct = `multipart/form-data; boundary=${(multipartBinary ?? multipart)?.boundary ?? ''}`
      if (multipartBinary) return { text: null, base64: multipartBinary.base64, contentType: ct }
      if (multipart) return { text: multipart.body, base64: null, contentType: ct }
      return { text: null, base64: null, contentType: null }
    }
    if (!i.bodyRaw.trim()) return { text: null, base64: null, contentType: null }
    return { text: i.bodyRaw, base64: null, contentType: BODY_CT[i.bodyMode] || null }
  }, [i.bodyMode, i.bodyRaw, i.fields, multipart, multipartBinary, i.filePick])

  /* ---- 认证派生请求头 ---- */
  const authHeaders = useMemo((): [string, string][] => authHeaderPairs(i.auth), [i.auth])

  /** 最终请求头：手工行 + 认证 + 正文类型 */
  const finalHeaders = useCallback(
    (): [string, string][] =>
      buildFinalHeaders({
        headers: i.headers,
        authHeaders,
        bodyContentType: builtBody.contentType,
      }),
    [i.headers, authHeaders, builtBody],
  )

  const docBody = useCallback((): RequestBody => {
    // binary / 文件字段进中立文档时用 <<file: ...>> 占位，导出与代码生成不内嵌文件内容
    if (i.bodyMode === 'binary') {
      return i.filePick ? { kind: 'text', text: `<<file: ${i.filePick.name}>>` } : { kind: 'none' }
    }
    const base = bodyFromParts(i.bodyMode, i.fields, i.bodyRaw)
    if (i.bodyMode === 'multipart' && base.kind === 'fields' && i.fileFields.some((f) => f.name)) {
      return {
        ...base,
        fields: [
          ...base.fields,
          ...i.fileFields
            .filter((f) => f.name)
            .map(
              (f) =>
                [f.name, `<<file: ${i.fileFieldData[f.id]?.name ?? '?'}>>`] as [string, string],
            ),
        ],
      }
    }
    return base
  }, [i.bodyMode, i.fields, i.bodyRaw, i.filePick, i.fileFields, i.fileFieldData])

  /** 中立文档：生成代码 / 导出 / 复制 JSON 的唯一输入 */
  const currentDoc = useCallback(
    (): RequestDoc => ({
      method: i.method,
      url: i.url.includes('://') || !i.url ? i.url : `http://${i.url}`,
      headers: finalHeaders(),
      body: docBody(),
      followRedirects: i.options.follow,
      verifyTls: i.options.verifyTls,
      proxy: i.options.useProxy ? i.options.proxy.trim() : null,
    }),
    [i.method, i.url, finalHeaders, docBody, i.options],
  )

  return { builtBody, authHeaders, finalHeaders, docBody, currentDoc }
}
