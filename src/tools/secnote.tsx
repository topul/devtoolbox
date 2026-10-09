import React from 'react'
import { Collapse } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { secnoteL } from '../lib/locales/secnote'

/**
 * 安全类工具顶部的「场景说明」：默认收起，说明这个工具在什么场景下解决什么问题。
 * 收起来是因为一屏里能看见的东西越少，越知道重点在哪；点开是给第一次用的人。
 */
export function SecNote({ scene }: { scene: keyof typeof secnoteL.zh }) {
  const l = useLocalized(secnoteL)[scene]
  return (
    <Collapse title={l.title} hint={l.hint}>
      <div className="space-y-2">
        <p className="text-[13px] text-bright leading-relaxed">{l.what}</p>
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted mb-1">
            {l.scenesTitle}
          </div>
          <ul className="space-y-1">
            {l.scenes.map((s, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] text-bright leading-relaxed">
                <span className="shrink-0 text-phosphor/70">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-amber leading-relaxed">
          <span aria-hidden>⚠ </span>
          {l.caution}
        </p>
      </div>
    </Collapse>
  )
}
