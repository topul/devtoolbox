import React, { useState } from 'react'
import { Btn, TA, ErrorNote, CopyBtn, NoteList } from '../ui'
import {
  buildRequestFile,
  parseCurlCommand,
  parseRequestFile,
  type ImportErrorCode,
  type ParseErrorCode,
  type ParseWarning,
  type RequestDoc,
  type RequestEntry,
} from '../../lib/http-codegen'
import type { httpClientL } from '../../lib/locales/httpclient'

type L = (typeof httpClientL)['zh']

/** 一次性粘进来的内容上限：再大就不是「贴一条命令」了，让用户走文件导入 */
const MAX_PASTE_CHARS = 2_000_000

interface Props {
  /** 当前表单 → 中立文档 */
  toDoc: () => RequestDoc
  /** 文档 → 表单（已解析的 curl / 导入的单条请求都走这里） */
  applyDoc: (doc: RequestDoc, name?: string) => void
  /** 当前全部收藏 → 导出条目 */
  buildExport: () => RequestEntry[]
  /** 导入条目并入收藏，返回新增/跳过条数 */
  mergeImport: (entries: RequestEntry[]) => { added: number; skipped: number }
  /** 拿到结果后的回调：让调用方关掉抽屉、并把提示带回主界面 */
  onDone?: (notes: string[]) => void
  l: L
}

/** 文件名从 URL 派生，避免用户每次都要想名字 */
function fileNameFor(doc: RequestDoc): string {
  try {
    const u = new URL(doc.url.includes('://') ? doc.url : `http://${doc.url}`)
    const safe = `${doc.method}-${u.hostname}${u.pathname.replace(/\/+/g, '-')}`.replace(
      /[^a-zA-Z0-9._-]+/g,
      '-',
    )
    return `${safe.slice(0, 60)}.json`
  } catch {
    return 'devtoolbox-request.json'
  }
}

function warningText(w: ParseWarning, l: L): string {
  const m = l.transfer.warn
  switch (w.code) {
    case 'METHOD_INFERRED':
      return m.METHOD_INFERRED
    case 'UNKNOWN_FLAG':
      return m.UNKNOWN_FLAG(w.detail ?? '')
    case 'FILE_BODY':
      return m.FILE_BODY
    case 'MULTI_URL':
      return m.MULTI_URL(w.detail ?? '')
    case 'DATA_URLENCODE':
      return m.DATA_URLENCODE
    case 'HEADER_NO_COLON':
      return m.HEADER_NO_COLON(w.detail ?? '')
    default:
      return ''
  }
}

/**
 * 请求的导入 / 导出（内容是抽屉的 body，标题由 Drawer 提供）。
 *
 * 一个输入框吃两种东西：curl（PowerShell 的 curl.exe 也算）与导出的 JSON —— 让用户去想
 * 「我这条算哪种格式」本身就是多余的认知负担，直接按首字符判断。
 * 解析失败时只报错、绝不动表单里的现有内容。
 */
export function RequestTransfer({ toDoc, applyDoc, buildExport, mergeImport, onDone, l }: Props) {
  const [text, setText] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const api = typeof window !== 'undefined' ? window.electronAPI?.http : undefined

  const reset = (): void => {
    setNotes([])
    setError(null)
  }

  /** 结果同时留在抽屉里、并回送主界面 —— 抽屉一关，用户得在主界面上看见「填好了」 */
  const finish = (lines: string[]): void => {
    setNotes(lines)
    onDone?.(lines)
  }

  const errorText = (code?: ParseErrorCode | ImportErrorCode, version?: number): string => {
    const e = l.transfer.err
    switch (code) {
      case 'NO_URL':
        return e.noUrl
      case 'UNSUPPORTED':
        return e.unsupported
      case 'BAD_JSON':
        return e.badJson
      case 'BAD_VERSION':
        return e.badVersion(String(version ?? '?'))
      case 'BAD_SHAPE':
        return e.badShape
      default:
        return e.emptyInput
    }
  }

  const importJson = (raw: string): void => {
    const r = parseRequestFile(raw)
    if (!r.ok || r.requests.length === 0) {
      setError(errorText(r.errorCode, r.version))
      return
    }
    if (r.requests.length === 1) {
      applyDoc(r.requests[0].doc, r.requests[0].name)
      finish([l.transfer.loaded(r.requests[0].doc.headers.length)])
      return
    }
    const { added, skipped } = mergeImport(r.requests)
    finish([l.transfer.imported(added, skipped)])
  }

  const detect = (): void => {
    reset()
    const raw = text.trim()
    if (!raw) {
      setError(l.transfer.err.emptyInput)
      return
    }
    if (raw.length > MAX_PASTE_CHARS) {
      setError(l.transfer.err.tooLong)
      return
    }
    if (raw.startsWith('{') || raw.startsWith('[')) {
      importJson(raw)
      return
    }

    const r = parseCurlCommand(raw)
    if (!r.ok || !r.request) {
      setError(errorText(r.errorCode))
      return
    }
    applyDoc(r.request)
    const lines = [l.transfer.loaded(r.request.headers.length)]
    for (const w of r.warnings) {
      const t = warningText(w, l)
      if (t) lines.push(t)
    }
    finish(lines)
  }

  const exportToFile = async (which: 'current' | 'all'): Promise<void> => {
    reset()
    if (!api) {
      setError(l.transfer.err.desktopOnly)
      return
    }
    const entries: RequestEntry[] =
      which === 'current' ? [{ name: fileNameFor(toDoc()), doc: toDoc() }] : buildExport()
    if (entries.length === 0) {
      setNotes([l.transfer.noSaved])
      return
    }
    setBusy(true)
    try {
      const res = await api.exportFile({
        title: l.transfer.exportTitle,
        name: which === 'current' ? fileNameFor(entries[0].doc) : 'devtoolbox-requests.json',
        content: buildRequestFile(entries),
      })
      if (res.canceled) setNotes([l.transfer.canceled])
      else if (res.ok) setNotes([l.transfer.savedTo(res.path)])
      else setError(`${l.transfer.err.fileFailed}${res.error ? `: ${res.error}` : ''}`)
    } catch (err) {
      setError(`${l.transfer.err.fileFailed}: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const importFromFile = async (): Promise<void> => {
    reset()
    if (!api) {
      setError(l.transfer.err.desktopOnly)
      return
    }
    setBusy(true)
    try {
      const res = await api.importFile(l.transfer.importTitle)
      if (res.canceled) setNotes([l.transfer.canceled])
      else if (res.ok && typeof res.content === 'string') {
        setText(res.content)
        importJson(res.content)
      } else if (res.error === 'FILE_TOO_LARGE') setError(l.transfer.err.tooLarge)
      else setError(`${l.transfer.err.fileFailed}${res.error ? `: ${res.error}` : ''}`)
    } catch (err) {
      setError(`${l.transfer.err.fileFailed}: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const currentJson = buildRequestFile([{ name: fileNameFor(toDoc()), doc: toDoc() }])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Btn onClick={() => void importFromFile()} disabled={busy}>
          {l.transfer.importFile}
        </Btn>
        <Btn onClick={() => void exportToFile('current')} disabled={busy}>
          {l.transfer.exportCurrent}
        </Btn>
        <Btn onClick={() => void exportToFile('all')} disabled={busy}>
          {l.transfer.exportAll}
        </Btn>
        <CopyBtn text={currentJson} label={l.transfer.copyJson} />
      </div>

      <TA
        value={text}
        onChange={setText}
        label={l.transfer.pasteLabel}
        rows={8}
        placeholder={l.transfer.pastePlaceholder}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={detect}>
          {l.transfer.detect}
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            setText('')
            reset()
          }}
        >
          {l.transfer.clear}
        </Btn>
        <span className="text-[11px] text-muted flex-1 min-w-[200px]">{l.transfer.pasteHint}</span>
      </div>

      {error && <ErrorNote msg={error} />}
      <NoteList lines={notes} />
    </div>
  )
}
