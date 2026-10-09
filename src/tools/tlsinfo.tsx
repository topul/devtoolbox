import React, { useState } from 'react'
import {
  Btn,
  Input,
  ErrorNote,
  Panel,
  KV,
  ResultPanel,
  useAsyncAction,
  ToolGuide,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { tlsInfoL } from '../lib/locales/tlsinfo'
import type { TlsProbe } from '../lib/tls-types'

/** 已被浏览器弃用的协议版本 */
const WEAK_PROTOCOLS = new Set(['TLSv1', 'TLSv1.1', 'SSLv2', 'SSLv3'])

/**
 * TLS 握手详情。
 *
 * 走 `tls:probe` 主进程通道（node:tls 在渲染层不可用），拿到协商结果与证书链。
 * 与 x509 工具的区别：那个只解析用户贴进来的 PEM，这个自己连一次目标，
 * 因此能看到真实的服务端证书链与协商结果。
 */
export function TlsInfoTool() {
  const l = useLocalized(tlsInfoL)
  const [host, setHost] = useState('example.com')
  const [port, setPort] = useState('443')
  const [result, setResult] = useState<TlsProbe | null>(null)

  const api = typeof window !== 'undefined' ? window.electronAPI?.tls : undefined

  const { busy, run } = useAsyncAction(async () => {
    setResult(null)
    if (!api) return
    const p = Number(port)
    setResult(await api.probe(host.trim(), Number.isFinite(p) ? p : 443, 10000))
  })

  return (
    <div className="space-y-3">
      <ToolGuide title={l.title} steps={[l.sub, l.probe, l.chain]} note={l.note} />

      <div className="grid grid-cols-1 md:grid-cols-[2fr_100px_auto] gap-3 items-end">
        <Input value={host} onChange={setHost} label={l.host} placeholder={l.hostPh} toolInput />
        <Input value={port} onChange={setPort} label={l.port} type="number" />
        <Btn
          variant="primary"
          onClick={() => void run()}
          disabled={busy || !host.trim() || !api}
          aria-busy={busy}
        >
          {busy ? l.probing : l.probe}
        </Btn>
      </div>

      {!api && <ErrorNote msg={l.desktopOnly} />}

      {result && !result.ok && (
        <ErrorNote
          msg={
            l.errors[result.errorCode as keyof typeof l.errors] ??
            `${result.errorCode ?? ''} ${result.errorDetail ?? ''}`.trim()
          }
        />
      )}

      {result && !result.ok && result.errorDetail && (
        <Panel title={l.rawError}>
          <p className="text-[12px] text-muted break-all font-mono">{result.errorDetail}</p>
        </Panel>
      )}

      {result?.ok && (
        <>
          <Panel title={l.handshake}>
            <div className="space-y-0.5">
              <KV
                k={l.protocol}
                v={
                  <span
                    className={WEAK_PROTOCOLS.has(result.protocol) ? 'text-amber' : 'text-phosphor'}
                  >
                    {result.protocol || '—'}
                    {WEAK_PROTOCOLS.has(result.protocol) && ` · ${l.weakProtocol}`}
                  </span>
                }
              />
              <KV
                k={l.cipher}
                v={<span className="text-phosphor break-all">{result.cipher || '—'}</span>}
              />
              {result.cipherSuiteName && <KV k={l.cipherSuite} v={result.cipherSuiteName} />}
              <KV k={l.alpn} v={result.alpn || '—'} />
              <KV k={l.sni} v={result.sni || (result.isIpHost ? '—' : result.host)} />
              <KV
                k={l.authorized}
                v={
                  result.authorized ? (
                    <span className="text-phosphor">{l.trusted}</span>
                  ) : (
                    <span className="text-danger">{l.untrusted}</span>
                  )
                }
              />
              {!result.authorized && result.authorizationError && (
                <KV
                  k={l.authError}
                  v={<span className="text-danger break-all">{result.authorizationError}</span>}
                />
              )}
              <KV k={l.elapsed} v={`${result.elapsedMs} ms`} />
            </div>
          </Panel>

          {result.certs.length === 0 ? (
            <Panel title={l.chain}>
              <p className="text-[12px] text-muted">{l.chainPh}</p>
            </Panel>
          ) : (
            <div className="space-y-2">
              {result.certs.map((c, i) => (
                <CertCard
                  key={`${c.fingerprint256}-${i}`}
                  cert={c}
                  role={i === 0 ? l.leaf : i === result.certs.length - 1 ? l.root : l.intermediate}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CertCard({ cert, role }: { cert: TlsProbe['certs'][number]; role: string }) {
  const l = useLocalized(tlsInfoL)
  // 剩余天数为负 = 已过期；0 = 今天到期。两种都要显眼
  const expired = cert.daysLeft < 0
  const today = cert.daysLeft === 0
  const daysText = expired
    ? l.expired.replace('{n}', String(-cert.daysLeft))
    : today
      ? l.expiresToday
      : l.expiresIn.replace('{n}', String(cert.daysLeft))

  return (
    <Panel
      title={role}
      right={
        <span
          className={`text-[11px] ${expired || today ? 'text-danger' : cert.daysLeft < 30 ? 'text-amber' : 'text-phosphor'}`}
        >
          {daysText}
        </span>
      }
    >
      <div className="space-y-0.5">
        <KV k={l.subject} v={<span className="text-bright break-all">{cert.subject}</span>} />
        <KV k={l.issuer} v={cert.issuer} />
        <KV
          k={l.validity}
          v={`${cert.notBefore.slice(0, 10)} → ${cert.notAfter ? cert.notAfter.slice(0, 10) : '—'}`}
        />
        {cert.domains.length > 0 && (
          <KV k={l.domains} v={<span className="break-all">{cert.domains.join(' · ')}</span>} />
        )}
        <KV k={cert.isCa ? l.isCa : l.notCa} v={cert.pubkeyAlg} />
        {cert.keyBits > 0 && <KV k={l.pubkey} v={l.keyBits.replace('{n}', String(cert.keyBits))} />}
        {cert.sigAlg && <KV k={l.sigAlg} v={cert.sigAlg} />}
        {cert.serial && (
          <KV
            k={l.serial}
            v={<span className="break-all font-mono text-[11px]">{cert.serial}</span>}
          />
        )}
      </div>
      {cert.fingerprint256 && (
        <div className="mt-2">
          <ResultPanel title={l.fingerprint} text={cert.fingerprint256} maxHeight={70} />
        </div>
      )}
    </Panel>
  )
}
