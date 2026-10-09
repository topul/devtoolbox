import React from 'react'
import { Btn } from '../ui'
import { newRowId } from '../../lib/http-utils'

/** KV 行：参数 / 请求头 / 表单字段 / 环境变量共用 */
export interface Row {
  id: string
  name: string
  value: string
  enabled: boolean
}

export function newRow(): Row {
  return { id: newRowId(), name: '', value: '', enabled: true }
}

const HEADER_NAMES = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Requested-With',
  'X-Forwarded-For',
  'X-API-Key',
  'If-None-Match',
  'If-Modified-Since',
  'Range',
]

function HeaderSuggestList() {
  return (
    <datalist id="http-header-names">
      {HEADER_NAMES.map((h) => (
        <option key={h} value={h} />
      ))}
    </datalist>
  )
}

export function KVEditor({
  rows,
  onChange,
  addLabel,
  nameLabel,
  valueLabel,
  removeLabel,
  headerSuggest,
}: {
  rows: Row[]
  onChange: (rows: Row[]) => void
  addLabel: string
  nameLabel: string
  valueLabel: string
  removeLabel: string
  headerSuggest?: boolean
}) {
  const update = (id: string, patch: Partial<Row>): void =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-1.5">
      {rows.length === 0 && <div className="text-[11.5px] text-muted">—</div>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            className="shrink-0 accent-[color:var(--c-phosphor)]"
          />
          <input
            value={r.name}
            onChange={(e) => update(r.id, { name: e.target.value })}
            placeholder={nameLabel}
            spellCheck={false}
            list={headerSuggest ? 'http-header-names' : undefined}
            className="w-1/3 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
          />
          <input
            value={r.value}
            onChange={(e) => update(r.id, { value: e.target.value })}
            placeholder={valueLabel}
            spellCheck={false}
            className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
          />
          <button
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
            className="shrink-0 text-muted hover:text-danger px-1.5 text-[13px]"
            title={removeLabel}
          >
            ×
          </button>
        </div>
      ))}
      <Btn variant="ghost" onClick={() => onChange([...rows, newRow()])}>
        + {addLabel}
      </Btn>
      {headerSuggest && <HeaderSuggestList />}
    </div>
  )
}
