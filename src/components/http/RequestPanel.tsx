/**
 * HTTP 客户端的请求配置面板：params / headers / body / auth / options 五个页签。
 *
 * 从 src/tools/httpclient.tsx 拆出的纯展示组件——不持有状态，全部由主组件
 * 传入（setter 保持 React 原生 Dispatch 签名，功能式更新照常可用）。
 */
import type { Dispatch, SetStateAction } from 'react'
import { Btn, Input, Panel, Select, TA } from '../ui'
import { KVEditor, type Row } from './KVEditor'
import * as U from '../../lib/http-utils'
import {
  row,
  type AuthState,
  type AuthType,
  type BodyMode,
  type L,
  type OptState,
  type PickedFile,
  type Tab,
} from '../../lib/httpclient-model'

function PresetBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors"
    >
      {label}
    </button>
  )
}

/** 勾选项：options 页签与主组件的代理抽屉共用 */
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-bright cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[color:var(--c-phosphor)]"
      />
      {label}
    </label>
  )
}

export function RequestPanel({
  l,
  tab,
  setTab,
  params,
  onParamsChange,
  headers,
  setHeaders,
  bodyMode,
  setBodyMode,
  bodyRaw,
  setBodyRaw,
  fields,
  setFields,
  auth,
  setAuth,
  options,
  setOptions,
  authHeaders,
  contentType,
  filePick,
  setFilePick,
  pickBodyFile,
  fileFields,
  setFileFields,
  fileFieldData,
  setFileFieldData,
  pickFieldFile,
}: {
  l: L
  tab: Tab
  setTab: (t: Tab) => void
  params: Row[]
  onParamsChange: (next: Row[]) => void
  headers: Row[]
  setHeaders: Dispatch<SetStateAction<Row[]>>
  bodyMode: BodyMode
  setBodyMode: Dispatch<SetStateAction<BodyMode>>
  bodyRaw: string
  setBodyRaw: Dispatch<SetStateAction<string>>
  fields: Row[]
  setFields: Dispatch<SetStateAction<Row[]>>
  auth: AuthState
  setAuth: Dispatch<SetStateAction<AuthState>>
  options: OptState
  setOptions: Dispatch<SetStateAction<OptState>>
  authHeaders: [string, string][]
  contentType: string | null
  filePick: PickedFile | null
  setFilePick: Dispatch<SetStateAction<PickedFile | null>>
  pickBodyFile: () => void
  fileFields: { id: string; name: string }[]
  setFileFields: Dispatch<SetStateAction<{ id: string; name: string }[]>>
  fileFieldData: Record<string, PickedFile>
  setFileFieldData: Dispatch<SetStateAction<Record<string, PickedFile>>>
  pickFieldFile: (rowId: string) => void
}) {
  return (
    <Panel
      title={l.tabs[tab]}
      right={
        <div className="flex gap-1">
          {(['params', 'headers', 'body', 'auth', 'options'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 text-[11px] border transition-colors ${tab === t ? 'border-phosphor/60 text-phosphor bg-phosphor-faint' : 'border-line-soft text-muted hover:text-phosphor'}`}
            >
              {l.tabs[t]}
              {t === 'headers' && headers.filter((h) => h.enabled && h.name).length > 0 && (
                <span className="ml-1 text-phosphor/70">
                  {headers.filter((h) => h.enabled && h.name).length}
                </span>
              )}
              {t === 'params' && params.length > 0 && (
                <span className="ml-1 text-phosphor/70">{params.length}</span>
              )}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'params' && (
        <div className="space-y-2">
          <div className="text-[11px] text-muted">{l.params.hint}</div>
          <KVEditor
            rows={params}
            onChange={onParamsChange}
            addLabel={l.kv.add}
            nameLabel={l.kv.name}
            valueLabel={l.kv.value}
            removeLabel={l.kv.remove}
          />
        </div>
      )}

      {tab === 'headers' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-muted self-center">{l.headers.presets}:</span>
            <PresetBtn
              label={l.headers.presetJson}
              onClick={() =>
                setHeaders((h) => [
                  ...h,
                  row('Content-Type', 'application/json'),
                  row('Accept', 'application/json'),
                ])
              }
            />
            <PresetBtn
              label={l.headers.presetForm}
              onClick={() =>
                setHeaders((h) => [...h, row('Content-Type', 'application/x-www-form-urlencoded')])
              }
            />
            <PresetBtn
              label={l.headers.presetBrowser}
              onClick={() =>
                setHeaders((h) => [
                  ...h,
                  row(
                    'User-Agent',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                  ),
                ])
              }
            />
            <PresetBtn
              label={l.headers.presetNoCache}
              onClick={() =>
                setHeaders((h) => [
                  ...h,
                  row('Cache-Control', 'no-cache'),
                  row('Pragma', 'no-cache'),
                ])
              }
            />
            <PresetBtn
              label={l.headers.presetCors}
              onClick={() =>
                setHeaders((h) => [
                  ...h,
                  row('Origin', 'https://example.com'),
                  row('Access-Control-Request-Method', 'POST'),
                ])
              }
            />
            <PresetBtn
              label={l.headers.presetAuth}
              onClick={() => setHeaders((h) => [...h, row('Authorization', 'Bearer YOUR_TOKEN')])}
            />
          </div>
          <KVEditor
            rows={headers}
            onChange={setHeaders}
            addLabel={l.kv.add}
            nameLabel={l.kv.name}
            valueLabel={l.kv.value}
            removeLabel={l.kv.remove}
            headerSuggest
          />
          <div className="text-[11px] text-muted">{l.headers.hint}</div>
        </div>
      )}

      {tab === 'body' && (
        <div className="space-y-2">
          <Select
            label={l.body.mode}
            value={bodyMode}
            onChange={(v) => setBodyMode(v as BodyMode)}
            options={[
              { value: 'none', label: l.body.none },
              { value: 'json', label: l.body.json },
              { value: 'xml', label: l.body.xml },
              { value: 'text', label: l.body.text },
              { value: 'html', label: l.body.html },
              { value: 'javascript', label: l.body.javascript },
              { value: 'form', label: l.body.form },
              { value: 'multipart', label: l.body.multipart },
              { value: 'binary', label: l.body.binary },
            ]}
          />
          {(bodyMode === 'form' || bodyMode === 'multipart') && (
            <KVEditor
              rows={fields}
              onChange={setFields}
              addLabel={l.kv.add}
              nameLabel={l.kv.name}
              valueLabel={l.kv.value}
              removeLabel={l.kv.remove}
            />
          )}
          {bodyMode === 'binary' && (
            <div className="space-y-2">
              {filePick ? (
                <div className="flex items-center gap-2 border border-line-soft bg-panel-2 px-3 py-2 text-[12px]">
                  <span className="text-phosphor break-all">{filePick.name}</span>
                  <span className="text-muted shrink-0">{U.formatBytes(filePick.bytes)}</span>
                  <button
                    onClick={() => setFilePick(null)}
                    className="ml-auto text-muted hover:text-danger px-1"
                    title={l.body.clearFile}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="text-[11.5px] text-muted">{l.body.noFile}</div>
              )}
              <Btn variant="ghost" onClick={pickBodyFile}>
                {filePick ? l.body.replaceFile : l.body.pickFile}
              </Btn>
              {filePick && (
                <div className="text-[11px] text-muted">
                  {l.body.contentType}:{' '}
                  <span className="text-phosphor">{filePick.contentType}</span> ·{' '}
                  {l.body.fileNotPersisted}
                </div>
              )}
            </div>
          )}
          {bodyMode === 'multipart' && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted">{l.body.fileFieldsTitle}</div>
              {fileFields.length === 0 && <div className="text-[11.5px] text-muted">—</div>}
              {fileFields.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5">
                  <input
                    value={f.name}
                    onChange={(e) =>
                      setFileFields((rows) =>
                        rows.map((r) => (r.id === f.id ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    placeholder={l.kv.name}
                    spellCheck={false}
                    className="w-1/3 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
                  />
                  <span className="flex-1 min-w-0 text-[12px] text-dim truncate">
                    {fileFieldData[f.id]
                      ? `${fileFieldData[f.id].name} · ${U.formatBytes(fileFieldData[f.id].bytes)}`
                      : l.body.noFile}
                  </span>
                  <Btn variant="ghost" onClick={() => pickFieldFile(f.id)}>
                    {l.body.pickFile}
                  </Btn>
                  <button
                    onClick={() => {
                      setFileFields((rows) => rows.filter((r) => r.id !== f.id))
                      setFileFieldData((m) => {
                        const next = { ...m }
                        delete next[f.id]
                        return next
                      })
                    }}
                    className="shrink-0 text-muted hover:text-danger px-1.5 text-[13px]"
                    title={l.kv.remove}
                  >
                    ×
                  </button>
                </div>
              ))}
              <Btn
                variant="ghost"
                onClick={() => setFileFields((rows) => [...rows, { id: U.newRowId(), name: '' }])}
              >
                + {l.body.addFileField}
              </Btn>
            </div>
          )}
          {bodyMode !== 'none' &&
            bodyMode !== 'form' &&
            bodyMode !== 'multipart' &&
            bodyMode !== 'binary' && (
              <>
                <TA
                  value={bodyRaw}
                  onChange={setBodyRaw}
                  label={l.body.mode}
                  rows={10}
                  placeholder={l.body.placeholder}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Btn variant="ghost" onClick={() => setBodyRaw((v) => U.prettyJson(v) ?? v)}>
                    {l.body.beautify}
                  </Btn>
                  {bodyRaw.trim() && bodyMode === 'json' && !U.prettyJson(bodyRaw) && (
                    <span className="text-[11px] text-amber">{l.body.badJson}</span>
                  )}
                  <span className="text-[11px] text-muted">
                    {l.body.byteNote(new TextEncoder().encode(bodyRaw).length)}
                  </span>
                </div>
              </>
            )}
          {bodyMode === 'multipart' && (
            <div className="text-[11px] text-muted">{l.body.fileNote}</div>
          )}
          {contentType && (
            <div className="text-[11px] text-muted">
              {l.body.contentType}: <span className="text-phosphor">{contentType}</span>
            </div>
          )}
        </div>
      )}

      {tab === 'auth' && (
        <div className="space-y-2">
          <Select
            label={l.auth.type}
            value={auth.type}
            onChange={(v) => setAuth((a) => ({ ...a, type: v as AuthType }))}
            options={[
              { value: 'none', label: l.auth.none },
              { value: 'basic', label: l.auth.basic },
              { value: 'bearer', label: l.auth.bearer },
              { value: 'apikey', label: l.auth.apiKey },
            ]}
          />
          {auth.type === 'basic' && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Input
                label={l.auth.username}
                value={auth.username}
                onChange={(v) => setAuth((a) => ({ ...a, username: v }))}
              />
              <Input
                label={l.auth.password}
                value={auth.password}
                onChange={(v) => setAuth((a) => ({ ...a, password: v }))}
                type="password"
              />
            </div>
          )}
          {auth.type === 'bearer' && (
            <Input
              label={l.auth.token}
              value={auth.token}
              onChange={(v) => setAuth((a) => ({ ...a, token: v }))}
            />
          )}
          {auth.type === 'apikey' && (
            <div className="grid sm:grid-cols-3 gap-2">
              <Input
                label={l.auth.headerName}
                value={auth.headerName}
                onChange={(v) => setAuth((a) => ({ ...a, headerName: v }))}
              />
              <Input
                label={l.auth.headerPrefix}
                value={auth.headerPrefix}
                onChange={(v) => setAuth((a) => ({ ...a, headerPrefix: v }))}
                placeholder="Bearer "
              />
              <Input
                label={l.auth.token}
                value={auth.token}
                onChange={(v) => setAuth((a) => ({ ...a, token: v }))}
              />
            </div>
          )}
          {authHeaders.length > 0 && (
            <div className="border border-line-soft bg-panel-2 px-3 py-2 space-y-1">
              <div className="text-[11px] text-muted">{l.auth.generatedNote}</div>
              {authHeaders.map(([k, v]) => (
                <div key={k} className="text-[12px] break-all">
                  <span className="text-phosphor">{k}</span>
                  <span className="text-muted">: </span>
                  <span className="text-bright">
                    {k.toLowerCase() === 'authorization' ? v.replace(/^(\w+ ).*/, '$1••••••') : v}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'options' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label={l.options.timeout}
              value={String(options.timeout)}
              onChange={(v) =>
                setOptions((o) => ({ ...o, timeout: Number(v.replace(/\D/g, '')) || 0 }))
              }
            />
            <Input
              label={l.options.maxRedirects}
              value={String(options.maxRedirects)}
              onChange={(v) =>
                setOptions((o) => ({ ...o, maxRedirects: Number(v.replace(/\D/g, '')) || 0 }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Check
              label={l.options.followRedirects}
              checked={options.follow}
              onChange={(v) => setOptions((o) => ({ ...o, follow: v }))}
            />
            <Check
              label={l.options.verifyTls}
              checked={options.verifyTls}
              onChange={(v) => setOptions((o) => ({ ...o, verifyTls: v }))}
            />
          </div>
          {!options.verifyTls && <div className="text-[11px] text-amber">{l.options.tlsNote}</div>}
        </div>
      )}
    </Panel>
  )
}
