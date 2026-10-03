import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn, ResultPanel, ConfirmButton, usePersistedState } from '../components/ui'
import { useLocalized, useI18n } from '../lib/i18n'
import { cryptoL } from '../lib/locales/crypto'
import {
  aesDecrypt,
  aesEncrypt,
  digestAll,
  hmacDigest,
  jwtDecode,
  jwtIsExpired,
  type AesMode,
  type HmacAlgo,
} from '../lib/toolkit'

/* 实现全部来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码。 */

/* ================= Hash ================= */

export function HashTool() {
  const l = useLocalized(cryptoL).hash
  // 持久化：切到别的工具再切回来，输入还在。原来裸 useState，切走就没了 ——
  // 用户第一次遇到会以为工具坏了
  const [input, setInput, { clear }] = usePersistedState('hash', 'input', '')
  const out = useMemo(() => (input ? digestAll(input) : null), [input])
  return (
    <div className="space-y-3">
      {/* 清空会丢掉所有输入，走二次确认。放在 label 行右侧而不是输入框右边：
          靠 items-end 对齐时 TA 有 label，按钮会浮在文本框中部像个孤岛。 */}
      <TA
        value={input}
        onChange={setInput}
        label={l.input}
        placeholder={l.inputPh}
        rows={4}
        toolInput
        labelRight={<ConfirmButton label={l.clear} onConfirm={clear} />}
      />
      {out && (
        <div className="space-y-1.5">
          {out.map(({ label, value }) => (
            <div key={label} className="border border-line-soft bg-panel-2 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
                <div className="text-phosphor text-[12px] break-all">{value}</div>
              </div>
              <CopyBtn text={value} className="shrink-0 self-start" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= HMAC ================= */

export function HmacTool() {
  const l = useLocalized(cryptoL).hmac
  const [input, setInput] = usePersistedState('hmac', 'input', '')
  const [key, setKey] = usePersistedState('hmac', 'key', '')
  const [algo, setAlgo] = usePersistedState<HmacAlgo>('hmac', 'algo', 'SHA256')
  // 原来 catch { return '' }：算不出就静默变空串，用户以为工具没生效。
  // 现在区分「没输入」与「输入了但算不出来」，后者给ErrorNote。
  const out = useMemo(() => {
    if (!input || !key) return { text: '', err: null as string | null }
    try {
      return { text: hmacDigest(algo, input, key), err: null }
    } catch (e) {
      return { text: '', err: (e as Error).message }
    }
  }, [input, key, algo])
  const missing = !input || !key
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="secret" />
        <Select value={algo} onChange={v => setAlgo(v as HmacAlgo)} label={l.algo} options={[
          { value: 'MD5', label: 'HMAC-MD5' }, { value: 'SHA1', label: 'HMAC-SHA1' },
          { value: 'SHA256', label: 'HMAC-SHA256' }, { value: 'SHA512', label: 'HMAC-SHA512' },
        ]} />
      </div>
      <TA value={input} onChange={setInput} label={l.msg} rows={4} toolInput />
      {/* 缺输入时给引导，而不是留一块空白让用户猜 */}
      {missing && <ErrorNote msg={l.needBoth} />}
      {out.err && <ErrorNote msg={out.err} />}
      {!missing && !out.err && <ResultPanel title={l.out} text={out.text} />}
    </div>
  )
}

/* ================= AES ================= */

export function AesTool() {
  const l = useLocalized(cryptoL).aes
  const [input, setInput] = usePersistedState('aes', 'input', '')
  const [key, setKey] = usePersistedState('aes', 'key', '')
  const [mode, setMode] = usePersistedState<AesMode>('aes', 'mode', 'ECB')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const run = (op: 'enc' | 'dec') => {
    setErr(null)
    if (!key) { setErr(l.needKey); return }
    try {
      setOutput(op === 'enc' ? aesEncrypt(input, key, mode) : aesDecrypt(input, key, mode))
    } catch {
      setErr(op === 'enc' ? l.encErr : l.decErr)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="my-secret-key" />
        <Select value={mode} onChange={v => setMode(v as AesMode)} label={l.mode} options={[
          { value: 'ECB', label: 'ECB' }, { value: 'CBC', label: l.cbc },
        ]} />
      </div>
      <TA value={input} onChange={setInput} label={l.io} rows={5} toolInput />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>{l.enc}</Btn>
        <Btn onClick={() => run('dec')}>{l.dec}</Btn>
      </div>
      <ErrorNote msg={err} />
      {/* 结果区给了限高与复制：长密文不再把页面撑开 */}
      <ResultPanel title={l.out} text={output} emptyHint={l.nothingYet} />
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= JWT ================= */

export function JwtTool() {
  const { locale } = useI18n()
  const l = useLocalized(cryptoL).jwt
  const [token, setToken] = usePersistedState('jwt', 'token', '')
  const decoded = useMemo(() => {
    if (!token.trim()) return null
    try {
      const d = jwtDecode(token)
      const p = d.payloadObj
      const loc = locale === 'en' ? 'en-US' : 'zh-CN'
      const extra: [string, string][] = []
      const at = (v: unknown): string => new Date((v as number) * 1000).toLocaleString(loc, { hour12: false })
      if (p.exp) extra.push([l.exp, at(p.exp) + (jwtIsExpired(p) ? l.expired : l.valid)])
      if (p.iat) extra.push([l.iat, at(p.iat)])
      if (p.nbf) extra.push([l.nbf, at(p.nbf)])
      if (p.iss) extra.push([l.iss, String(p.iss)])
      if (p.sub) extra.push([l.sub, String(p.sub)])
      return { header: d.header, payload: d.payload, signature: d.signed ? d.signature : l.noSig, extra }
    } catch (e) {
      const msg = (e as Error).message
      return { error: msg === 'BAD_FORMAT' ? l.errFormat : l.parseErr + msg }
    }
  }, [token, l, locale])

  return (
    <div className="space-y-3">
      <TA value={token} onChange={setToken} label="JWT Token" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xxxx" rows={4} />
      {decoded && 'error' in decoded && <ErrorNote msg={decoded.error!} />}
      {decoded && 'header' in decoded && (
        <div className="space-y-3">
          {decoded.extra!.length > 0 && (
            <Panel title={l.claims}>
              {decoded.extra!.map(([k, v]) => <KV key={k} k={k} v={v} />)}
            </Panel>
          )}
          {/* Header / Payload 原来是无高度上限的 <pre>：payload 几百行会把页面
              撑到几千像素，用户要滚到底才看得到 Signature。ResultPanel 限高 + 给复制 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ResultPanel title="Header" text={decoded.header} maxHeight={240} />
            <ResultPanel title="Payload" text={decoded.payload} maxHeight={240} />
          </div>
          <ResultPanel title="Signature" text={decoded.signature!} maxHeight={120} />
          <p className="text-[11px] text-muted">{l.note}</p>
        </div>
      )}
    </div>
  )
}

/* ================= Hash Type Identifier ================= */

export function HashIdentifyTool() {
  const l = useLocalized(cryptoL).hashId
  const [input, setInput] = usePersistedState('hash-id', 'input', '')
  const results = useMemo(() => {
    const h = input.trim()
    if (!h) return null
    return l.types.filter(t => {
      if (t.len > 0 && h.length !== t.len) return false
      return t.pattern.test(h)
    })
  }, [input, l])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder="5f4dcc3b5aa765d61d8327deb882cf99" rows={3} />
      {results && (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">{l.lenPrefix}{input.trim().length}{l.matchMid}<span className="text-phosphor">{results.length}</span>{l.matchSuffix}</div>
          {results.length === 0 && <ErrorNote msg={l.noMatch} />}
          {results.map(r => (
            <div key={r.name} className="border border-line-soft bg-panel-2 px-3 py-2">
              <div className="text-phosphor text-[13px]">{r.name}</div>
              <div className="text-muted text-[12px]">{r.note}</div>
            </div>
          ))}
        </div>
      )}
      <Panel title={l.crackTitle}>
        <ul className="text-[12px] text-muted space-y-1 list-none">
          {l.crackList.map(x => (
            <li key={x.prefix}><span className={x.danger ? 'text-danger' : 'text-phosphor'}>{x.prefix}</span> {x.text}</li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
