import React, { useState } from 'react'
import { Btn } from '../ui'
import { lineDiff, type DiffLine } from '../../lib/toolkit'
import {
  formatTime,
  formatDuration,
  statusColorClass,
  newRowId,
  type DecodedBody,
} from '../../lib/http-utils'
import type { HttpRequestResult } from '../../lib/http-types'
import { httpClientL } from '../../lib/locales/httpclient'

type L = (typeof httpClientL)['zh']

/* ================= 数据与纯函数（可测） ================= */

/** 一次响应的快照：只存解码后的正文文本与请求元信息 */
export interface ResponseSnapshot {
  id: string
  at: number
  method: string
  url: string
  status: number
  /** 解码后的正文文本；超过 MAX_BODY_CHARS 截断并置 truncated */
  bodyText: string
  truncated: boolean
  durationMs: number
}

export const SNAPSHOT_KEY = 'devtoolbox-http-snapshots'
export const MAX_SNAPSHOTS = 8
export const MAX_BODY_CHARS = 300_000
/** lineDiff 是 O(m·n) DP，超大文本先按行截断再比（两侧各取前 N 行） */
export const MAX_DIFF_LINES = 1200

/** 从响应构造快照；二进制响应返回 null（快照只对比文本） */
export function snapshotFromResponse(
  resp: HttpRequestResult,
  decoded: DecodedBody,
): ResponseSnapshot | null {
  if (decoded.binary) return null
  return {
    id: newRowId(),
    at: Date.now(),
    method: resp.method,
    url: resp.url,
    status: resp.status,
    bodyText:
      decoded.text.length > MAX_BODY_CHARS ? decoded.text.slice(0, MAX_BODY_CHARS) : decoded.text,
    truncated: decoded.text.length > MAX_BODY_CHARS,
    durationMs: resp.timings.totalMs,
  }
}

/** 追加快照并保持数量上限（新在前，超出丢最旧）；二进制返回原列表 */
export function addSnapshot(
  list: ResponseSnapshot[],
  snap: ResponseSnapshot | null,
): ResponseSnapshot[] {
  if (!snap) return list
  return [snap, ...list].slice(0, MAX_SNAPSHOTS)
}

/** diff 两侧各截到 MAX_DIFF_LINES 行；返回结果与是否被截断 */
export function boundedDiff(a: string, b: string): { lines: DiffLine[]; truncated: boolean } {
  if (!a && !b) return { lines: [], truncated: false }
  const al = a.split('\n')
  const bl = b.split('\n')
  const truncated = al.length > MAX_DIFF_LINES || bl.length > MAX_DIFF_LINES
  return {
    lines: lineDiff(al.slice(0, MAX_DIFF_LINES).join('\n'), bl.slice(0, MAX_DIFF_LINES).join('\n')),
    truncated,
  }
}

/* ================= 面板 ================= */

/** 快照抽屉：列表 + 「与当前响应对比」。对比在抽屉内完成，结果着色展示。 */
export function SnapshotPanel({
  snapshots,
  current,
  onRemove,
  l,
}: {
  snapshots: ResponseSnapshot[]
  /** 当前响应的解码文本；null 表示还没有响应可对比 */
  current: string | null
  onRemove: (id: string) => void
  l: L
}) {
  const [diffOf, setDiffOf] = useState<string | null>(null)

  const target = snapshots.find((s) => s.id === diffOf) ?? null
  const diff = target && current != null ? boundedDiff(target.bodyText, current) : null
  const stats = diff
    ? {
        add: diff.lines.filter((l) => l.type === 'add').length,
        del: diff.lines.filter((l) => l.type === 'del').length,
      }
    : null

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted">{l.snaps.hint}</div>

      {snapshots.length === 0 && <div className="text-[12px] text-muted">{l.snaps.empty}</div>}

      <div className="max-h-[40vh] overflow-auto divide-y divide-[color:var(--c-line-soft)]">
        {snapshots.map((s) => {
          const canCompare = current != null && !diffOf
          return (
            <div key={s.id} className="py-1.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className="shrink-0 text-phosphor w-14">{s.method}</span>
                  <span className={`shrink-0 ${statusColorClass(s.status)}`}>{s.status}</span>
                  <span className="text-muted shrink-0">{formatTime(s.at)}</span>
                  <span className="text-muted shrink-0">{formatDuration(s.durationMs)}</span>
                </div>
                <div className="text-[11.5px] text-dim truncate">{s.url}</div>
              </div>
              {canCompare && (
                <Btn variant="ghost" onClick={() => setDiffOf(s.id)}>
                  {l.snaps.compare}
                </Btn>
              )}
              <button
                onClick={() => onRemove(s.id)}
                className="shrink-0 text-muted hover:text-danger px-1"
                title={l.snaps.remove}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {diff && target && stats && (
        <div className="border border-line-soft space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-panel-2 flex-wrap">
            <span className="text-[11.5px] text-muted">
              {l.snaps.diffWith(target.method, target.url, formatTime(target.at))}
            </span>
            <span className="text-[11.5px] text-phosphor">+{stats.add}</span>
            <span className="text-[11.5px] text-danger">-{stats.del}</span>
            <Btn variant="ghost" onClick={() => setDiffOf(null)}>
              {l.snaps.close}
            </Btn>
          </div>
          {diff.truncated && (
            <div className="px-2 text-[11px] text-amber">
              {l.snaps.truncatedNote(MAX_DIFF_LINES)}
            </div>
          )}
          <pre className="max-h-[45vh] overflow-auto px-2 py-1.5 text-[11.5px] leading-[1.5] font-mono m-0">
            {diff.lines.map((ln, i) => (
              <div
                key={i}
                className={
                  ln.type === 'add'
                    ? 'text-phosphor bg-phosphor/5'
                    : ln.type === 'del'
                      ? 'text-danger bg-danger/5'
                      : 'text-dim'
                }
              >
                {ln.type === 'add' ? '+ ' : ln.type === 'del' ? '- ' : '  '}
                {ln.text || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}
