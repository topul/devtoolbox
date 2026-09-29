/**
 * 技能预设（Skill）管理区 —— 设置抽屉里的一节。
 *
 * 自包含：预设清单自己 load/save localStorage，应用走 `patchSettings`
 * 把预设的六个字段覆盖进全局设置。主界面（chat.tsx）不持有预设状态，
 * 因为「应用」之后预设就物化为 settings 的一部分了。
 *
 * 可发现性：预设只保存固定六个字段（散落在抽屉的「工具调用」与「高级」两区），
 * 所以这里必须把范围说清楚 + 保存前实时预览将要捕获的值，
 * 且预览与预设条目摘要共用同一个 `summaryOf`，保证「存什么 → 看到什么」一致。
 */
import React, { useState } from 'react'
import { Btn } from '../ui'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import {
  applySkill,
  blankSkill,
  loadSkills,
  parseAllowList,
  saveSkills,
  type ChatSettings,
  type SkillPreset,
} from '../../lib/chat-config'

type L = (typeof chatL)['zh']

/** 预设内容的参数摘要行（不含提示词）；保存预览与条目摘要共用，格式只写这一遍 */
function summaryOf(s: Pick<SkillPreset, 'temperature' | 'maxTokens' | 'topP' | 'toolAllow' | 'toolsEnabled'>, l: L): string {
  const allowCount = parseAllowList(s.toolAllow).length
  return [
    s.temperature.trim() && `${l.skillTemp} ${s.temperature.trim()}`,
    s.maxTokens.trim() && `${l.skillMaxLabel} ${s.maxTokens.trim()}`,
    s.topP.trim() && `topP ${s.topP.trim()}`,
    s.toolsEnabled ? l.skillToolsOn : l.skillToolsOff,
    allowCount > 0 && l.skillAllowCount(allowCount),
  ].filter(Boolean).join(' · ')
}

export function SkillsSection({ settings, patchSettings }: {
  settings: ChatSettings
  patchSettings: (p: Partial<ChatSettings>) => void
}): React.ReactElement {
  const l = useLocalized(chatL)
  const [skills, setSkills] = useState<SkillPreset[]>(loadSkills)
  const [nameDraft, setNameDraft] = useState('')
  const [appliedId, setAppliedId] = useState('')
  const [confirmDel, setConfirmDel] = useState('')

  const update = (next: SkillPreset[]): void => {
    setSkills(next)
    saveSkills(next)
  }

  const saveCurrent = (): void => {
    const label = nameDraft.trim()
    if (!label) return
    const preset: SkillPreset = {
      ...blankSkill(label),
      system: settings.system,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      topP: settings.topP,
      toolAllow: settings.toolAllow,
      toolsEnabled: settings.toolsEnabled,
    }
    update([...skills, preset])
    setNameDraft('')
  }

  const apply = (p: SkillPreset): void => {
    patchSettings(applySkill(p))
    setAppliedId(p.id)
  }

  const remove = (id: string): void => {
    if (confirmDel !== id) { setConfirmDel(id); return }
    update(skills.filter((s) => s.id !== id))
    setConfirmDel('')
  }

  return (
    <section className="border-t border-line-soft pt-4 space-y-2">
      <h3 className="text-[12px] font-semibold text-bright">{l.skillsTitle}</h3>
      <p className="text-[11.5px] text-muted leading-relaxed">{l.skillsHint}</p>
      <p className="text-[11px] text-muted/80 leading-relaxed">{l.skillScope}</p>

      <div className="flex items-center gap-2">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveCurrent() }}
          placeholder={l.skillNamePh}
          spellCheck={false}
          className="flex-1 min-w-0 bg-panel-2 border border-line-soft rounded-md px-2 py-1.5 text-[12.5px] text-bright focus:outline-none focus:border-phosphor/40"
        />
        <Btn variant="ghost" onClick={saveCurrent} disabled={!nameDraft.trim()}>+ {l.skillSaveAs}</Btn>
      </div>

      {/* 实时快照：当前将捕获的值，与下方预设条目的摘要同格式 */}
      <div className="rounded-lg border border-dashed border-line-soft bg-panel-2/60 px-2 py-1.5 space-y-1">
        <p className="text-[11px] text-muted leading-snug break-all">
          <span className="shrink-0 text-phosphor/80">{l.skillSnapshot}</span>
          {' · '}
          {settings.system.trim()
            ? settings.system.trim().slice(0, 60) + (settings.system.trim().length > 60 ? '…' : '')
            : <span className="opacity-50">{l.skillNoSystem}</span>}
        </p>
        <p className="text-[10.5px] text-muted/80 leading-snug">{summaryOf(settings, l)}</p>
      </div>

      {skills.length === 0 && <p className="text-[11.5px] text-muted">{l.skillEmpty}</p>}
      <div className="space-y-1.5">
        {skills.map((s) => (
          <div key={s.id} className="rounded-lg border border-line-soft bg-panel-2 px-2 py-1.5 space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-[12.5px] text-bright truncate" title={s.label}>{s.label}</span>
              {appliedId === s.id && <span className="shrink-0 text-[10px] text-phosphor">{l.skillApplied}</span>}
              <button
                onClick={() => apply(s)}
                className="shrink-0 text-[10.5px] text-muted hover:text-phosphor border border-line-soft rounded-md px-1.5 py-0.5 transition-colors"
              >{l.skillApply}</button>
              <button
                onClick={() => remove(s.id)}
                title={confirmDel === s.id ? l.skillConfirmDel : l.skillDelete}
                aria-label={l.skillDelete}
                className={`shrink-0 text-[13px] leading-none px-1 ${confirmDel === s.id ? 'text-danger' : 'text-muted hover:text-danger'}`}
              >×</button>
            </div>
            <p className="text-[11px] text-muted leading-snug break-all">
              {s.system.trim() ? s.system.trim().slice(0, 80) + (s.system.trim().length > 80 ? '…' : '') : <span className="opacity-50">{l.skillNoSystem}</span>}
            </p>
            <p className="text-[10.5px] text-muted/80 leading-snug">{summaryOf(s, l)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
