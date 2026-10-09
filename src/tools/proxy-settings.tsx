/**
 * 抓包工具的设置页 —— 端口 / HTTPS 解密 / 系统代理 / 根证书入口 / 数据导出。
 * 从 src/tools/proxy.tsx 拆出：系统代理的启停结果都以主进程回报为准，
 * 根证书面板（CaPanel）仍定义在主文件里，这里通过 caPanel 节点插槽原位渲染。
 */
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Panel, Btn, Input } from '../components/ui'
import { proxyL } from '../lib/locales/proxy'
import type { ProxyState } from '../lib/proxy-types'

type L = (typeof proxyL)['zh']

export function SettingsTab({
  l,
  api,
  busy,
  setBusy,
  state,
  setState,
  portInput,
  setPortInput,
  running,
  toggleMitm,
  isMac,
  onError,
  onNotice,
  onExport,
  sessionCount,
  caPanel,
}: {
  l: L
  api: NonNullable<Window['electronAPI']>['proxy'] | undefined
  busy: boolean
  setBusy: (b: boolean) => void
  state: ProxyState | null
  setState: Dispatch<SetStateAction<ProxyState | null>>
  portInput: string
  setPortInput: (v: string) => void
  running: boolean
  toggleMitm: (mitm: boolean) => Promise<void>
  isMac: boolean
  onError: (m: string | null) => void
  onNotice: (m: string | null) => void
  onExport: (format: 'json' | 'har') => Promise<void>
  sessionCount: number
  caPanel: ReactNode
}) {
  return (
    <div className="space-y-3">
      <Panel title={l.settings.captureTitle}>
        <div className="grid min-[1300px]:grid-cols-2 gap-x-6 gap-y-3">
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="w-24">
                <Input label={l.controls.portLabel} value={portInput} onChange={setPortInput} />
              </div>
              <span className="text-[11px] text-muted pb-1.5">
                {running ? l.settings.portLocked : l.controls.portHint}
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-[12.5px] text-bright cursor-pointer select-none">
              <input
                type="checkbox"
                checked={state?.mitm ?? true}
                onChange={(e) => void toggleMitm(e.target.checked)}
                className="accent-[color:var(--c-phosphor)]"
              />
              {l.controls.mitmLabel}
            </label>
            <div className="text-[11.5px] text-muted">{l.controls.mitmHint}</div>
            {running && (state?.mitm ?? false) && (
              <div className="border border-amber/40 bg-amber/5 px-3 py-2 text-[11.5px] text-amber">
                {l.controls.mitmTrustWarn}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted">{l.system.title}</div>
            <div className="flex flex-wrap items-center gap-2">
              {state?.systemProxy.enabled && state.systemProxy.managed ? (
                <Btn
                  variant="danger"
                  disabled={!api || busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const s = await api?.systemRestore()
                      if (!s) return
                      setState((p) => (p ? { ...p, systemProxy: s } : p))
                      // 还原结果以主进程回报为准：取消授权 / 失败都不能报成功
                      if (s.enabled) onError(s.detail || l.errors.systemFailed)
                      else onNotice(s.detail || l.system.disabled)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {l.system.disable}
                </Btn>
              ) : (
                <Btn
                  disabled={!api || !running || busy}
                  onClick={async () => {
                    onError(null)
                    setBusy(true)
                    try {
                      const s = await api?.systemSet()
                      if (!s) return
                      setState((p) => (p ? { ...p, systemProxy: s } : p))
                      // 只有主进程确认系统代理真的指向本机时才提示成功
                      if (s.enabled && s.managed) onNotice(`${l.system.done} · ${s.server}`)
                      else onError(s.detail || l.errors.systemFailed)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {l.system.enable}
                </Btn>
              )}
              <span
                className={`text-[11.5px] ${state?.systemProxy.enabled ? 'text-phosphor' : 'text-muted'}`}
              >
                {state?.systemProxy.enabled
                  ? `${l.system.enabled} · ${state.systemProxy.server}`
                  : l.system.disabled}
              </span>
            </div>
            <div className="text-[11px] text-muted">{l.system.hint}</div>
            {isMac && <div className="text-[11px] text-amber">{l.system.authHint}</div>}
            {state?.systemProxy.detail && (
              <div className="text-[11px] text-muted">{state.systemProxy.detail}</div>
            )}
            {state?.systemProxy.enabled && state.systemProxy.managed && (
              <div className="text-[11px] text-amber">{l.system.restoreTip}</div>
            )}
            {state && !state.systemProxy.supported && (
              <div className="text-[11px] text-amber">{l.errors.systemUnsupported}</div>
            )}
          </div>
        </div>
      </Panel>

      {/* 根证书 */}
      {caPanel}

      <Panel title={l.settings.dataTitle}>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => void onExport('json')} disabled={!api || sessionCount === 0}>
            {l.controls.exportJson}
          </Btn>
          <Btn onClick={() => void onExport('har')} disabled={!api || sessionCount === 0}>
            {l.controls.exportHar}
          </Btn>
          <span className="text-[11.5px] text-muted">
            {l.status.sessions}: {sessionCount}
          </span>
        </div>
      </Panel>
    </div>
  )
}
