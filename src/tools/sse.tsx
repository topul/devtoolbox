import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Panel, Btn, Input, Select, ErrorNote } from '../components/ui'
import { KVEditor, type Row } from '../components/http/KVEditor'
import { useLocalized, useI18n } from '../lib/i18n'
import { sseL } from '../lib/locales/sse'
import type { SseEventFrame, SseSendSpec } from '../lib/sse-types'
import { formatTime, newRowId } from '../lib/http-utils'

type L = (typeof sseL)['zh']

/** 展示上限：超出后丢最旧，防止长流把渲染层撑爆 */
const MAX_SHOWN = 500

type ShownEvent = SseEventFrame & { seq: number; at: number }

export function SseTool() {
  const l = useLocalized(sseL) as L
  const { locale } = useI18n()
  const [url, setUrl] = useState('https://httpbin.org/sse')
  const [method, setMethod] = useState<'GET' | 'POST'>('GET')
  const [headers, setHeaders] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<ShownEvent[]>([])
  const [closed, setClosed] = useState(false)
  const connId = useRef('')
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const api = window.electronAPI?.sse
    if (!api) return
    const off = api.onEvent((evt) => {
      if (evt.id !== connId.current) return // 过滤掉旧连接的迟到事件
      if (evt.kind === 'open') setStatus(evt.status)
      else if (evt.kind === 'error') setError(evt.error)
      else if (evt.kind === 'frame') {
        seq.current += 1
        setEvents((prev) => [
          ...prev.slice(-(MAX_SHOWN - 1)),
          { ...evt, seq: seq.current, at: Date.now() },
        ])
      } else if (evt.kind === 'close') {
        setRunning(false)
        setClosed(true)
      }
    })
    return off
  }, [])

  useEffect(() => {
    // 新事件到达时贴底（用户没往上翻的时候）
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [events])

  const connect = useCallback(async () => {
    const api = window.electronAPI?.sse
    if (!api) {
      setError(l.desktopOnly)
      return
    }
    if (!url.trim()) {
      setError(l.emptyUrl)
      return
    }
    setError(null)
    setStatus(null)
    setEvents([])
    setClosed(false)
    seq.current = 0
    connId.current = newRowId()
    setRunning(true)
    const spec: SseSendSpec = {
      id: connId.current,
      url: url.trim(),
      method,
      headers: headers
        .filter((r) => r.enabled && r.name.trim())
        .map((r) => [r.name, r.value] as [string, string]),
    }
    await api.send(spec)
  }, [url, method, headers, l])

  const abort = useCallback(async () => {
    const api = window.electronAPI?.sse
    if (api) await api.abort(connId.current)
    setRunning(false)
    setClosed(true)
  }, [])

  const frameCount = events.filter((e) => e.kind === 'frame').length

  return (
    <div className="space-y-3">
      <Panel
        title={l.title}
        right={
          <span className="text-[11px] text-muted">
            {running
              ? l.connecting
              : closed
                ? `${l.ended} · ${l.frameCount(frameCount)}`
                : status != null
                  ? `${l.open} ${status}`
                  : l.idle}
          </span>
        }
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="w-28 shrink-0">
              <Select
                label={l.method}
                value={method}
                onChange={(v) => setMethod(v as 'GET' | 'POST')}
                options={[
                  { value: 'GET', label: 'GET' },
                  { value: 'POST', label: 'POST' },
                ]}
              />
            </div>
            <Input
              label={l.urlLabel}
              value={url}
              onChange={setUrl}
              placeholder={l.urlPlaceholder}
            />
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <Btn variant="primary" onClick={() => void abort()}>
                {l.stop}
              </Btn>
            ) : (
              <Btn variant="primary" onClick={() => void connect()}>
                {l.connect}
              </Btn>
            )}
            {running && <span className="text-[11.5px] text-amber">{l.streaming}</span>}
          </div>
          {error && <ErrorNote msg={error} />}
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted select-none">{l.headersToggle}</summary>
            <div className="pt-2">
              <KVEditor
                rows={headers}
                onChange={setHeaders}
                addLabel={l.kv.add}
                nameLabel={l.kv.name}
                valueLabel={l.kv.value}
                removeLabel={l.kv.remove}
                headerSuggest
              />
            </div>
          </details>
        </div>
      </Panel>

      <Panel
        title={l.events}
        right={<span className="text-[11px] text-muted">{l.frameCount(frameCount)}</span>}
      >
        {events.length === 0 ? (
          <div className="text-[12px] text-muted">{running ? l.waiting : l.none}</div>
        ) : (
          <div ref={listRef} className="max-h-[52vh] overflow-auto space-y-1">
            {events.map((e) => {
              if (e.kind === 'frame') {
                return (
                  <div key={e.seq} className="border border-line-soft bg-panel-2 px-2.5 py-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <span className="text-phosphor">{e.frame.event}</span>
                      {e.frame.id != null && <span>id: {e.frame.id}</span>}
                      <span className="ml-auto">{formatTime(e.at)}</span>
                    </div>
                    <pre className="codeblock whitespace-pre-wrap break-all px-0 py-1 text-[12px] text-bright m-0">
                      {e.frame.data || ' '}
                    </pre>
                  </div>
                )
              }
              if (e.kind === 'open') {
                return (
                  <div key={e.seq} className="text-[11.5px] text-phosphor">
                    {locale === 'zh' ? '已连接' : 'Connected'} · {e.status}
                  </div>
                )
              }
              if (e.kind === 'error') {
                return (
                  <div key={e.seq} className="text-[11.5px] text-danger break-all">
                    {e.error}
                  </div>
                )
              }
              return (
                <div key={e.seq} className="text-[11.5px] text-muted">
                  {locale === 'zh' ? '连接已关闭' : 'Connection closed'}（{e.reason}）
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}
