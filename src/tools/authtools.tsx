/**
 * JWT 签名器与 TOTP —— 两个「认证类」工具。
 *
 * 放一起是因为输入形态很像（都是一段密钥 + 参数），界面上也共用一套布局。
 * 算法实现在 src/lib/toolkit（jwt-sign.ts / totp.ts），与 MCP 服务端共用同一份。
 *
 * 注意：这里的输入态都走 `usePersistedState` —— 调试到一半切去看别的工具是常事，
 * 回来发现密钥没了很影响心流。
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Btn, ErrorNote, Input, Panel, Select, TA, ToolShell,
  usePersistedState, PersistHint, CopyBtn,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { authToolsL } from '../lib/locales/authtools'
import {
  JWT_SIGN_ALGOS,
  JWT_ALGO_LABELS,
  JWT_TTL_PRESETS,
  jwtSign,
  jwtVerify,
  jwtExpIn,
  type JwtSignAlgo,
} from '../lib/toolkit/jwt-sign'
import {
  totp,
  totpRemaining,
  parseOtpauth,
  decodeSecret,
  type OtpauthMeta,
} from '../lib/toolkit/totp'

type TotpAlgo = 'SHA1' | 'SHA256' | 'SHA512'
type TotpOpts = { digits: number; period: number; algo: TotpAlgo }
/** TOTP 那一组词条（zh/en 两个分支形状一致，取中文分支的类型即可） */
type TotpLabels = typeof authToolsL.zh.totp

/* ================= JWT 签名器 ================= */

export function JwtSignTool() {
  const l = useLocalized(authToolsL).jwtSign
  const [algo, setAlgo, algoMeta] = usePersistedState<JwtSignAlgo>('jwt-sign', 'algo', 'HS256')
  const [secret, setSecret, secretMeta] = usePersistedState('jwt-sign', 'secret', 'secret')
  const [payload, setPayload, payloadMeta] = usePersistedState(
    'jwt-sign', 'payload',
    '{\n  "sub": "1234567890",\n  "name": "Ada",\n  "iat": 1700000000\n}',
  )
  const [ttl, setTtl] = useState('8h')
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [verifyMsg, setVerifyMsg] = useState<{ valid: boolean; text: string } | null>(null)

  // payload 解析失败不该阻断输入 —— 用户正在打字，中间态本来就不是合法 JSON。
  // 所以只在「点签名 / 点校验」时才把解析结果当错误报出来。
  const parsed = useMemo((): { obj: Record<string, unknown> | null; bad: boolean } => {
    const text = payload.trim()
    if (!text) return { obj: null, bad: false }
    try {
      const v: unknown = JSON.parse(text)
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { obj: null, bad: true }
      return { obj: v as Record<string, unknown>, bad: false }
    } catch {
      return { obj: null, bad: true }
    }
  }, [payload])

  const sign = useCallback(async (): Promise<void> => {
    setErr(null)
    setVerifyMsg(null)
    if (!parsed.obj) { setErr(l.payloadErr); return }
    const body = { ...parsed.obj }
    // exp 按相对时间重算：粘来的旧 payload 里的 exp 早就过期了
    const preset = JWT_TTL_PRESETS.find((p) => p.key === ttl)
    if (preset) body.exp = jwtExpIn(preset.seconds)
    try {
      const r = await jwtSign(algo, body, secret)
      setToken(r.token)
    } catch (e) {
      setErr(`${l.signErr}: ${(e as Error).message}`)
    }
  }, [algo, parsed.obj, secret, ttl, l])

  const verify = useCallback(async (): Promise<void> => {
    setVerifyMsg(null)
    if (!token) return
    if (algo === 'none') {
      // none 没有可验的签名，直说而不是显示「失败」让人以为签错了
      setVerifyMsg({ valid: false, text: `${l.verifyFail} · ${l.reason.NO_SIG}` })
      return
    }
    const r = await jwtVerify(token, secret, algo)
    setVerifyMsg({ valid: r.valid, text: r.valid ? l.verifyOk : `${l.verifyFail} · ${l.reason[r.reason]}` })
  }, [token, secret, algo, l])

  const isNone = algo === 'none'

  return (
    <ToolShell toolId="jwt-sign" onSubmit={() => { void sign() }}>
      {(algoMeta.persisted && secretMeta.persisted && payloadMeta.persisted) ? null : (
        <PersistHint persisted={false} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select
          value={algo}
          onChange={(v) => { setAlgo(v as JwtSignAlgo); setToken(''); setVerifyMsg(null) }}
          label={l.algo}
          options={JWT_SIGN_ALGOS.map((a) => ({ value: a, label: JWT_ALGO_LABELS[a] }))}
        />
        <Input
          value={secret}
          onChange={setSecret}
          label={l.key}
          type={isNone ? 'text' : 'password'}
          placeholder={isNone ? l.keyNoneHint : l.keyPh}
          className={isNone ? 'opacity-50' : ''}
        />
        {isNone && <p className="md:col-span-2 text-[12px] text-amber leading-relaxed">{l.algoNoneHint}</p>}
      </div>

      <Select
        value={ttl}
        onChange={setTtl}
        label={l.ttl}
        options={JWT_TTL_PRESETS.map((p) => ({ value: p.key, label: l[p.ttlKey] }))}
      />

      <TA
        toolInput
        value={payload}
        onChange={setPayload}
        label={l.payload}
        placeholder={l.payloadPh}
        rows={7}
      />

      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => { void sign() }}>{l.sign}</Btn>
        {token && !isNone && <Btn onClick={() => { void verify() }}>{l.verify}</Btn>}
      </div>

      <ErrorNote msg={err} />

      {token && (
        <Panel title={l.token} right={<span className="text-[11px] text-muted">{token.length} chars</span>}>
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0 font-mono text-[12px] text-phosphor break-all">{token}</div>
            <CopyBtn text={token} className="shrink-0" />
          </div>
        </Panel>
      )}

      {verifyMsg && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2 text-[12.5px] ${
            verifyMsg.valid
              ? 'border-phosphor/40 bg-phosphor-faint/40 text-bright'
              : 'border-danger/35 bg-danger/10 text-danger'
          }`}
        >
          {verifyMsg.text}
        </div>
      )}

      <Note text={l.note} />
    </ToolShell>
  )
}

/* ================= TOTP ================= */

export function TotpTool() {
  const l = useLocalized(authToolsL).totp
  const [raw, setRaw, rawMeta] = usePersistedState('totp', 'secret', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  const [digits, setDigits] = usePersistedState('totp', 'digits', '6')
  const [period, setPeriod] = usePersistedState('totp', 'period', '30')
  const [algo, setAlgo] = usePersistedState('totp', 'algo', 'SHA1')

  /**
   * 输入框里可以直接粘 otpauth:// 整条链接 —— 粘进来就解析参数并覆盖下面的选项，
   * 省得手动填四个字段。解析不出来（非 URL）就当普通密钥处理。
   */
  const parsed = useMemo((): { secret: string; meta: OtpauthMeta | null; bad: boolean } => {
    const text = raw.trim()
    if (!text.startsWith('otpauth:')) return { secret: text, meta: null, bad: false }
    try {
      const m = parseOtpauth(text)
      return { secret: m.secret, meta: m, bad: false }
    } catch {
      return { secret: '', meta: null, bad: true }
    }
  }, [raw])

  // otpauth 里的参数优先于下拉框（用户粘的链接才是权威来源）
  const opts: TotpOpts = useMemo(() => ({
    digits: parsed.meta?.digits ?? (Number(digits) || 6),
    period: parsed.meta?.period ?? (Number(period) || 30),
    algo: (parsed.meta?.algo ?? algo) as TotpAlgo,
  }), [parsed.meta, digits, period, algo])

  // 密钥是否可用：不合法时立刻告诉用户，别让他盯着空白的验证码猜
  const secretErr = useMemo((): string | null => {
    if (parsed.bad) return l.errNotUrl
    if (!parsed.secret) return raw.trim() ? l.errBadSecret : null
    try {
      decodeSecret(parsed.secret)
      return null
    } catch {
      return l.errBadSecret
    }
  }, [parsed, raw, l])

  return (
    <ToolShell toolId="totp">
      <PersistHint persisted={rawMeta.persisted} />
      <Input
        toolInput
        value={raw}
        onChange={setRaw}
        label={l.secret}
        placeholder={l.secretPh}
      />
      <p className="-mt-1 text-[11.5px] text-muted">{l.secretHint}</p>

      {parsed.meta && (parsed.meta.issuer || parsed.meta.account) && (
        <div className="rounded-lg border border-phosphor/30 bg-phosphor-faint/30 px-3 py-2 text-[12px] text-bright">
          {l.parseFromUrl}
          {parsed.meta.issuer && <span className="text-muted"> · {parsed.meta.issuer}</span>}
          {parsed.meta.account && <span className="text-muted"> · {parsed.meta.account}</span>}
        </div>
      )}

      <ErrorNote msg={secretErr} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Select
          value={String(opts.digits)}
          onChange={setDigits}
          label={l.digits}
          options={['6', '7', '8'].map((d) => ({ value: d, label: d }))}
        />
        <Select
          value={String(opts.period)}
          onChange={setPeriod}
          label={l.period}
          options={['30', '60', '90'].map((d) => ({ value: d, label: d }))}
        />
        <Select
          value={opts.algo}
          onChange={setAlgo}
          label={l.algo}
          options={['SHA1', 'SHA256', 'SHA512'].map((a) => ({ value: a, label: a }))}
        />
      </div>

      <LiveCode secret={parsed.secret} opts={opts} l={l} />

      <Note text={l.note} />
    </ToolShell>
  )
}

/**
 * 验证码显示区。
 *
 * 每 500ms 重算一次（不用 1s：验证码在整点边界切换，1s 的刷新会让人偶尔看到已经过期的码）。
 * WebCrypto 是异步的，所以这里用 state + effect 而不是 useMemo —— 
 * 「密码学组件里不要在 render 期间发起异步计算」是硬规则，否则会打爆 React。
 */
function LiveCode({ secret, opts, l }: {
  secret: string
  opts: TotpOpts
  /** 词条由调用方从 useLocalized 取好后传进来 —— hook 不能在子组件里按需调用取值 */
  l: TotpLabels
}) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [code, setCode] = useState('')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!secret) { setCode(''); return }
    let alive = true
    void totp(secret, now, opts)
      .then((c) => { if (alive) setCode(c) })
      .catch(() => { if (alive) setCode('') })
    return () => { alive = false }
  }, [secret, now, opts])

  if (!secret) return null
  const remaining = totpRemaining(now, opts.period)
  const pct = Math.max(0, Math.min(100, (remaining / opts.period) * 100))
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-widest text-muted">{l.code}</span>
        <span className="text-[11px] text-muted">{l.remaining} {remaining}s</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="font-mono text-3xl font-semibold text-phosphor tabular-nums tracking-wider">
          {code || '·'.repeat(opts.digits)}
        </div>
        {code && <CopyBtn text={code} />}
      </div>
      {/* 进度条比「剩余 N 秒」更直观：扫一眼就知道该不该马上用完 */}
      <div className="mt-2 h-1 rounded-full bg-line overflow-hidden">
        <div
          className={`h-full transition-[width] duration-500 ${pct > 30 ? 'bg-phosphor' : 'bg-amber'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** 统一的说明块：文案里的 ** 是本地化标记（避免整段被当成加粗），渲染时去掉 */
function Note({ text }: { text: string }) {
  const body = text.replace(/\*\*/g, '')
  const title = body.split(/[。，.]/)[0]
  return (
    <Panel title={title}>
      <p className="text-[12px] text-muted leading-relaxed">{body}</p>
    </Panel>
  )
}