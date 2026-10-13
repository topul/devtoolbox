/**
 * 未配模型的引导页：直接编辑「当前模型」档案的三件套，预设地址一键填。
 * 列表为空时 chat.tsx 会先补一条空档案，保证这里一定有东西可编。
 */
import React from 'react'
import { ErrorNote, Input, Panel } from '../ui'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { PRESET_BASE_URLS, type ModelProfile } from '../../lib/chat-config'

export function OnboardPanel({
  desktop,
  active,
  onPatchProfile,
}: {
  desktop: boolean
  active: ModelProfile | null
  onPatchProfile: (p: Partial<ModelProfile>) => void
}): React.ReactElement {
  const l = useLocalized(chatL)
  return (
    <div className="max-w-[680px] mx-auto fade-in py-8">
      <Panel title={l.onboardTitle}>
        <p className="text-[12.5px] text-muted leading-relaxed mb-4">{l.onboardIntro}</p>
        {!desktop && <ErrorNote msg={l.noDesktop} />}
        <div className="space-y-3">
          <Input
            value={active?.baseUrl ?? ''}
            onChange={(v) => onPatchProfile({ baseUrl: v })}
            label={l.baseUrl}
            placeholder={l.baseUrlPh}
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESET_BASE_URLS.map(([name, url]) => (
              <button
                key={name}
                onClick={() => onPatchProfile({ baseUrl: url })}
                className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors"
              >
                {name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-3">
            <Input
              value={active?.model ?? ''}
              onChange={(v) => onPatchProfile({ model: v })}
              label={l.model}
              placeholder={l.modelPh}
            />
            <Input
              value={active?.apiKey ?? ''}
              onChange={(v) => onPatchProfile({ apiKey: v })}
              label={l.apiKey}
              placeholder={l.apiKeyPh}
              type="password"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted mt-4 leading-relaxed border-t border-line-soft pt-3">
          {l.apiKeyNote} {l.onboardTools}
        </p>
      </Panel>
    </div>
  )
}
