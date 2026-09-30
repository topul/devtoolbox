import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Panel, Btn, Input, ErrorNote } from '../components/ui'
import { KVEditor, type Row } from '../components/http/KVEditor'
import { useLocalized } from '../lib/i18n'
import { wsL } from '../lib/locales/ws'
import type { WsEventFrame, WsSendSpec } from '../lib/ws-types'
import { formatTime, newRowId } from '../lib/http-utils'

type L = typeof wsL['zh']

/** 展示上限：超出丢最旧，防止长会话撑爆渲染层 */
const MAX_SHOWN = 500

type ShownEvent = WsEventFrame & { seq: number; at: number }

export function WsTool() {
  const l = useLocalized(wsL) as L
  const [url, setUrl] = useState('wss://ws.postman-echo.com/raw')
  const [headers, setHeaders] = useState<Row[]>([])
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<ShownEvent[]>([])
  const connId = useRef('')
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const api = window.electronAPI?.ws
    if (!api) return
    const off = api.onEvent((evt) => {
      if (evt.id !== connId.current) return // 旧连接的迟到事件
      if (evt.kind === 'open') setRunning(true)
      else if (evt.kind === 'error') setError(evt.error)
      else if (evt.kind === 'close') {
        setRunning(false)
      } else if (evt.kind === 'message') {
        seq.current += 1
        setEvents((prev) => [...prev.slice(-(MAX_SHOWN - 1)), { ...evt, seq: seq.current, at: Date.now() }])
      }
    })
    return off
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [events])

  const connect = useCallback(async () => {
    const api = window.electronAPI?.ws
    if (!api) {
      setError(l.desktopOnly)
      return
    }
    if (!url.trim()) {
      setError(l.emptyUrl)
      return
    }
    setError(null)
    setEvents([])
    seq.current = 0
    connId.current = newRowId()
    const spec: WsSendSpec = {
      id: connId.current,
      url: url.trim(),
      headers: headers.filter((r) => r.enabled && r.name.trim()).map((r) => [r.name, r.value] as [string, string]),
    }
    await api.connect(spec)
  }, [url, headers, l])

  const disconnect = useCallback(async () => {
    const api = window.electronAPI?.ws
    if (api) await api.close(connId.current)
    setRunning(false)
  }, [])

  const send = useCallback(async () => {
    const api = window.electronAPI?.ws
    const text = draft
    if (!api || !text.trim() || !running) return
    const r = await api.send(connId.current, text)
    if (!r.ok) {
      setError(l.sendFail(r.error ?? ''))
      return
    }
    seq.current += 1
    setEvents((prev) => [...prev.slice(-(MAX_SHOWN - 1)), { id: connId.current, kind: 'message', dir: 'out', data: text, seq: seq.current, at: Date.now() }])
    setDraft('')
  }, [draft, running, l])

  const msgCount = events.filter((e) => e.kind === 'message').length

  return (
    <div className="space-y-3">
      <Panel
        title={l.title}
        right={<span className="text-[11px] text-muted">{running ? l.open : l.idle} · {msgCount} {l.msgs}</span>}
      >
        <div className="space-y-2">
          <Input label={l.urlLabel} value={url} onChange={setUrl} placeholder={l.urlPlaceholder} />
          <div className="flex items-center gap-2">
            {running
              ? <Btn variant="primary" onClick={() => void disconnect()}>{l.disconnect}</Btn>
              : <Btn variant="primary" onClick={() => void connect()}>{l.connect}</Btn>}
          </div>
          {error && <ErrorNote msg={error} />}
          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted select-none">{l.headersToggle}</summary>
            <div className="pt-2">
              <KVEditor rows={headers} onChange={setHeaders} addLabel={l.kv.add} nameLabel={l.kv.name} valueLabel={l.kv.value} removeLabel={l.kv.remove} headerSuggest />
            </div>
          </details>
        </div>
      </Panel>

      <Panel title={l.messages}>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send() }}
              placeholder={running ? l.sendPlaceholder : l.sendDisabled}
              disabled={!running}
              spellCheck={false}
              className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2.5 py-1.5 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40 disabled:opacity-50"
            />
            <Btn variant="primary" onClick={() => void send()} disabled={!running}>{l.send}</Btn>
          </div>
          {events.length === 0 ? (
            <div className="text-[12px] text-muted">{running ? l.waiting : l.none}</div>
          ) : (
            <div ref={listRef} className="max-h-[52vh] overflow-auto space-y-1">
              {events.map((e) => {
                if (e.kind === 'message') {
                  const out = e.dir === 'out'
                  return (
                    <div key={e.seq} className="flex items-start gap-2">
                      <span className={`shrink-0 text-[11px] ${out ? 'text-phosphor' : 'text-amber'}`}>{out ? '↑' : '↓'}</span>
                      <pre className={`codeblock flex-1 min-w-0 whitespace-pre-wrap break-all px-2 py-1 text-[12px] m-0 border ${out ? 'border-phosphor/30 text-phosphor' : 'border-line-soft text-bright bg-panel-2'}`}>{e.data}</pre>
                      <span className="shrink-0 text-[11px] text-muted">{formatTime(e.at)}</span>
                    </div>
                  )
                }
                if (e.kind === 'error') return <div key={e.seq} className="text-[11.5px] text-danger break-all">{e.error}</div>
                if (e.kind === 'close') return <div key={e.seq} className="text-[11.5px] text-muted">{l.closed(e.code, e.reason)}</div>
                return <div key={e.seq} className="text-[11.5px] text-phosphor">{l.opened}</div>
              })}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
