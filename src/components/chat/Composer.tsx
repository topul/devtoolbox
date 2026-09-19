/**
 * 输入区：工具栏（模型切换 / 工具开关状态）+ 输入框 + 动作行。
 *
 * 模型切换器从顶栏搬到这里，是因为「换模型」和「发消息」是同一个动作的两半 ——
 * 放在光标旁边，改完立刻能发；顶栏留给会话标题与状态提示。
 *
 * 键盘：Enter 发送、Shift+Enter 换行。**必须避开输入法组词中的 Enter**
 * （中文输入法里按 Enter 是选中候选词，此时发送会把人逼疯）。
 */
import React, { useState } from 'react'
import { Btn } from '../ui'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { profileName, shortHost, type ModelProfile } from '../../lib/chat-config'
import { formatMoney } from '../../lib/toolkit'

type L = (typeof chatL)['zh']

export function Composer({
  input, onInput, onSend, onStop, streaming, profiles, activeId, onPickProfile,
  onManageModels, onAddProfile, estimate, cost, roundInfo, toolCount, disabled,
}: {
  input: string
  onInput: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  profiles: ModelProfile[]
  activeId: string
  onPickProfile: (id: string) => void
  onManageModels: () => void
  onAddProfile: () => void
  /** 发出前按字符估算的 token（±20%） */
  estimate: number
  /** 上一轮费用；算不出来为 null */
  cost: number | null
  roundInfo: { round: number; max: number } | null
  toolCount: number
  disabled: boolean
}): React.ReactElement {
  const l = useLocalized(chatL)

  const keyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return
    // 组词中的 Enter 属于输入法，不是「发送」
    if (e.nativeEvent.isComposing) return
    if (e.shiftKey && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    if (!disabled && !streaming && input.trim()) onSend()
  }

  return (
    <div className="border border-line-soft bg-panel-2/40 focus-within:border-phosphor/40 transition-colors">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-wrap border-b border-line-soft px-2 py-1">
        <ModelMenu
          profiles={profiles}
          activeId={activeId}
          onPick={onPickProfile}
          onManage={onManageModels}
          onAdd={onAddProfile}
          l={l}
        />
        <span className="flex-1" />
        {toolCount > 0 && <span className="text-[10.5px] text-muted">{l.toolsGranted.replace('{n}', String(toolCount))}</span>}
        {streaming && roundInfo && roundInfo.round > 1 && (
          <span className="text-[10.5px] text-amber">
            {l.roundLabel.replace('{a}', String(roundInfo.round)).replace('{b}', String(roundInfo.max))}
          </span>
        )}
      </div>

      <textarea
        value={input}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={keyDown}
        rows={3}
        spellCheck={false}
        placeholder={l.inputPh}
        className="w-full resize-y bg-transparent px-2.5 py-2 text-[12.5px] leading-relaxed text-bright placeholder:text-muted/50 focus:outline-none"
      />

      <div className="flex items-center gap-3 flex-wrap border-t border-line-soft px-2 py-1.5">
        {streaming
          ? <Btn onClick={onStop}>{l.stop}</Btn>
          : <Btn variant="primary" onClick={onSend} disabled={disabled || !input.trim()}>{l.send}</Btn>}
        <span className="text-[11px] text-muted">{l.preflight.replace('{n}', estimate.toLocaleString())}</span>
        {cost !== null && <span className="text-[11px] text-muted/70">{l.lastCost} {formatMoney(cost)}</span>}
      </div>
    </div>
  )
}

/* ================= 模型切换 ================= */

function ModelMenu({ profiles, activeId, onPick, onManage, onAdd, l }: {
  profiles: ModelProfile[]
  activeId: string
  onPick: (id: string) => void
  onManage: () => void
  onAdd: () => void
  l: L
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const active = profiles.find((p) => p.id === activeId) ?? null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={l.modelsTitle}
        className="flex items-center gap-1.5 px-1.5 py-0.5 border border-line-soft text-[11.5px] text-bright hover:border-phosphor/40 max-w-[280px] sm:max-w-[360px] transition-colors"
      >
        <span className="text-phosphor shrink-0">◆</span>
        <span className="truncate">{active ? profileName(active) : l.pickModel}</span>
        {active && (
          <span className="text-muted/60 text-[10px] truncate hidden md:inline">@ {shortHost(active.baseUrl)}</span>
        )}
        <span className="text-muted/60 text-[9px] shrink-0">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-1 z-50 w-[320px] border border-line bg-panel shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <div className="px-3 py-1.5 text-[9.5px] uppercase tracking-[0.2em] text-muted/60 border-b border-line-soft">
              {l.modelsTitle}
            </div>
            {profiles.length === 0 && <div className="px-3 py-3 text-[11.5px] text-muted">{l.emptyProfiles}</div>}
            {profiles.map((p) => {
              const on = p.id === activeId
              return (
                <button
                  key={p.id}
                  onClick={() => { onPick(p.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 border-b border-line-soft last:border-0 text-[12px] transition-colors ${on ? 'bg-phosphor-faint text-phosphor' : 'text-bright hover:bg-phosphor-faint'}`}
                >
                  <div className="truncate">{profileName(p)}</div>
                  <div className="text-[10px] text-muted truncate">{p.model} · {shortHost(p.baseUrl)}</div>
                </button>
              )
            })}
            <div className="flex items-center border-t border-line-soft">
              <button onClick={() => { onAdd(); setOpen(false) }} className="flex-1 text-left px-3 py-2 text-[11.5px] text-phosphor hover:bg-phosphor-faint">
                + {l.addModel}
              </button>
              <button onClick={() => { onManage(); setOpen(false) }} className="flex-1 text-right px-3 py-2 text-[11.5px] text-muted hover:text-phosphor">
                {l.manageModels}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
