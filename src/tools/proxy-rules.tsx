/**
 * 抓包工具的规则页 —— 规则列表与规则编辑器。
 * 从 src/tools/proxy.tsx 拆出：规则数据的增删改仍由主文件持有，
 * 这里只接收 props 做展示与回调；删规则走行内二次确认（ConfirmButton），不用原生弹窗。
 */
import { useState } from 'react'
import { Panel, Btn, TA, Input, ConfirmButton } from '../components/ui'
import { proxyL } from '../lib/locales/proxy'
import type { HeaderOp, ProxyRule } from '../lib/proxy-types'
import * as U from '../lib/http-utils'

type L = (typeof proxyL)['zh']

export function RulesPanel({
  rules,
  editing,
  l,
  api,
  onNew,
  onEdit,
  onCancel,
  onSave,
  onRemove,
  onToggleAll,
}: {
  rules: ProxyRule[]
  editing: ProxyRule | null
  l: L
  api: NonNullable<Window['electronAPI']>['proxy'] | undefined
  onNew: () => void
  onEdit: (r: ProxyRule) => void
  onCancel: () => void
  onSave: (r: ProxyRule) => void
  onRemove: (id: string) => void
  onToggleAll: (enabled: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const enabledCount = rules.filter((r) => r.enabled).length

  return (
    <Panel
      title={`${l.rules.title} (${enabledCount}/${rules.length})`}
      right={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOpen(!open)}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor"
          >
            {open ? l.misc.close : l.misc.apply}
          </button>
          <button
            onClick={onNew}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor"
            disabled={!api}
          >
            + {l.rules.add}
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {rules.length === 0 && !editing && (
          <div className="text-[12px] text-muted">
            {l.rules.empty} — {l.rules.emptyHint}
          </div>
        )}
        {rules.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <button onClick={() => onToggleAll(true)} className="hover:text-phosphor">
              {l.rules.toggleAll} ✓
            </button>
            <button onClick={() => onToggleAll(false)} className="hover:text-phosphor">
              {l.rules.toggleAll} ✗
            </button>
            <span className="ml-auto">{l.rules.subtitle}</span>
          </div>
        )}

        <div className="divide-y divide-[color:var(--c-line-soft)]">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={() => onSave({ ...r, enabled: !r.enabled })}
                className="accent-[color:var(--c-phosphor)]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-bright truncate">{r.name || r.id}</div>
                <div className="text-[10.5px] text-muted truncate">
                  {r.method !== 'ANY' ? `${r.method} ` : ''}
                  {r.host || '*'} {r.path || '*'}
                  {r.breakpoint && (
                    <span className="text-phosphor ml-1.5">{l.rules.breakpoint}</span>
                  )}
                  {r.block && <span className="text-danger ml-1.5">{l.rules.block}</span>}
                  {r.mock && (
                    <span className="text-amber ml-1.5">
                      {l.rules.mockTitle} {r.mock.status}
                    </span>
                  )}
                  {r.delayMs > 0 && <span className="text-muted ml-1.5">+{r.delayMs}ms</span>}
                </div>
              </div>
              <button
                onClick={() => onEdit(r)}
                className="text-[11px] text-muted hover:text-phosphor px-1"
              >
                {l.rules.edit}
              </button>
              {/* 删规则是不可撤销的走行内二次确认：第一次点变成「确认删除 / 取消」。
                  原来是 window.confirm，与整套自绘风格割裂；且那个「×」没有可读名称。 */}
              <ConfirmButton
                label="×"
                confirmLabel={l.rules.removeConfirm}
                onConfirm={() => onRemove(r.id)}
                className="px-1 text-muted hover:text-danger"
              />
            </div>
          ))}
        </div>

        {open && rules.length > 0 && (
          <div className="border-t border-line-soft pt-2 text-[11px] text-muted">
            {l.rules.hostHint}
          </div>
        )}

        {editing && <RuleEditor rule={editing} l={l} onCancel={onCancel} onSave={onSave} />}
      </div>
    </Panel>
  )
}

function RuleEditor({
  rule,
  l,
  onCancel,
  onSave,
}: {
  rule: ProxyRule
  l: L
  onCancel: () => void
  onSave: (r: ProxyRule) => void
}) {
  const [draft, setDraft] = useState<ProxyRule>(rule)
  const set = (patch: Partial<ProxyRule>): void => setDraft((d) => ({ ...d, ...patch }))

  const preset = (kind: 'cors' | 'mock' | 'break' | 'delay'): void => {
    if (kind === 'cors')
      set({
        name: draft.name || l.rules.presetCors,
        resHeaderOps: [
          ...draft.resHeaderOps.filter(
            (o) => !/^access-control-allow-(origin|methods|headers)$/i.test(o.name),
          ),
          { action: 'set', name: 'Access-Control-Allow-Origin', value: '*' },
          {
            action: 'set',
            name: 'Access-Control-Allow-Methods',
            value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          },
          { action: 'set', name: 'Access-Control-Allow-Headers', value: '*' },
        ],
      })
    if (kind === 'mock')
      set({
        name: draft.name || l.rules.presetMock,
        mock: {
          status: 200,
          headers: [['content-type', 'application/json']],
          bodyText: '{"code":0,"data":{"mocked":true}}',
        },
      })
    if (kind === 'break') set({ name: draft.name || l.rules.presetBreak, breakpoint: true })
    if (kind === 'delay') set({ name: draft.name || l.rules.presetDelay, delayMs: 2000 })
  }

  const opEditor = (key: 'reqHeaderOps' | 'resHeaderOps', title: string) => (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-muted">{title}</div>
      {(draft[key] ?? []).map((op, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={op.action}
            onChange={(e) =>
              set({
                [key]: draft[key].map((x, xi) =>
                  xi === i ? { ...x, action: e.target.value as HeaderOp['action'] } : x,
                ),
              } as Partial<ProxyRule>)
            }
            className="bg-panel-2 border border-line-soft px-1 py-0.5 text-[11px] text-bright"
          >
            <option value="set">{l.rules.opSet}</option>
            <option value="add">{l.rules.opAdd}</option>
            <option value="remove">{l.rules.opRemove}</option>
          </select>
          <input
            value={op.name}
            onChange={(e) =>
              set({
                [key]: draft[key].map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)),
              } as Partial<ProxyRule>)
            }
            placeholder={l.rules.headerName}
            className="w-40 bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[11px] text-bright"
          />
          {op.action !== 'remove' && (
            <input
              value={op.value ?? ''}
              onChange={(e) =>
                set({
                  [key]: draft[key].map((x, xi) =>
                    xi === i ? { ...x, value: e.target.value } : x,
                  ),
                } as Partial<ProxyRule>)
              }
              placeholder={l.rules.headerValue}
              className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[11px] text-bright"
            />
          )}
          <button
            onClick={() =>
              set({ [key]: draft[key].filter((_, xi) => xi !== i) } as Partial<ProxyRule>)
            }
            className="text-muted hover:text-danger px-1"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          set({
            [key]: [...draft[key], { action: 'set', name: '', value: '' }],
          } as Partial<ProxyRule>)
        }
        className="text-[11px] text-muted hover:text-phosphor"
      >
        + {l.rules.addOp}
      </button>
    </div>
  )

  return (
    <div className="border border-phosphor/30 bg-phosphor-faint/40 p-3 space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Input
          label={l.rules.name}
          value={draft.name}
          onChange={(v) => set({ name: v })}
          placeholder={l.rules.namePlaceholder}
        />
        <Input
          label={l.rules.host}
          value={draft.host}
          onChange={(v) => set({ host: v })}
          placeholder={l.rules.hostPlaceholder}
        />
        <Input
          label={l.rules.path}
          value={draft.path}
          onChange={(v) => set({ path: v })}
          placeholder={l.rules.pathPlaceholder}
        />
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted uppercase tracking-wider">
              {l.rules.method}
            </span>
            <select
              value={draft.method}
              onChange={(e) => set({ method: e.target.value })}
              className="bg-panel-2 border border-line-soft px-2 py-1.5 text-[12px] text-bright"
            >
              {['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => (
                <option key={m} value={m}>
                  {m === 'ANY' ? l.rules.any : m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted uppercase tracking-wider">
              {l.rules.scheme}
            </span>
            <select
              value={draft.scheme}
              onChange={(e) => set({ scheme: e.target.value as ProxyRule['scheme'] })}
              className="bg-panel-2 border border-line-soft px-2 py-1.5 text-[12px] text-bright"
            >
              <option value="any">{l.rules.any}</option>
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </div>
          <Input
            label={l.rules.delay}
            value={String(draft.delayMs)}
            onChange={(v) => set({ delayMs: Number(v.replace(/\D/g, '')) || 0 })}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[11px] text-muted self-center">{l.rules.presets}:</span>
        {(['cors', 'mock', 'break', 'delay'] as const).map((k) => (
          <button
            key={k}
            onClick={() => preset(k)}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40"
          >
            {k === 'cors'
              ? l.rules.presetCors
              : k === 'mock'
                ? l.rules.presetMock
                : k === 'break'
                  ? l.rules.presetBreak
                  : l.rules.presetDelay}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-[12px]">
        <label className="flex items-center gap-1.5 text-bright cursor-pointer">
          <input
            type="checkbox"
            checked={draft.breakpoint}
            onChange={(e) => set({ breakpoint: e.target.checked })}
            className="accent-[color:var(--c-phosphor)]"
          />
          {l.rules.breakpoint}
        </label>
        <label className="flex items-center gap-1.5 text-bright cursor-pointer">
          <input
            type="checkbox"
            checked={draft.block}
            onChange={(e) => set({ block: e.target.checked })}
            className="accent-[color:var(--c-phosphor)]"
          />
          {l.rules.block}
        </label>
        <label className="flex items-center gap-1.5 text-bright cursor-pointer">
          <input
            type="checkbox"
            checked={!!draft.mock}
            onChange={(e) =>
              set({
                mock: e.target.checked
                  ? { status: 200, headers: [['content-type', 'application/json']], bodyText: '{}' }
                  : null,
              })
            }
            className="accent-[color:var(--c-phosphor)]"
          />
          {l.rules.mockEnabled}
        </label>
      </div>

      {draft.mock && (
        <div className="space-y-2 border border-line-soft p-2">
          <div className="grid sm:grid-cols-4 gap-2">
            <Input
              label={l.rules.mockStatus}
              value={String(draft.mock.status)}
              onChange={(v) =>
                set({ mock: { ...draft.mock!, status: Number(v.replace(/\D/g, '')) || 200 } })
              }
            />
            <div className="sm:col-span-3">
              <Input
                label="Content-Type"
                value={U.headerValueOf(draft.mock.headers, 'content-type') ?? ''}
                onChange={(v) =>
                  set({
                    mock: {
                      ...draft.mock!,
                      headers: [
                        ['content-type', v],
                        ...draft.mock!.headers.filter(([k]) => k.toLowerCase() !== 'content-type'),
                      ],
                    },
                  })
                }
              />
            </div>
          </div>
          <TA
            label={l.rules.mockBody}
            rows={4}
            value={draft.mock.bodyText ?? ''}
            onChange={(v) => set({ mock: { ...draft.mock!, bodyText: v } })}
          />
        </div>
      )}

      {opEditor('reqHeaderOps', l.rules.reqHeaders)}
      {opEditor('resHeaderOps', l.rules.resHeaders)}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">{l.rules.reqBody}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={l.rules.find}
              value={draft.reqBodyFind ?? ''}
              onChange={(v) => set({ reqBodyFind: v })}
            />
            <Input
              label={l.rules.replace}
              value={draft.reqBodyReplace ?? ''}
              onChange={(v) => set({ reqBodyReplace: v })}
            />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer">
            <input
              type="checkbox"
              checked={!!draft.reqBodyRegex}
              onChange={(e) => set({ reqBodyRegex: e.target.checked })}
              className="accent-[color:var(--c-phosphor)]"
            />
            {l.rules.regex}
          </label>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">{l.rules.resBody}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={l.rules.find}
              value={draft.resBodyFind ?? ''}
              onChange={(v) => set({ resBodyFind: v })}
            />
            <Input
              label={l.rules.replace}
              value={draft.resBodyReplace ?? ''}
              onChange={(v) => set({ resBodyReplace: v })}
            />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer">
            <input
              type="checkbox"
              checked={!!draft.resBodyRegex}
              onChange={(e) => set({ resBodyRegex: e.target.checked })}
              className="accent-[color:var(--c-phosphor)]"
            />
            {l.rules.regex}
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => onSave(draft)}>
          {l.rules.save}
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>
          {l.rules.cancel}
        </Btn>
      </div>
    </div>
  )
}
