/**
 * HTTP 压测 —— 「接口扛得住多少并发」的粗测器。
 * 请求走主进程 HTTP 内核（electronAPI.http.send），渲染层只做并发调度与统计；
 * 纯统计在 toolkit/loadtest.ts（MCP 侧也能复用）。
 *
 * ponytail: 闭环并发（每 worker 打完立刻打下一发），不做定速/爬坡；要 RPS 曲线再说。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Btn,
  ErrorNote,
  Input,
  Panel,
  Select,
  Stat,
  TA,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { liveStats, type LoadSample, type LoadStats } from '../lib/toolkit/loadtest'
import type { HttpRequestSpec } from '../lib/http-types'

const L = {
  zh: {
    url: '目标 URL',
    urlPh: 'http://127.0.0.1:3000/api/health',
    method: '方法',
    body: '请求体（可空）',
    headers: '请求头（每行 Key: Value，可空）',
    headersPh: 'Content-Type: application/json\nAuthorization: Bearer xxx',
    concurrency: '并发数',
    mode: '压测模式',
    modeCount: '固定请求数',
    modeDuration: '固定时长',
    count: '总请求数',
    duration: '时长（秒）',
    start: '开始压测',
    stop: '停止',
    running: '压测中…',
    done: '已完成',
    completed: '请求数',
    okRate: '成功率',
    rps: '吞吐 RPS',
    kbps: '吞吐 KB/s',
    latency: '延迟分布（ms）',
    statusDist: '状态码分布',
    netErrors: '网络错误',
    noErrors: '无',
    desktopOnly: '此工具需要桌面版（压测请求走主进程 HTTP 内核），网页版不可用。',
    badUrl: 'URL 需要以 http:// 或 https:// 开头',
    note: '**只对你有权压测的目标使用。** 请求从本机发出，并发数会真实打到目标服务上——对线上服务压测前请先获得许可。统计口径：成功率按 HTTP 2xx-4xx 计（4xx 也算服务有响应），网络层失败单列；延迟为全流程（含连接与 TLS）。',
  },
  en: {
    url: 'Target URL',
    urlPh: 'http://127.0.0.1:3000/api/health',
    method: 'Method',
    body: 'Request body (optional)',
    headers: 'Headers (one Key: Value per line, optional)',
    headersPh: 'Content-Type: application/json\nAuthorization: Bearer xxx',
    concurrency: 'Concurrency',
    mode: 'Mode',
    modeCount: 'Fixed request count',
    modeDuration: 'Fixed duration',
    count: 'Total requests',
    duration: 'Duration (s)',
    start: 'Start',
    stop: 'Stop',
    running: 'Running…',
    done: 'Done',
    completed: 'Requests',
    okRate: 'Success rate',
    rps: 'Throughput RPS',
    kbps: 'Throughput KB/s',
    latency: 'Latency (ms)',
    statusDist: 'Status codes',
    netErrors: 'Network errors',
    noErrors: 'None',
    desktopOnly:
      'This tool needs the desktop app (requests go through the main-process HTTP kernel); unavailable on the web.',
    badUrl: 'URL must start with http:// or https://',
    note: '**Only load-test targets you are authorized to test.** Requests leave your machine at full concurrency — get permission before pointing this at production. Success counts HTTP 2xx-4xx (a 4xx still means the server answered); network failures are tracked separately; latency is end-to-end (connect + TLS included).',
  },
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

function parseHeaders(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of text.split('\n')) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    if (k) out.push([k, line.slice(i + 1).trim()])
  }
  return out
}

function msStr(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1)
}

export function LoadTestTool() {
  const l = useLocalized(L)
  const [url, setUrl] = usePersistedState('loadtest', 'url', '')
  const [method, setMethod] = usePersistedState('loadtest', 'method', 'GET')
  const [body, setBody] = usePersistedState('loadtest', 'body', '')
  const [headers, setHeaders] = usePersistedState('loadtest', 'headers', '')
  const [concurrency, setConcurrency] = usePersistedState('loadtest', 'concurrency', '10')
  const [mode, setMode] = usePersistedState<'count' | 'duration'>('loadtest', 'mode', 'count')
  const [count, setCount] = usePersistedState('loadtest', 'count', '100')
  const [duration, setDuration] = usePersistedState('loadtest', 'duration', '10')

  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [stats, setStats] = useState<LoadStats | null>(null)
  const desktop = typeof window !== 'undefined' && !!window.electronAPI?.http

  // 运行期数据全部走 ref：热路径不进 React 状态，每 300ms 快照一次
  const samplesRef = useRef<LoadSample[]>([])
  const startRef = useRef(0)
  const runningRef = useRef(false)
  const completedRef = useRef(0)

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      setStats(liveStats(samplesRef.current, performance.now() - startRef.current))
    }, 300)
    return () => clearInterval(t)
  }, [running])

  const run = useCallback(async () => {
    const spec: HttpRequestSpec = {
      method,
      url: url.trim(),
      headers: parseHeaders(headers),
      bodyText: method === 'GET' || method === 'HEAD' ? null : body || null,
      timeoutMs: 30000,
    }
    const target = mode === 'count' ? Math.max(1, Number(count) || 1) : Infinity
    const deadline =
      mode === 'duration' ? performance.now() + Math.max(1, Number(duration) || 1) * 1000 : Infinity
    const workers = Math.min(Math.max(1, Number(concurrency) || 1), 256)

    samplesRef.current = []
    completedRef.current = 0
    startRef.current = performance.now()
    runningRef.current = true
    setRunning(true)
    setErr(null)
    setStats(null)

    const send = window.electronAPI!.http.send
    const worker = async (): Promise<void> => {
      while (runningRef.current && completedRef.current < target && performance.now() < deadline) {
        const t0 = performance.now()
        let sample: LoadSample
        try {
          const res = await send(spec)
          sample = {
            ms: performance.now() - t0,
            status: res.ok ? res.status : 0,
            bytes: res.ok ? res.bodyBytes : 0,
            errorCode: res.ok ? undefined : (res.errorCode ?? 'ERROR'),
          }
        } catch {
          sample = { ms: performance.now() - t0, status: 0, bytes: 0, errorCode: 'IPC' }
        }
        // ponytail: 延迟样本封顶 5 万，超出只进计数不进分位表，够代表分布了
        if (samplesRef.current.length < 50000) samplesRef.current.push(sample)
        completedRef.current++
      }
    }

    try {
      await Promise.all(Array.from({ length: workers }, worker))
    } finally {
      runningRef.current = false
      setRunning(false)
      setStats(liveStats(samplesRef.current, performance.now() - startRef.current))
    }
  }, [url, method, body, headers, concurrency, mode, count, duration])

  const start = useCallback(() => {
    if (!/^https?:\/\//.test(url.trim())) {
      setErr(l.badUrl)
      return
    }
    void run()
  }, [url, l.badUrl, run])

  const stop = useCallback(() => {
    runningRef.current = false
  }, [])

  const nCompleted = completedRef.current

  return (
    <ToolShell toolId="loadtest" note={l.note}>
      <Input toolInput value={url} onChange={setUrl} label={l.url} placeholder={l.urlPh} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <Select
            value={method}
            onChange={setMethod}
            label={l.method}
            options={METHODS.map((m) => ({ value: m, label: m }))}
          />
        </div>
        <Input
          value={concurrency}
          onChange={setConcurrency}
          label={l.concurrency}
          type="number"
          className="w-24"
        />
        <div className="w-40">
          <Select
            value={mode}
            onChange={(v) => setMode(v as 'count' | 'duration')}
            label={l.mode}
            options={[
              { value: 'count', label: l.modeCount },
              { value: 'duration', label: l.modeDuration },
            ]}
          />
        </div>
        {mode === 'count' ? (
          <Input value={count} onChange={setCount} label={l.count} type="number" className="w-28" />
        ) : (
          <Input
            value={duration}
            onChange={setDuration}
            label={l.duration}
            type="number"
            className="w-28"
          />
        )}
        {running ? (
          <Btn variant="danger" onClick={stop}>
            {l.stop}
          </Btn>
        ) : (
          <Btn variant="primary" onClick={start} disabled={!desktop}>
            {l.start}
          </Btn>
        )}
      </div>
      <ErrorNote msg={err} />
      {!desktop && <ErrorNote msg={l.desktopOnly} />}

      <TA
        value={headers}
        onChange={setHeaders}
        label={l.headers}
        placeholder={l.headersPh}
        rows={2}
        spellCheck={false}
      />
      {method !== 'GET' && method !== 'HEAD' && (
        <TA value={body} onChange={setBody} label={l.body} rows={3} spellCheck={false} />
      )}

      {running && (
        <div className="flex items-center gap-2 text-[12.5px] text-phosphor">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse" />
          {l.running}
        </div>
      )}

      {stats && stats.total > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label={l.completed} value={running ? nCompleted : stats.total} />
            <Stat
              label={l.okRate}
              value={stats.total ? `${((stats.ok / stats.total) * 100).toFixed(1)}%` : '—'}
            />
            <Stat label={l.rps} value={stats.rps.toFixed(1)} />
            <Stat label={l.kbps} value={stats.kbps.toFixed(1)} />
          </div>

          {!running && (
            <>
              <Panel title={l.latency}>
                <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 font-mono text-[12.5px] text-bright">
                  {(['min', 'avg', 'p50', 'p90', 'p95', 'p99', 'max'] as const).map((k) => (
                    <div key={k} className="px-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
                      {msStr(stats.latency[k])}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title={l.statusDist}>
                <div className="flex flex-wrap gap-1.5 font-mono text-[12px]">
                  {stats.statusCounts.length === 0 && stats.errors.length === 0 ? (
                    <span className="text-muted">{l.noErrors}</span>
                  ) : (
                    <>
                      {stats.statusCounts.map((s) => (
                        <span
                          key={s.status}
                          className="px-1.5 py-0.5 rounded bg-panel-2 text-bright"
                        >
                          {s.status} × {s.count}
                        </span>
                      ))}
                      {stats.errors.length > 0 && (
                        <span className="text-danger">
                          {l.netErrors}:{' '}
                          {stats.errors.map((e) => `${e.code} × ${e.count}`).join(', ')}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </Panel>
            </>
          )}
        </>
      )}
    </ToolShell>
  )
}
