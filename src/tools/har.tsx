import React, { useState, useMemo, useCallback } from 'react'
import {
  Btn,
  TA,
  ErrorNote,
  Panel,
  Collapse,
  KV,
  Stat,
  Select,
  ResultPanel,
  usePersistedState,
  ToolGuide,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { harL } from '../lib/locales/har'
import { SendToMenu } from '../components/SendTo'
import { handoffBus, harEntryToHandoff } from '../lib/handoff'
import {
  parseHar,
  buildWaterfall,
  summarizeByHost,
  formatBytes,
  extractEntryDetail,
  type HarSummary,
  type WaterfallRow,
} from '../lib/toolkit'

/** 瀑布图的最大宽度基准（毫秒）—— 超过这个值就按比例压缩 */
const WATERFALL_SPAN = 3000

/** 批量交接给请求对比的勾选上限：A/B 各一条 */
const COMPARE_CAP = 2

/** 一份最小可用的示例，省得用户手写 */
const SAMPLE = `{
  "log": {
    "version": "1.2",
    "creator": { "name": "DevTools", "version": "120" },
    "pages": [],
    "entries": [
      {
        "startedDateTime": "2026-03-01T10:00:00.000Z",
        "time": 120,
        "_resourceType": "document",
        "request": {
          "method": "GET", "url": "https://example.com/index.html",
          "httpVersion": "HTTP/2",
          "headers": [{ "name": "User-Agent", "value": "Mozilla/5.0" }],
          "queryString": []
        },
        "response": {
          "status": 200, "statusText": "OK", "httpVersion": "HTTP/2",
          "headers": [{ "name": "content-type", "value": "text/html" }],
          "content": { "size": 2048, "mimeType": "text/html", "text": "<!doctype html>" },
          "redirectURL": "", "headersSize": 180, "bodySize": 512
        },
        "timings": { "blocked": 1, "dns": 10, "connect": 20, "send": 1, "wait": 80, "receive": 8, "ssl": 15 },
        "serverIPAddress": "93.184.216.34", "connection": "443"
      }
    ]
  }
}`

/**
 * HAR 解析。
 *
 * 纯本地解析（不联网），所以放在渲染层不需要主进程通道。
 * 详情页要显示的headers / queryString 从原始 HAR 里按 index 取
 * （解析逻辑放在 toolkit 的 extractEntryDetail，组件不写遍历）。
 */
export function HarTool() {
  const l = useLocalized(harL)
  const [raw, setRaw] = usePersistedState('har-analyze', 'input', '')
  const [parsed, setParsed] = useState<{ har: unknown; sum: HarSummary } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'failed'>('all')
  // 批量送对比的勾选（原始 HAR entry index，纯瞬时状态，发完即清）
  const [marked, setMarked] = useState<number[]>([])

  const run = useCallback(() => {
    setErr(null)
    if (!raw.trim()) {
      setParsed(null)
      return
    }
    try {
      const har = JSON.parse(raw)
      setParsed({ har, sum: parseHar(har) })
      setPicked(null)
    } catch (e) {
      // 两种失败：JSON 语法错、或不是 HAR 结构。分开提示才有可操作性
      const msg = (e as Error).message
      if ((e as Error).message === 'BAD_HAR') {
        setErr(l.invalid.replace('{msg}', 'missing log.entries'))
      } else {
        try {
          parseHar(raw)
          setErr(l.invalid.replace('{msg}', msg))
        } catch {
          setErr(l.invalid.replace('{msg}', msg))
        }
      }
      setParsed(null)
    }
  }, [raw, l])

  const rows = useMemo(() => {
    if (!parsed) return []
    const all = buildWaterfall(parsed.sum.entries)
    return filter === 'failed' ? all.filter((r) => r.isFailed) : all
  }, [parsed, filter])

  const hosts = useMemo(() => (parsed ? summarizeByHost(parsed.sum.entries) : []), [parsed])

  // 只认当前 HAR 里还存在的条目 index：重新解析后悬挂勾选自动剔除
  const aliveMarks = useMemo(
    () => (parsed ? marked.filter((i) => parsed.sum.entries.some((e) => e.index === i)) : []),
    [parsed, marked],
  )

  const toggleMark = useCallback((idx: number): void => {
    setMarked((m) =>
      m.includes(idx) ? m.filter((x) => x !== idx) : m.length >= COMPARE_CAP ? m : [...m, idx],
    )
  }, [])

  const sendCompare = useCallback((): void => {
    if (!parsed || aliveMarks.length !== COMPARE_CAP) return
    const a = harEntryToHandoff(parsed.har, aliveMarks[0])
    const b = harEntryToHandoff(parsed.har, aliveMarks[1])
    if (!a || !b) return
    handoffBus.push('reqdiff-a', a)
    handoffBus.push('reqdiff-b', b)
    setMarked([])
    window.location.hash = 'reqdiff'
  }, [parsed, aliveMarks])

  const stats = useMemo(() => {
    if (!parsed) return null
    const es = parsed.sum.entries
    return {
      total: es.length,
      failed: es.filter((e) => e.isFailed).length,
      bytes: es.reduce((n, e) => n + (e.transferSize > 0 ? e.transferSize : 0), 0),
    }
  }, [parsed])

  const detail = useMemo(() => {
    if (!parsed || picked === null) return null
    return extractEntryDetail(parsed.har, picked)
  }, [parsed, picked])

  return (
    <div className="space-y-3">
      <ToolGuide title={l.title} steps={[l.sub, l.parse, l.waterfall]} note={l.localOnly} />

      <Panel
        title={l.input}
        right={
          <div className="flex gap-1.5">
            <Btn
              variant="ghost"
              onClick={() => {
                setRaw(SAMPLE)
                setErr(null)
              }}
            >
              {l.loadSample}
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setRaw('')
                setParsed(null)
                setErr(null)
              }}
            >
              {l.clear}
            </Btn>
          </div>
        }
      >
        <TA value={raw} onChange={setRaw} rows={6} placeholder={l.inputPh} />
        <p className="text-[11px] text-muted mt-1">{l.redactionNote}</p>
      </Panel>

      <div className="flex gap-2">
        <Btn variant="primary" onClick={run} disabled={!raw.trim()}>
          {l.parse}
        </Btn>
        {parsed && (
          <div className="w-32">
            <Select
              value={filter}
              onChange={(v) => setFilter(v as 'all' | 'failed')}
              label={l.filterAll}
              options={[
                { value: 'all', label: l.filterAll },
                { value: 'failed', label: l.filterFailed },
              ]}
            />
          </div>
        )}
      </div>

      <ErrorNote msg={err} />

      {parsed && stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label={l.entries} value={<span className="text-sm">{stats.total}</span>} />
            <Stat
              label={l.totalBytes}
              value={<span className="text-sm">{formatBytes(stats.bytes)}</span>}
            />
            <Stat
              label={l.failed}
              value={
                <span className={`text-sm ${stats.failed ? 'text-danger' : 'text-phosphor'}`}>
                  {stats.failed}
                </span>
              }
            />
            <Stat
              label={l.withBody}
              value={<span className="text-sm">{parsed.sum.hasBody ? '✓' : '—'}</span>}
            />
          </div>

          <Panel title={l.summary}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4">
              <KV k={l.version} v={parsed.sum.version || '—'} />
              <KV k={l.creator} v={parsed.sum.creator || '—'} />
              <KV k={l.pages} v={String(parsed.sum.pageCount)} />
              <KV
                k={l.filtered
                  .replace('{n}', String(rows.length))
                  .replace('{total}', String(stats.total))}
                v=""
              />
            </div>
          </Panel>
        </>
      )}

      {aliveMarks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap border border-amber/40 bg-amber/5 px-3 py-1.5 text-[11.5px]">
          <span className="text-amber font-medium">{l.markedCount(aliveMarks.length)}</span>
          <button
            onClick={sendCompare}
            disabled={aliveMarks.length !== COMPARE_CAP}
            className="px-2 py-0.5 border border-phosphor/50 text-phosphor hover:bg-phosphor/10 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {l.sendCompare}
          </button>
          <button
            onClick={() => setMarked([])}
            className="px-2 py-0.5 border border-line-soft text-muted hover:text-bright"
          >
            {l.clearMarks}
          </button>
          {aliveMarks.length < COMPARE_CAP && <span className="text-muted">{l.markHint}</span>}
        </div>
      )}

      {rows.length > 0 && (
        <Panel title={l.waterfall}>
          <WaterfallView
            rows={rows}
            picked={picked}
            onPick={setPicked}
            marked={aliveMarks}
            onToggleMark={toggleMark}
            markTitle={l.markTitle}
            clearMarks={l.clearMarks}
          />
        </Panel>
      )}

      {hosts.length > 0 && (
        <Panel title={l.byHost}>
          <div className="space-y-1">
            {hosts.map((h) => (
              <div key={h.host} className="flex items-baseline gap-3 text-[12px]">
                <span className="text-bright break-all flex-1 min-w-0">{h.host}</span>
                <span className="text-muted shrink-0">{h.count}</span>
                <span className="text-phosphor shrink-0 w-20 text-right">
                  {formatBytes(h.bytes)}
                </span>
                {h.failed > 0 && (
                  <span className="text-danger shrink-0 w-14 text-right">{h.failed} ✗</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {parsed && picked !== null && <EntryDetail parsed={parsed} index={picked} detail={detail} />}

      {!parsed && !err && <p className="text-[12px] text-muted">{l.detailPh}</p>}
    </div>
  )
}

/** 瀑布图：左侧列表 + 右侧按耗时比例画的条；行首可勾选两条送请求对比 */
function WaterfallView({
  rows,
  picked,
  onPick,
  marked,
  onToggleMark,
  markTitle,
  clearMarks,
}: {
  rows: WaterfallRow[]
  picked: number | null
  onPick: (i: number) => void
  marked: number[]
  onToggleMark: (i: number) => void
  markTitle: string
  clearMarks: string
}) {
  const max = Math.max(WATERFALL_SPAN, ...rows.map((r) => r.offset + r.time))
  const markFull = marked.length >= COMPARE_CAP
  return (
    <div className="space-y-0.5">
      {rows.map((r) => {
        const left = (r.offset / max) * 100
        const width = Math.max((r.time / max) * 100, 0.6)
        const markIdx = marked.indexOf(r.index)
        return (
          <div
            key={r.index}
            onClick={() => onPick(r.index)}
            className={`w-full text-left px-1.5 py-1 hover:bg-phosphor-faint transition-colors cursor-pointer ${
              markIdx >= 0 ? 'bg-amber/10' : picked === r.index ? 'bg-phosphor-faint' : ''
            }`}
          >
            <div className="flex items-baseline gap-2 text-[11.5px]">
              {/* 勾选与查看详情互不干扰：点 A/B 徽标或复选框不触发行选 */}
              <span className="shrink-0 w-4 text-center" onClick={(e) => e.stopPropagation()}>
                {markIdx >= 0 ? (
                  <button
                    type="button"
                    onClick={() => onToggleMark(r.index)}
                    title={clearMarks}
                    className="w-4 h-4 inline-flex items-center justify-center text-[10px] font-bold border border-amber/60 text-amber bg-amber/10"
                  >
                    {markIdx === 0 ? 'A' : 'B'}
                  </button>
                ) : (
                  <input
                    type="checkbox"
                    className="accent-amber align-middle"
                    disabled={markFull}
                    title={markFull ? markTitle : undefined}
                    onChange={() => onToggleMark(r.index)}
                  />
                )}
              </span>
              <span className="text-muted w-10 shrink-0">{r.method}</span>
              <span className="text-bright break-all flex-1 min-w-0">{r.url}</span>
              <span
                className={`shrink-0 w-10 text-right ${r.isFailed ? 'text-danger' : 'text-phosphor'}`}
              >
                {r.status || 'ERR'}
              </span>
              <span className="text-muted shrink-0 w-14 text-right tabular-nums">{r.time}ms</span>
            </div>
            <div className="mt-0.5 h-1.5 bg-panel-2 relative">
              <div
                className={`absolute top-0 h-full ${r.isFailed ? 'bg-danger' : 'bg-phosphor'}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 单条请求详情 */
function EntryDetail({
  parsed,
  index,
  detail,
}: {
  parsed: { har: unknown; sum: HarSummary }
  index: number
  detail: ReturnType<typeof extractEntryDetail>
}) {
  const l = useLocalized(harL)
  const e = parsed.sum.entries.find((x) => x.index === index)
  // 详情数据来自归一化条目，但交接要完整头/正文，直接从原始 HAR 按 index 取
  const payload = harEntryToHandoff(parsed.har, index)
  if (!e) return null
  return (
    <div className="space-y-3">
      <Panel
        title={`${l.detail} — ${e.method} ${e.path}`}
        right={payload ? <SendToMenu payload={payload} /> : undefined}
      >
        <div className="space-y-0.5">
          <KV k={l.url} v={e.url} />
          <KV
            k={l.status}
            v={
              <span className={e.isFailed ? 'text-danger' : 'text-phosphor'}>
                {e.status || 'ERR'} {e.statusText}
              </span>
            }
          />
          <KV k={l.mime} v={e.mimeType || '—'} />
          {e.resourceType && <KV k={l.resourceType} v={e.resourceType} />}
          {e.priority && <KV k={l.priority} v={e.priority} />}
          <KV k={l.httpVersion} v={e.httpVersion || '—'} />
          <KV k={l.serverIP} v={e.serverIP || '—'} />
          <KV k={l.bodySize} v={formatBytes(e.bodySize)} />
          <KV k={l.transferSize} v={formatBytes(e.transferSize)} />
          <KV k={l.elapsed} v={`${e.time} ms`} />
          {e.redirectURL && <KV k={l.redirect} v={e.redirectURL} />}
          {e.error && <KV k={l.error} v={<span className="text-danger">{e.error}</span>} />}
        </div>
      </Panel>

      <Collapse title={l.timings}>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {(
            [
              [l.blocked, e.blocked],
              [l.dns, e.dns],
              [l.connect, e.connect],
              [l.ssl, e.ssl],
              [l.send, e.send],
              [l.wait, e.wait],
              [l.receive, e.receive],
            ] as [string, number][]
          ).map(([k, v]) => (
            <Stat key={k} label={k} value={<span className="text-sm tabular-nums">{v}ms</span>} />
          ))}
        </div>
      </Collapse>

      {detail && detail.queryString.length > 0 && (
        <Collapse title={`${l.queryString} (${detail.queryString.length})`}>
          <NvList items={detail.queryString} />
        </Collapse>
      )}

      {detail && detail.requestHeaders.length > 0 && (
        <Collapse title={`${l.requestHeaders} (${detail.requestHeaders.length})`}>
          <NvList items={detail.requestHeaders} />
        </Collapse>
      )}

      {detail && detail.responseHeaders.length > 0 && (
        <Collapse title={`${l.responseHeaders} (${detail.responseHeaders.length})`}>
          <NvList items={detail.responseHeaders} />
        </Collapse>
      )}

      {e.postData && <ResultPanel title={l.requestBody} text={e.postData} maxHeight={200} />}

      {e.body !== null && e.body !== '' ? (
        <ResultPanel
          title={
            e.bodyEncoding === 'base64' ? `${l.responseBody} (${l.base64Note})` : l.responseBody
          }
          text={e.body}
          maxHeight={320}
        />
      ) : (
        <Panel title={l.responseBody}>
          <p className="text-[12px] text-muted">{l.noBody}</p>
        </Panel>
      )}
    </div>
  )
}

function NvList({ items }: { items: { name: string; value: string }[] }) {
  return (
    <div className="space-y-0.5">
      {items.map((it, i) => (
        <div key={`${it.name}-${i}`} className="flex gap-2 text-[11.5px]">
          <span className="text-muted shrink-0 min-w-[120px] break-all">{it.name}</span>
          <span className="text-bright break-all flex-1 min-w-0">{it.value}</span>
        </div>
      ))}
    </div>
  )
}
