/**
 * 抓包工具的会话页（主战场）—— 过滤条、暂停/跟随、清空、流量列表与详情容器。
 * 从 src/tools/proxy.tsx 拆出：过滤/暂停/跟随等状态仍由主文件持有，
 * 切页签回来不能丢输入与观察状态，所以这里只做展示与回调，不持有状态。
 */
import type { RefObject } from 'react'
import { Panel } from '../components/ui'
import { proxyL } from '../lib/locales/proxy'
import type { ProxySession } from '../lib/proxy-types'
import * as U from '../lib/http-utils'
import { DEFAULT_PORT } from '../lib/proxy-view'
import { SessionDetail } from './proxy-session-detail'

type L = (typeof proxyL)['zh']

export function SessionsTab({
  l,
  sessions,
  filtered,
  selected,
  onSelect,
  filter,
  onFilterChange,
  schemeFilter,
  onSchemeFilterChange,
  follow,
  onToggleFollow,
  paused,
  onTogglePause,
  pendingCount,
  confirmClear,
  onAskClear,
  onClear,
  onCancelClear,
  listRef,
  httpApi,
  proxyPort,
  proxyRunning,
  statePort,
}: {
  l: L
  sessions: ProxySession[]
  filtered: ProxySession[]
  selected: ProxySession | null
  onSelect: (s: ProxySession) => void
  filter: string
  onFilterChange: (v: string) => void
  schemeFilter: 'all' | 'http' | 'https' | 'tunnel'
  onSchemeFilterChange: (v: 'all' | 'http' | 'https' | 'tunnel') => void
  follow: boolean
  onToggleFollow: () => void
  paused: boolean
  onTogglePause: () => void
  pendingCount: number
  confirmClear: boolean
  onAskClear: () => void
  onClear: () => void
  onCancelClear: () => void
  /** React 19 起 useRef<T>(null) 的返回类型带 | null，这里如实接收 */
  listRef: RefObject<HTMLDivElement | null>
  httpApi: NonNullable<Window['electronAPI']>['http'] | undefined
  proxyPort: number
  proxyRunning: boolean
  /** 主文件里可能还是 null（状态未回填）；为 null 时不显示端口引导 */
  statePort: number | null
}) {
  return (
    <Panel
      title={`${l.sessions.title} (${filtered.length}/${sessions.length})`}
      right={
        <span className="text-[11px] text-muted">
          {follow ? l.sessions.follow : l.sessions.notFollowed}
        </span>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={l.sessions.filterPlaceholder}
            className="flex-1 min-w-[180px] bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
          />
          <select
            value={schemeFilter}
            onChange={(e) => onSchemeFilterChange(e.target.value as typeof schemeFilter)}
            className="bg-panel-2 border border-line-soft px-1.5 py-1 text-[11.5px] text-bright"
          >
            <option value="all">{l.sessions.schemeAll}</option>
            <option value="http">http</option>
            <option value="https">https</option>
            <option value="tunnel">tunnel</option>
          </select>
          <button
            onClick={() => onTogglePause()}
            className={`px-2 py-1 text-[11.5px] border transition-colors ${paused ? 'border-amber/60 text-amber bg-amber/5' : 'border-line-soft text-muted hover:text-phosphor'}`}
          >
            {paused ? l.sessions.resume : l.sessions.pause}
          </button>
          <button
            onClick={() => onToggleFollow()}
            className={`px-2 py-1 text-[11.5px] border transition-colors ${follow ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted hover:text-phosphor'}`}
          >
            {follow ? l.sessions.follow : l.sessions.notFollowed}
          </button>

          {confirmClear ? (
            <span className="flex items-center gap-1.5">
              <span className="text-[11.5px] text-danger">
                {l.sessions.clearAsk(sessions.length)}
              </span>
              <button
                onClick={() => onClear()}
                className="px-2 py-1 text-[11.5px] border border-danger/60 text-danger hover:bg-danger/10"
              >
                {l.sessions.confirmYes}
              </button>
              <button
                onClick={() => onCancelClear()}
                className="px-2 py-1 text-[11.5px] border border-line-soft text-muted hover:text-phosphor"
              >
                {l.sessions.cancel}
              </button>
            </span>
          ) : (
            <button
              onClick={() => onAskClear()}
              disabled={sessions.length === 0}
              className="px-2 py-1 text-[11.5px] border border-line-soft text-muted hover:text-danger hover:border-danger/50 disabled:opacity-40"
            >
              {l.sessions.clear}
            </button>
          )}
        </div>

        {paused && (
          <div className="border border-amber/40 bg-amber/5 px-3 py-1.5 text-[11.5px] text-amber">
            {l.sessions.pausedHint(pendingCount)}
          </div>
        )}

        {sessions.length === 0 && (
          <div className="border border-line-soft bg-panel-2 px-3 py-6 text-center">
            <div className="text-[12.5px] text-muted">{l.sessions.empty}</div>
            <div className="text-[11.5px] text-muted/80 mt-1">{l.sessions.emptyHint}</div>
            {statePort !== null && (
              <div className="text-[11.5px] text-muted/80 mt-1">
                {l.errors.manualProxy} 127.0.0.1:{statePort || DEFAULT_PORT}
              </div>
            )}
          </div>
        )}

        <div className="grid min-[1500px]:grid-cols-2 gap-3">
          <div className="border border-line-soft max-h-[560px] overflow-auto" ref={listRef}>
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-panel-2 text-muted">
                <tr>
                  <th className="text-left px-2 py-1 font-normal">{l.sessions.method}</th>
                  <th className="text-left px-2 py-1 font-normal">{l.sessions.host}</th>
                  <th className="text-left px-2 py-1 font-normal">{l.sessions.status}</th>
                  <th className="text-right px-2 py-1 font-normal">{l.sessions.size}</th>
                  <th className="text-right px-2 py-1 font-normal">{l.sessions.duration}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => onSelect(s)}
                    className={`cursor-pointer border-t border-line-soft hover:bg-phosphor-faint ${selected?.id === s.id ? 'bg-phosphor-faint' : ''}`}
                  >
                    <td className="px-2 py-1 text-phosphor whitespace-nowrap">{s.method}</td>
                    <td className="px-2 py-1 text-bright">
                      <div className="truncate max-w-[220px]" title={`${s.host}${s.path}`}>
                        {s.host}
                      </div>
                      <div
                        className="truncate max-w-[220px] text-muted text-[10.5px]"
                        title={s.path}
                      >
                        {s.path}
                      </div>
                    </td>
                    <td className={`px-2 py-1 whitespace-nowrap ${U.statusColorClass(s.status)}`}>
                      {s.status ?? (s.tunneled ? '⇆' : '…')}
                      {s.mocked && <span className="ml-1 text-amber text-[9.5px]">M</span>}
                      {s.blocked && <span className="ml-1 text-danger text-[9.5px]">B</span>}
                      {s.intercepted && <span className="ml-1 text-phosphor text-[9.5px]">P</span>}
                      {s.modified && <span className="ml-1 text-amber text-[9.5px]">✎</span>}
                      {s.tunneled && <span className="ml-1 text-muted text-[9.5px]">T</span>}
                    </td>
                    <td className="px-2 py-1 text-right text-muted whitespace-nowrap">
                      {U.formatBytes(s.resBodyBytes)}
                    </td>
                    <td className="px-2 py-1 text-right text-muted whitespace-nowrap">
                      {U.formatDuration(s.durationMs)}
                      <div className="text-[10px] text-muted/70">{U.formatTime(s.startedAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sessions.length > 0 && filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-muted">
                {l.sessions.noMatch}
              </div>
            )}
          </div>

          <div className="border border-line-soft bg-panel-2 min-h-[200px] max-h-[560px] overflow-auto">
            {selected ? (
              <SessionDetail
                session={selected}
                l={l}
                httpApi={httpApi}
                proxyPort={proxyPort}
                proxyRunning={proxyRunning}
              />
            ) : (
              <div className="px-3 py-6 text-center text-[12px] text-muted">
                {l.sessions.detailHint}
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  )
}
