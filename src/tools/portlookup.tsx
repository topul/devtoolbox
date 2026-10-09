/**
 * 端口占用查询 —— 「8080 被谁占了」的本地排障第一步。
 * lsof/netstat 必须在主进程跑（渲染进程没有 shell），IPC 契约在 lib/portlookup-types.ts。
 */
import React, { useCallback, useState } from 'react'
import { Btn, ErrorNote, Input, KV, Panel, ToolShell } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import type { PortLookupResult } from '../lib/portlookup-types'

const L = {
  zh: {
    port: '端口号',
    portPh: '8080',
    lookup: '查询占用',
    searching: '查询中…',
    result: '占用进程',
    free: '当前没有进程占用该端口',
    state: '状态',
    local: '本地地址',
    foreign: '对端',
    proto: '协议',
    note: '**只读查询，不结束任何进程。** macOS/Linux 走 lsof（能拿到进程名与 pid），缺失时退回 netstat；Windows 走 netstat + tasklist。普通用户可能查不到系统进程的名字（权限所限），结果会留空 pid。',
    desktopOnly: '此工具需要桌面版（要调用系统命令），网页版不可用。',
  },
  en: {
    port: 'Port',
    portPh: '8080',
    lookup: 'Look up',
    searching: 'Looking up…',
    result: 'Occupants',
    free: 'No process is using this port',
    state: 'State',
    local: 'Local address',
    foreign: 'Peer',
    proto: 'Proto',
    note: '**Read-only lookup — never kills anything.** macOS/Linux use lsof (gives process name and pid) with a netstat fallback; Windows uses netstat + tasklist. As a normal user you may not see names of system processes (permission limit); those rows show an empty pid.',
    desktopOnly:
      'This tool needs the desktop app (it shells out to system commands); unavailable on the web.',
  },
}

export function PortLookupTool() {
  const l = useLocalized(L)
  const [port, setPort] = useState('8080')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PortLookupResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const desktop = typeof window !== 'undefined' && !!window.electronAPI?.port

  const lookup = useCallback(async () => {
    const p = Number(port)
    if (!Number.isInteger(p) || p < 0 || p > 65535) {
      setErr('0-65535')
      return
    }
    setErr(null)
    setBusy(true)
    try {
      setResult(await window.electronAPI!.port.lookup(p))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [port])

  return (
    <ToolShell toolId="port-lookup" note={l.note}>
      <div className="flex items-end gap-2">
        <Input
          toolInput
          value={port}
          onChange={setPort}
          label={l.port}
          placeholder={l.portPh}
          type="number"
          className="w-40"
        />
        <Btn variant="primary" onClick={lookup} disabled={busy || !desktop}>
          {busy ? l.searching : l.lookup}
        </Btn>
      </div>
      <ErrorNote msg={err} />
      {!desktop && <ErrorNote msg={l.desktopOnly} />}

      {result && (
        <Panel title={l.result}>
          {result.entries.length === 0 ? (
            <div className="text-[12.5px] text-muted py-1">{l.free}</div>
          ) : (
            <div className="space-y-1">
              {result.entries.map((e, i) => (
                <div key={i} className="border-b border-line-soft last:border-0 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-phosphor">
                      {e.process || `pid ${e.pid ?? '?'}`}
                    </span>
                    {e.pid !== null && (
                      <span className="font-mono text-[11px] text-muted">pid {e.pid}</span>
                    )}
                    {e.state && (
                      <span className="text-[11px] px-1.5 rounded bg-panel-2 text-muted">
                        {e.state}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5">
                    <KV k={l.local} v={`${e.local}`} />
                    <KV k={l.foreign} v={`${e.foreign}`} />
                    <KV k={l.proto} v={e.proto} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.command && (
            <div className="mt-2 font-mono text-[11px] text-muted">$ {result.command}</div>
          )}
        </Panel>
      )}
    </ToolShell>
  )
}
