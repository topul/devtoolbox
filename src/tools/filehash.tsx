/**
 * 文件校验和 —— 拖入文件算 MD5 / SHA-1 / SHA-256 / SHA-512，与期望值比对。
 *
 * 验证下载完整性是比「文本哈希」更高频的场景，而且必须吃字节：文本哈希工具
 * 拿到的是字符串，二进制文件没法进。实现走 useLocalized 内联词条（单工具模块，
 * 不再单开 locale 文件），算法在 toolkit/filehash.ts（分块 progressive hash）。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Btn, CopyBtn, ErrorNote, Input, KV, Panel, ToolShell } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { checksumMatches, digestBytesAll, type FileHashAlgo } from '../lib/toolkit/filehash'

const L = {
  zh: {
    pick: '选择文件',
    dropHint: '拖一个文件到这里，或点击选择 —— 文件只在本地内存中计算，不会上传',
    expected: '期望的校验和',
    expectedPh: '粘贴下载页提供的值，支持「MD5=…」「<hash>  文件名」格式',
    matchOk: '与期望值匹配 ✓',
    matchBad: '与期望值不一致 — 文件可能不完整或被改动',
    name: '文件名',
    size: '大小',
    algo: '算法',
    value: '校验和',
    reset: '清除',
    err: '读取文件失败',
  },
  en: {
    pick: 'Choose file',
    dropHint: 'Drop a file here, or click to choose — hashing happens locally, nothing is uploaded',
    expected: 'Expected checksum',
    expectedPh: 'Paste the value from the download page; "MD5=…" and "<hash>  file" both work',
    matchOk: 'Matches expected value ✓',
    matchBad: 'Does not match — file may be incomplete or modified',
    name: 'File',
    size: 'Size',
    algo: 'Algorithm',
    value: 'Checksum',
    reset: 'Clear',
    err: 'Failed to read file',
  },
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function FileHashTool() {
  const l = useLocalized(L)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [hashes, setHashes] = useState<{ algo: FileHashAlgo; value: string }[] | null>(null)
  const [expected, setExpected] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onFile = useCallback(
    async (file: File) => {
      setErr(null)
      setHashes(null)
      try {
        const buf = await file.arrayBuffer()
        setFileName(file.name)
        setFileSize(file.size)
        setHashes(digestBytesAll(new Uint8Array(buf)))
      } catch {
        setErr(l.err)
      }
    },
    [l.err],
  )

  const match = useMemo(() => {
    if (!expected.trim() || !hashes) return null
    return hashes.some((h) => checksumMatches(h.value, expected))
  }, [expected, hashes])

  const reset = useCallback(() => {
    setFileName('')
    setFileSize(0)
    setHashes(null)
    setErr(null)
  }, [])

  return (
    <ToolShell toolId="file-hash">
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

      {hashes && (
        <Panel
          title={l.algo}
          right={
            <Btn variant="ghost" onClick={reset}>
              {l.reset}
            </Btn>
          }
        >
          <div className="mb-2">
            <KV k={l.name} v={fileName} />
            <KV k={l.size} v={fmtSize(fileSize)} />
          </div>
          <div className="space-y-1.5 mt-2">
            {hashes.map((h) => (
              <div
                key={h.algo}
                className="flex items-center gap-2 py-1 border-b border-line-soft last:border-0"
              >
                <span className="shrink-0 w-16 text-[12px] text-muted font-mono">{h.algo}</span>
                <span className="flex-1 min-w-0 font-mono text-[12px] text-bright break-all">
                  {h.value}
                </span>
                <CopyBtn text={h.value} className="shrink-0" />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {hashes && (
        <>
          <Input
            value={expected}
            onChange={setExpected}
            label={l.expected}
            placeholder={l.expectedPh}
          />
          {match !== null && (
            <div
              role="status"
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                match
                  ? 'border-phosphor/40 bg-phosphor-faint/40 text-bright'
                  : 'border-danger/35 bg-danger/10 text-danger'
              }`}
            >
              {match ? l.matchOk : l.matchBad}
            </div>
          )}
        </>
      )}
    </ToolShell>
  )
}
