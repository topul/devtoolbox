/**
 * 对话设置抽屉：模型清单、工具调用、自定义工具源、高级参数、价格表。
 *
 * 一屏能看见的东西越少，越知道重点在哪 —— 所以除了「模型清单」与「工具调用」，
 * 其余全在折叠区里。
 */
import React, { useState } from 'react'
import { Btn, Collapse, Input, TA } from '../ui'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import {
  DEFAULT_PRICES,
  PRESET_BASE_URLS,
  blankProfile,
  profileName,
  profileReady,
  type ChatSettings,
  type CustomServer,
  type ModelProfile,
} from '../../lib/chat-config'
import type { ModelPrice } from '../../lib/toolkit'

type L = (typeof chatL)['zh']

export function SettingsDrawer({
  open, onClose, profiles, setProfiles, activeId, onActivate, settings, patchSettings,
  servers, setServers, prices, setPrices, toolServerErr,
}: {
  open: boolean
  onClose: () => void
  profiles: ModelProfile[]
  setProfiles: React.Dispatch<React.SetStateAction<ModelProfile[]>>
  activeId: string
  onActivate: (id: string) => void
  settings: ChatSettings
  patchSettings: (p: Partial<ChatSettings>) => void
  servers: CustomServer[]
  setServers: React.Dispatch<React.SetStateAction<CustomServer[]>>
  prices: ModelPrice[]
  setPrices: React.Dispatch<React.SetStateAction<ModelPrice[]>>
  toolServerErr: string
}): React.ReactElement | null {
  const l = useLocalized(chatL)
  const [confirmDel, setConfirmDel] = useState('')
  if (!open) return null

  const editProfile = (id: string, patch: Partial<ModelProfile>): void => {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const addModel = (): void => {
    const p = blankProfile()
    setProfiles((prev) => [...prev, p])
    onActivate(p.id)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-terminal/60" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full sm:w-[480px] border-l border-line bg-panel overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line px-4 py-3 bg-panel">
          <span className="text-[13px] text-phosphor font-semibold tracking-wider">{l.settingsTitle}</span>
          <button onClick={onClose} aria-label={l.closeSettings} className="text-muted hover:text-bright text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-5">
          {/* ---------- 模型清单 ---------- */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.modelsTitle}</h3>
              <Btn variant="ghost" onClick={addModel}>+ {l.addModel}</Btn>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">{l.modelsHint}</p>
            <div className="space-y-2">
              {profiles.map((p) => {
                const on = p.id === activeId
                const ready = profileReady(p)
                return (
                  <div key={p.id} className={`border p-2 space-y-2 ${on ? 'border-phosphor/40 bg-phosphor-faint/20' : 'border-line-soft bg-panel-2'}`}>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={p.label}
                        onChange={(e) => editProfile(p.id, { label: e.target.value })}
                        placeholder={l.modelNamePh}
                        spellCheck={false}
                        className="flex-1 min-w-0 bg-transparent border border-line-soft px-2 py-1 text-[12px] text-bright focus:outline-none focus:border-phosphor/40"
                      />
                      <span className={`shrink-0 text-[10px] px-1.5 border ${ready ? 'text-phosphor border-phosphor/40' : 'text-amber border-amber/40'}`}>
                        {ready ? profileName(p) : l.modelIncomplete}
                      </span>
                      {on
                        ? <span className="shrink-0 text-[10px] px-1.5 border border-phosphor/40 text-phosphor">{l.modelActive}</span>
                        : <button onClick={() => onActivate(p.id)} className="shrink-0 text-[10.5px] text-muted hover:text-phosphor border border-line-soft px-1.5 py-0.5">{l.modelUse}</button>}
                      <button
                        onClick={() => { if (confirmDel === p.id) { setProfiles((prev) => prev.filter((x) => x.id !== p.id)); setConfirmDel('') } else setConfirmDel(p.id) }}
                        title={confirmDel === p.id ? l.confirmDelete : l.removeModel}
                        className={`shrink-0 text-[13px] leading-none px-1 ${confirmDel === p.id ? 'text-danger' : 'text-muted hover:text-danger'}`}
                        aria-label={l.removeModel}
                      >×</button>
                    </div>
                    <Input value={p.baseUrl} onChange={(v) => editProfile(p.id, { baseUrl: v })} placeholder={l.baseUrlPh} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={p.model} onChange={(v) => editProfile(p.id, { model: v })} placeholder={l.modelPh} />
                      <Input value={p.apiKey} onChange={(v) => editProfile(p.id, { apiKey: v })} type="password" placeholder={l.apiKeyPh} />
                    </div>
                    {on && (
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_BASE_URLS.map(([name, url]) => (
                          <button key={name} onClick={() => editProfile(p.id, { baseUrl: url })}
                            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {profiles.length === 0 && <p className="text-[11.5px] text-muted">{l.emptyProfiles}</p>}
            </div>
            <p className="text-[10.5px] text-muted/70 leading-relaxed">{l.apiKeyNote}</p>
          </section>

          {/* ---------- 工具调用 ---------- */}
          <section className="space-y-3 border-t border-line-soft pt-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.toolsEnable}</h3>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={settings.toolsEnabled} onChange={(e) => patchSettings({ toolsEnabled: e.target.checked })} className="accent-phosphor" />
              {l.toolsEnable}
            </label>
            {settings.toolsEnabled && toolServerErr && <p className="text-[11px] text-amber">{toolServerErr}</p>}
            {settings.toolsEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted shrink-0">{l.maxRounds}</span>
                <Input value={settings.maxRounds} onChange={(v) => patchSettings({ maxRounds: v })} />
                <span className="text-[10.5px] text-muted/70 shrink-0">{l.roundsRange}</span>
              </div>
            )}
          </section>

          {/* ---------- 自定义工具源 ---------- */}
          <section className="border-t border-line-soft pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.customServersTitle}</h3>
              <Btn variant="ghost" onClick={() => setServers((p) => [...p, { id: `s${Math.random().toString(36).slice(2, 10)}`, label: '', kind: 'stdio' as const, command: '', args: '', env: '', url: '', headers: '' }])}>
                {l.addServer}
              </Btn>
            </div>
            <p className="text-[11px] text-muted mt-1 leading-relaxed">{l.customServersHint}</p>
            <div className="space-y-2 mt-2">
              {servers.map((sv, i) => (
                <div key={sv.id} className="border border-line-soft bg-panel-2 p-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input value={sv.label} onChange={(e) => setServers((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      placeholder={l.serverLabelPh}
                      className="bg-transparent border border-line-soft px-2 py-1 text-[12px] text-bright flex-1 min-w-0 focus:outline-none focus:border-phosphor/40" />
                    <div className="flex shrink-0">
                      {(['stdio', 'http'] as const).map((k2) => (
                        <button key={k2} onClick={() => setServers((p) => p.map((x, j) => (j === i ? { ...x, kind: k2 } : x)))}
                          className={`px-2 py-1 text-[10.5px] border transition-colors ${sv.kind === k2 ? 'border-phosphor/50 text-phosphor' : 'border-line-soft text-muted hover:text-bright'}`}>
                          {k2 === 'stdio' ? l.serverKindStdio : l.serverKindHttp}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setServers((p) => p.filter((_, j) => j !== i))} title={l.removeServer}
                      className="text-muted hover:text-danger text-[13px] leading-none px-1 shrink-0" aria-label={l.removeServer}>×</button>
                  </div>
                  {sv.kind === 'stdio' ? (
                    <div className="space-y-2">
                      <Input value={sv.command} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, command: v } : x)))} placeholder={l.serverCmdPh} />
                      <TA value={sv.args} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, args: v } : x)))} rows={2} placeholder={l.serverArgsPh} />
                      <TA value={sv.env} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, env: v } : x)))} rows={2} placeholder={l.serverEnvPh} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input value={sv.url} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, url: v } : x)))} placeholder={l.serverUrlPh} />
                      <TA value={sv.headers} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, headers: v } : x)))} rows={2} placeholder={l.serverHeadersPh} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ---------- 高级 ---------- */}
          <section className="border-t border-line-soft pt-4 space-y-3">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.advanced}</h3>
            <TA value={settings.system} onChange={(v) => patchSettings({ system: v })} label={l.system} placeholder={l.systemPh} rows={3} />
            <div className="grid grid-cols-3 gap-2">
              <Input value={settings.temperature} onChange={(v) => patchSettings({ temperature: v })} label={l.temperature} placeholder="0.7" />
              <Input value={settings.maxTokens} onChange={(v) => patchSettings({ maxTokens: v })} label={l.maxTokens} placeholder="—" />
              <Input value={settings.topP} onChange={(v) => patchSettings({ topP: v })} label={l.topP} placeholder="—" />
            </div>
            <Input value={settings.proxy} onChange={(v) => patchSettings({ proxy: v })} label={l.proxy} placeholder={l.proxyPh} />
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={settings.tlsVerify} onChange={(e) => patchSettings({ tlsVerify: e.target.checked })} className="accent-phosphor" />
              {l.tlsVerify}
              <span className="text-[11px] text-muted/70">· {l.tlsVerifyNote}</span>
            </label>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={settings.includeUsage} onChange={(e) => patchSettings({ includeUsage: e.target.checked })} className="accent-phosphor" />
              {l.includeUsage}
              <span className="text-[11px] text-muted/70">· {l.includeUsageNote}</span>
            </label>
            <div>
              <TA value={settings.extraHeaders} onChange={(v) => patchSettings({ extraHeaders: v })} label={l.extraHeaders} placeholder={l.extraHeadersPh} rows={2} />
              <p className="text-[11px] text-muted mt-1">{l.extraHeadersNote}</p>
            </div>
          </section>

          {/* ---------- 价格表 ---------- */}
          <section className="border-t border-line-soft pt-4">
            <PriceTable prices={prices} setPrices={setPrices} l={l} />
          </section>

          <section className="border-t border-line-soft pt-4 pb-8">
            <ul className="text-[11.5px] text-muted space-y-1 list-none">
              {l.hintItems.map((x) => <li key={x}>· {x}</li>)}
            </ul>
          </section>
        </div>
      </aside>
    </>
  )
}

/* ================= 价格表 ================= */

function PriceTable({ prices, setPrices, l }: {
  prices: ModelPrice[]
  setPrices: React.Dispatch<React.SetStateAction<ModelPrice[]>>
  l: L
}): React.ReactElement {
  // 单价要能输小数（如 0.5），所以数字格单独存一份原始输入：
  // 直接 Number(raw)|0 会把「0.」这种中间态吃掉，用户永远打不出小数
  const [draft, setDraft] = useState<Record<string, string>>({})

  const update = (i: number, patch: Partial<ModelPrice>): void => {
    setPrices((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  const numCell = (i: number, field: 'inPerM' | 'outPerM', v: number): React.ReactElement => {
    const k = `${i}:${field}`
    return (
      <input
        value={draft[k] ?? String(v)}
        inputMode="decimal"
        onChange={(e) => {
          const raw = e.target.value
          setDraft((d) => ({ ...d, [k]: raw }))
          const n = Number(raw)
          if (raw.trim() !== '' && Number.isFinite(n)) update(i, { [field]: n })
        }}
        onBlur={() => setDraft((d) => {
          const next = { ...d }
          delete next[k]
          return next
        })}
        className="bg-transparent border border-line-soft px-1.5 py-1 text-[12px] text-phosphor w-full focus:outline-none focus:border-phosphor/40"
      />
    )
  }

  return (
    <Collapse title={l.priceTitle} right={<Btn variant="ghost" onClick={() => setPrices(DEFAULT_PRICES)}>{l.priceReset}</Btn>}>
      <p className="text-[11px] text-muted mb-2">{l.priceNote}</p>
      <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_28px] gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          <span>{l.priceModel}</span>
          <span>{l.priceIn}</span>
          <span>{l.priceOut}</span>
          <span />
        </div>
        {prices.map((p, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_64px_28px] gap-1.5 items-center">
            <input
              value={p.model}
              onChange={(e) => update(i, { model: e.target.value })}
              spellCheck={false}
              className="bg-transparent border border-line-soft px-1.5 py-1 text-[12px] text-bright w-full focus:outline-none focus:border-phosphor/40"
            />
            {numCell(i, 'inPerM', p.inPerM)}
            {numCell(i, 'outPerM', p.outPerM)}
            <button
              onClick={() => setPrices((prev) => prev.filter((_, idx) => idx !== i))}
              title={l.priceRemove}
              className="text-muted hover:text-danger text-[13px] leading-none"
            >×</button>
          </div>
        ))}
        <Btn variant="ghost" onClick={() => setPrices((prev) => [...prev, { model: '', inPerM: 0, outPerM: 0 }])}>{l.priceAdd}</Btn>
      </div>
    </Collapse>
  )
}
