import React, { useState } from 'react'
import {
  Btn,
  CopyBtn,
  ErrorNote,
  Input,
  KV,
  Panel,
  Stat,
  TA,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { jwtcrackL } from '../lib/locales/jwtcrack'
import { jwtAnalyze, jwtForge, jwtSummary, type JwtCrackResult } from '../lib/toolkit'
import { SecNote } from './secnote'

/* JWT 安全分析（弱密钥爆破 / alg=none / 算法混淆）来自 src/lib/toolkit，纯本地计算。 */

/** notes 里的稳定 id → 文案键（语言中立 id，界面负责映射） */
const NOTE_LABEL: Record<
  string,
  'noteAlgNone' | 'noteKidSuspicious' | 'noteJkuPresent' | 'noteX5uPresent' | 'noteWeakKey'
> = {
  'alg=none': 'noteAlgNone',
  'kid-suspicious': 'noteKidSuspicious',
  'jku-present': 'noteJkuPresent',
  'x5u-present': 'noteX5uPresent',
  'weak-key': 'noteWeakKey',
}

const RESULT_CLS = {
  cracked: 'text-danger',
  safe: 'text-phosphor',
} as const

export function JwtCrackTool() {
  const l = useLocalized(jwtcrackL)
  const [token, setToken] = usePersistedState('jwt-crack', 'token', '')
  const [extraKeys, setExtraKeys] = useState('')
  const [result, setResult] = useState<JwtCrackResult | null>(null)
  const [summary, setSummary] = useState<ReturnType<typeof jwtSummary> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const analyze = () => {
    setErr(null)
    setResult(null)
    setSummary(null)
    const t = token.trim()
    if (!t) {
      setErr(l.errEmpty)
      return
    }
    try {
      const extra = extraKeys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
      setResult(jwtAnalyze(t, extra))
      setSummary(jwtSummary(t))
    } catch (e) {
      const msg = (e as Error).message
      setErr(msg === 'BAD_FORMAT' ? l.errFormat : l.errParse + msg)
    }
  }

  return (
    <div className="space-y-3">
      <SecNote scene="jwtcrack" />
      <TA
        value={token}
        onChange={setToken}
        label={l.tokenLabel}
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xxxx"
        rows={4}
      />
      <Input
        value={extraKeys}
        onChange={setExtraKeys}
        label={l.extraKeys}
        placeholder={l.extraKeysPh}
      />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={analyze}>
          {l.analyze}
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            setToken('')
            setExtraKeys('')
            setResult(null)
            setSummary(null)
            setErr(null)
          }}
        >
          {l.clear}
        </Btn>
      </div>
      <ErrorNote msg={err} />

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat
              label={l.statAlg}
              value={<span className="text-sm">{result.alg || l.none}</span>}
            />
            <Stat
              label={l.statSigned}
              value={<span className="text-sm">{result.signed ? l.yes : l.no}</span>}
            />
            <Stat
              label={l.statTried}
              value={<span className="text-sm">{result.triedCount || '—'}</span>}
            />
            <Stat
              label={l.statResult}
              value={
                <span
                  className={`text-sm ${result.crackedKey !== null ? RESULT_CLS.cracked : RESULT_CLS.safe}`}
                >
                  {result.crackedKey !== null
                    ? l.crackedTitle
                    : result.triedCount > 0
                      ? l.notCrackedTitle
                      : '—'}
                </span>
              }
            />
          </div>

          {result.noneAlg && (
            <Panel title={l.noneAlgTitle}>
              <p className="text-[12.5px] text-bright leading-relaxed">{l.noneAlgDesc}</p>
            </Panel>
          )}

          {result.crackedKey !== null && (
            <Panel
              title={l.crackedTitle}
              right={<span className="text-[11px] text-danger">{l.noteWeakKey}</span>}
            >
              <div className="space-y-2">
                <p className="text-[12.5px] text-bright leading-relaxed">{l.crackedDesc}</p>
                <KV
                  k="secret"
                  v={
                    <span className="text-danger">
                      {result.crackedKey === '' ? '""（空密钥）' : result.crackedKey}
                    </span>
                  }
                />
                <ForgeDemo crackedKey={result.crackedKey} alg={result.triedAlgo ?? 'HS256'} />
              </div>
            </Panel>
          )}

          {result.triedCount > 0 && result.crackedKey === null && (
            <Panel title={l.notCrackedTitle}>
              <p className="text-[12.5px] text-bright leading-relaxed">
                {l.notCrackedDesc(result.triedCount)}
              </p>
            </Panel>
          )}

          {result.confusionHint && (
            <Panel title={l.confusionTitle}>
              <p className="text-[12.5px] text-bright leading-relaxed">{l.confusionDesc}</p>
            </Panel>
          )}

          {result.notes.length > 0 && (
            <Panel title={l.notesTitle}>
              <ul className="space-y-1">
                {result.notes.map((n) => {
                  const key = NOTE_LABEL[n]
                  if (!key) return null
                  return (
                    <li key={n} className="flex gap-2 text-[12.5px] text-bright leading-relaxed">
                      <span className="shrink-0 text-amber/70">·</span>
                      <span>{l[key]}</span>
                    </li>
                  )
                })}
              </ul>
            </Panel>
          )}

          {summary && (
            <Panel title={l.summaryTitle}>
              <div className="space-y-0.5">
                <KV k={l.algLabel} v={summary.alg || l.none} />
                {summary.typ && <KV k={l.typLabel} v={summary.typ} />}
                {summary.iss && <KV k={l.issLabel} v={summary.iss} />}
                {summary.sub && <KV k={l.subLabel} v={summary.sub} />}
                {summary.exp && <KV k={l.expLabel} v={summary.exp} />}
              </div>
            </Panel>
          )}

          <p className="text-[11px] text-muted">{l.note}</p>
        </>
      )}
    </div>
  )
}

/** 命中弱密钥后的伪造演示：密钥已泄露，签名能力就没了 */
function ForgeDemo({ crackedKey, alg }: { crackedKey: string; alg: 'HS256' | 'HS384' | 'HS512' }) {
  const l = useLocalized(jwtcrackL)
  const [payload, setPayload] = usePersistedState(
    'jwt-crack',
    'payload',
    '{\n  "sub": "admin",\n  "role": "admin"\n}',
  )
  const [forged, setForged] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = () => {
    setErr(null)
    try {
      JSON.parse(payload)
      setForged(jwtForge(payload, crackedKey, alg))
    } catch {
      setForged(null)
      setErr(l.forgeErr)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-bright leading-relaxed">{l.forgeDesc}</p>
      <TA value={payload} onChange={setPayload} label={l.payloadLabel} rows={4} />
      <Btn onClick={run}>{l.forgeBtn}</Btn>
      <ErrorNote msg={err} />
      {forged && (
        <div className="space-y-1">
          <TA value={forged} readOnly label={l.forgedLabel} rows={3} />
          <CopyBtn text={forged} />
        </div>
      )}
    </div>
  )
}
