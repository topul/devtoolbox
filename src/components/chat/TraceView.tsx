/**
 * 调用链路视图（对话 Drawer 内容）。
 *
 * 数据两级：主进程内存（chat-trace.ts，本次运行）→ 渲染层 IndexedDB 存档（trace-store.ts，跨重启）。
 * 内存命中后顺手写一份存档；内存未命中就读存档并标注「历史存档」。
 * 每轮一个区块 —— 请求头、请求体（tool loop 每轮都会把完整 wire 消息重发一遍，
 * 对比两轮的 messages 就是理解工具调用机制最好的教材）、SSE 帧样例、工具调用与结果。
 *
 * 拉不到就明说，不当作错误弹出来。
 */
import React, { useEffect, useState } from 'react'
import { CopyBtn, Collapse, Drawer, ErrorNote } from '../ui'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { loadTraceArchive, saveTraceArchive } from '../../lib/trace-store'
import type { ChatTrace, ChatTraceRound } from '../../lib/chat-types'

type L = (typeof chatL)['zh']

export function TraceDrawer({
  requestId,
  onClose,
}: {
  requestId: string
  onClose: () => void
}): React.ReactElement {
  const l = useLocalized(chatL)
  const [trace, setTrace] = useState<ChatTrace | null>(null)
  /** 链路来源：live = 本次运行内存；archive = IndexedDB 存档 */
  const [source, setSource] = useState<'live' | 'archive' | null>(null)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let alive = true
    type Hit = { kind: 'live' | 'archive'; trace: ChatTrace }
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    const fromMemory: Promise<Hit | null> = api?.trace
      ? api.trace(requestId).then((r) => (r.ok ? { kind: 'live' as const, trace: r.trace } : null))
      : Promise.resolve(null)
    // 内存未命中（或没有 IPC）时读 IndexedDB 存档 —— 历史会话的链路在这里
    const hit: Promise<Hit | null> = fromMemory.then(
      (m) =>
        m ??
        loadTraceArchive(requestId).then((arc) =>
          arc ? { kind: 'archive' as const, trace: arc } : null,
        ),
    )
    void hit
      .then((h) => {
        if (!alive) return
        if (!h) {
          setMissing(true)
          return
        }
        setTrace(h.trace)
        setSource(h.kind)
        if (h.kind === 'live') void saveTraceArchive(h.trace)
      })
      .catch((e) => {
        if (alive) setFailed((e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [requestId])

  return (
    <Drawer title={l.traceTitle} onClose={onClose} width={860}>
      {failed && <ErrorNote msg={failed} />}
      {missing && <p className="text-[12.5px] text-muted leading-relaxed">{l.traceMissing}</p>}
      {trace && (
        <div className="space-y-3">
          <div className="text-[11px] text-muted/70 flex items-center gap-2">
            {new Date(trace.startedAt).toLocaleString()} · {trace.requestId}
            {source === 'archive' && (
              <span className="text-[10px] px-1.5 border border-line-soft text-muted">
                {l.traceArchive}
              </span>
            )}
          </div>
          {trace.rounds.map((r) => (
            <RoundBlock key={r.round} round={r} l={l} />
          ))}
        </div>
      )}
    </Drawer>
  )
}

function RoundBlock({ round, l }: { round: ChatTraceRound; l: L }): React.ReactElement {
  const body = prettyJson(round.requestBody)
  return (
    <div className="border border-line rounded-lg bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-medium text-bright">
          {l.traceRound.replace('{n}', String(round.round))}
        </span>
        {round.meta && (
          <span className="text-[10.5px] text-muted">
            {round.meta.firstTokenMs ? `${l.firstToken} ${round.meta.firstTokenMs}ms · ` : ''}
            {(round.meta.totalMs / 1000).toFixed(1)}s · {l.chunks} {round.meta.chunks}
            {round.meta.usage ? ` · ${round.meta.usage.totalTokens} token` : ''}
            {round.meta.finishReason ? ` · ${round.meta.finishReason}` : ''}
          </span>
        )}
        {(round.truncated || round.framesTruncated) && (
          <span className="text-[10px] px-1.5 border border-amber/40 text-amber">
            {l.traceTruncated}
          </span>
        )}
      </div>

      {round.tools.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted">{l.traceTools}</div>
          {round.tools.map((t, i) => (
            <div key={t.call.id || i} className="text-[11.5px] pl-2 border-l-2 border-phosphor/30">
              {/* 走主题变量：硬编码色在亮色主题下几乎不可读（见 MessageView 同处说明） */}
              <span className="break-all" style={{ color: 'var(--c-hl-fn)' }}>
                {t.call.name}
              </span>
              <span className="text-muted/70 break-all"> {t.call.args}</span>
              {t.result && (
                <span className={t.result.ok && !t.result.isError ? 'text-muted' : 'text-danger'}>
                  {' '}
                  →{' '}
                  {t.result.ok && !t.result.isError
                    ? 'ok'
                    : (t.result.error || t.result.text || 'error').slice(0, 80)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Collapse title={l.traceRequestBody} hint={body ? `${body.length} 字符` : undefined}>
        {body ? (
          <div className="relative">
            <div className="absolute top-0 right-0">
              <CopyBtn text={body} />
            </div>
            <pre className="codeblock text-[11px] text-muted whitespace-pre-wrap break-words max-h-[50vh] overflow-auto">
              {body}
            </pre>
          </div>
        ) : (
          <span className="text-[11.5px] text-muted">—</span>
        )}
      </Collapse>

      <Collapse title={l.traceFrames} hint={`${round.frames.length}`}>
        {round.frames.length ? (
          <pre className="codeblock text-[11px] text-muted/90 whitespace-pre-wrap break-all max-h-[40vh] overflow-auto">
            {round.frames.join('\n')}
          </pre>
        ) : (
          <span className="text-[11.5px] text-muted">{l.traceNoFrames}</span>
        )}
      </Collapse>
    </div>
  )
}

/** 能解析就美化，不能就原文展示 —— 请求体一定是文本，但截断后可能不再是合法 JSON */
function prettyJson(text: string): string {
  if (!text) return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
