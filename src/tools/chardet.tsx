/**
 * 文本编码检测器 —— 拖入文件（必须是字节：粘贴文本已经过应用层的编码假设，
 * 检测就失真了），启发式判断它是什么编码并按该编码解码出预览。
 *
 * 专治「打开乱码」：先看检测器说是 GBK 还是 Shift-JIS 还是 UTF-16，再决定
 * 用什么编码重新打开。检测算法与判定依据（reasons）在 toolkit/chardet.ts；
 * 拖放交互沿用 filehash 工具的现成模式。
 */
import React, { useCallback, useRef, useState } from 'react'
import { Btn, ErrorNote, KV, Panel, Stat, TA, ToolShell } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { decodeWithEncoding, detectEncoding, type CharDetResult } from '../lib/toolkit/chardet'

const L = {
  zh: {
    pick: '选择文件',
    dropHint:
      '拖一个文本文件到这里，或点击选择 —— 编码检测必须吃字节，不支持文本粘贴；文件只在本地处理，不会上传',
    bom: 'BOM',
    ascii: 'ASCII 子集',
    yes: '是',
    no: '否',
    size: '字节数',
    reasons: '判定依据',
    preview: '按检测编码解码预览（前 2KB）',
    previewEmpty: '（该编码在当前环境无解码器，无法预览）',
    reset: '清除',
    err: '读取文件失败',
    note: '这是启发式判定（BOM → UTF-8 严格校验 → UTF-16 空字节位型 → GBK/Big5/日文编码打分），不是 chardet 库的全量打分；中文/日文乱码场景先看这里的结论，再决定用什么编码重新打开。',
  },
  en: {
    pick: 'Choose file',
    dropHint:
      'Drop a text file here, or click to choose — detection needs raw bytes, pasted text will not work; files are processed locally, nothing is uploaded',
    bom: 'BOM',
    ascii: 'ASCII subset',
    yes: 'yes',
    no: 'no',
    size: 'Bytes',
    reasons: 'Evidence',
    preview: 'Preview decoded with detected encoding (first 2KB)',
    previewEmpty: '(no decoder for this encoding in the current environment)',
    reset: 'Clear',
    err: 'Failed to read file',
    note: 'This is a heuristic (BOM → strict UTF-8 → UTF-16 null-byte pattern → GBK/Big5/Japanese scoring), not a full chardet-library ranking. For mojibake in Chinese/Japanese files, start here, then reopen with the suggested encoding.',
  },
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function CharDetTool() {
  const l = useLocalized(L)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [result, setResult] = useState<CharDetResult | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onFile = useCallback(
    async (file: File) => {
      setErr(null)
      setResult(null)
      try {
        const buf = new Uint8Array(await file.arrayBuffer())
        setFileName(file.name)
        setFileSize(file.size)
        setBytes(buf)
        setResult(detectEncoding(buf))
      } catch {
        setErr(l.err)
      }
    },
    [l.err],
  )

  const reset = useCallback(() => {
    setFileName('')
    setFileSize(0)
    setResult(null)
    setBytes(null)
    setErr(null)
  }, [])

  // 预览：按检测到的编码解码前 2KB（解码失败时 decodeWithEncoding 返回空串）
  const preview =
    result && bytes ? decodeWithEncoding(bytes.subarray(0, 2048), result.encoding) : ''

  return (
    <ToolShell toolId="chardet">
      <div
        role="button"
        tabIndex={0}
        aria-label={l.pick}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void onFile(f)
        }}
        className={`rounded-lg border border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-phosphor bg-phosphor-faint/40'
            : 'border-line hover:border-phosphor/40 hover:bg-phosphor-faint/20'
        }`}
      >
        <div className="text-[13px] text-bright">{l.pick}</div>
        <div className="mt-1 text-[12px] text-muted">{l.dropHint}</div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
          }}
        />
      </div>

      <ErrorNote msg={err} />

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label={result.encoding} value={fileName || '—'} />
            <Stat label={l.size} value={fmtSize(fileSize)} />
          </div>

          <Panel
            title={result.encoding}
            right={
              <Btn variant="ghost" onClick={reset}>
                {l.reset}
              </Btn>
            }
          >
            <KV k={l.bom} v={result.bom ?? '—'} />
            <KV k={l.ascii} v={result.asciiSubset ? l.yes : l.no} mono={false} />
            <KV k={l.size} v={fmtSize(fileSize)} />
            <div className="mt-3">
              <div className="text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">
                {l.reasons}
              </div>
              <div className="space-y-0.5">
                {result.reasons.map((r, i) => (
                  <div key={`${i}-${r}`} className="font-mono text-[11px] text-muted break-all">
                    · {r}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <TA readOnly rows={6} value={preview || l.previewEmpty} label={l.preview} />
        </>
      )}

      <p className="text-[12px] text-muted leading-relaxed">{l.note}</p>
    </ToolShell>
  )
}
