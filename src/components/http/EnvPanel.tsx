import React from 'react'
import { Btn, Select } from '../ui'
import { KVEditor, newRow, type Row } from './KVEditor'
import { newRowId } from '../../lib/http-utils'
import { httpClientL } from '../../lib/locales/httpclient'

/** 环境：名称 + 变量行。存原文（{{}} 占位符），插值只发生在发送时。 */
export interface HttpEnv {
  id: string
  name: string
  vars: Row[]
}

type L = typeof httpClientL['zh']

/**
 * 环境变量管理抽屉：上面选激活环境，下面管理环境列表。
 * 环境存的是「原文」，插值只发生在发送时——收藏与导出始终带 {{}} 占位符，
 * 避免把 token 等真实值泄漏进导出文件。
 */
export function EnvPanel({ envs, activeId, onActivate, onAdd, onUpdate, onRemove, l }: {
  envs: HttpEnv[]
  activeId: string | null
  onActivate: (id: string | null) => void
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<Omit<HttpEnv, 'id'>>) => void
  onRemove: (id: string) => void
  l: L
}) {
  return (
    <div className="space-y-3">
      <Select
        label={l.envs.active}
        value={activeId ?? ''}
        onChange={(v) => onActivate(v || null)}
        options={[
          { value: '', label: l.envs.none },
          ...envs.map((e) => ({ value: e.id, label: e.name || l.envs.unnamed })),
        ]}
      />
      <div className="text-[11px] text-muted">{l.envs.hint}</div>

      {envs.length === 0 && <div className="text-[12px] text-muted">{l.envs.empty}</div>}

      {envs.map((env) => {
        const varCount = env.vars.filter((v) => v.enabled && v.name.trim()).length
        return (
          <div key={env.id} className="border border-line-soft bg-panel-2 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={env.name}
                onChange={(e) => onUpdate(env.id, { name: e.target.value })}
                placeholder={l.envs.namePlaceholder}
                spellCheck={false}
                className="flex-1 min-w-0 bg-panel border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
              />
              <span className="text-[11px] text-muted shrink-0">
                {varCount > 0 ? l.envs.varCount(varCount) : ''}
              </span>
              <button
                onClick={() => onRemove(env.id)}
                className="shrink-0 text-muted hover:text-danger px-1 text-[13px]"
                title={l.envs.remove}
              >×</button>
            </div>
            <KVEditor
              rows={env.vars}
              onChange={(rows: Row[]) => onUpdate(env.id, { vars: rows })}
              addLabel={l.envs.addVar}
              nameLabel={l.envs.varName}
              valueLabel={l.envs.varValue}
              removeLabel={l.kv.remove}
            />
          </div>
        )
      })}

      <Btn onClick={onAdd}>+ {l.envs.addEnv}</Btn>
    </div>
  )
}

/** 新建一个空环境（给调用方复用，避免 id 生成逻辑散落） */
export function newEnv(): HttpEnv {
  return { id: newRowId(), name: '', vars: [newRow()] }
}
