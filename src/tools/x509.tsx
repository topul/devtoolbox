import React, { useState } from 'react'
import { Btn, CopyBtn, ErrorNote, KV, Panel, Stat, TA, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { x509L } from '../lib/locales/x509'
import { certDnString, parseCertificatePem, type CertInfo } from '../lib/toolkit'
import { SecNote } from './secnote'

/* X.509 解析实现来自 src/lib/toolkit（DER 解析器），本地纯函数、不发请求。 */

/** 本地生成的 EC P-256 自签名测试证书（仅用于演示解析） */
const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----
MIIBzzCCAXWgAwIBAgIUVCqhps/v9hrZvJHNH9+2WMZ4mCUwCgYIKoZIzj0EAwIw
KTEXMBUGA1UEAwwOZWMuZXhhbXBsZS5jb20xDjAMBgNVBAoMBUVDT3JnMB4XDTI2
MTAwMTIyNTkzMFoXDTI3MTAwMTIyNTkzMFowKTEXMBUGA1UEAwwOZWMuZXhhbXBs
ZS5jb20xDjAMBgNVBAoMBUVDT3JnMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
VfZwPhMcQrFabmgcUmDJtdAcKKGmkHu0vsKmo29k01datduUTCC8wmP7p95q7QSB
ME73vVp7USmZ7xf8JEUhuKN7MHkwHQYDVR0OBBYEFFUSgxknOo07d80QKNfSF1qW
XygTMB8GA1UdIwQYMBaAFFUSgxknOo07d80QKNfSF1qWXygTMBkGA1UdEQQSMBCC
DmVjLmV4YW1wbGUuY29tMA4GA1UdDwEB/wQEAwIFoDAMBgNVHRMBAf8EAjAAMAoG
CCqGSM49BAMCA0gAMEUCIQC1W1AmWOvf8hsyUxUdilxWhYJZxl74TBTsOM9faL9W
TwIgIpoSfQQmbkhiJhwinVjdOgT9ZE/C2gk87RNn/xMvmr0=
-----END CERTIFICATE-----`

const STATUS_CLS = {
  statusValid: 'text-phosphor',
  statusExpired: 'text-danger',
  statusNotYet: 'text-amber',
} as const

function statusKey(info: CertInfo['validity']): 'statusValid' | 'statusExpired' | 'statusNotYet' {
  if (info.expired) return 'statusExpired'
  if (info.notYetValid) return 'statusNotYet'
  return 'statusValid'
}

export function X509Tool() {
  const l = useLocalized(x509L)
  const [pem, setPem] = usePersistedState('x509', 'data', '')
  const [info, setInfo] = useState<CertInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const parse = () => {
    setErr(null)
    setInfo(null)
    if (!pem.trim()) return
    try {
      setInfo(parseCertificatePem(pem))
    } catch (e) {
      const msg = (e as Error).message
      setErr(msg === 'NO_PEM_CERTIFICATE' ? l.errNoPem : l.errParse + msg)
    }
  }

  return (
    <div className="space-y-3">
      <SecNote scene="x509" />
      <TA value={pem} onChange={setPem} label={l.pemLabel} rows={7} placeholder="-----BEGIN CERTIFICATE-----" />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={parse}>{l.parse}</Btn>
        <Btn variant="ghost" onClick={() => setPem(SAMPLE_CERT)}>{l.sample}</Btn>
        <Btn variant="ghost" onClick={() => { setPem(''); setInfo(null); setErr(null) }}>{l.clear}</Btn>
      </div>
      <ErrorNote msg={err} />

      {info && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat
              label={l.validity}
              value={<span className={`text-sm ${STATUS_CLS[statusKey(info.validity)]}`}>
                {l[statusKey(info.validity)]}
              </span>}
            />
            <Stat label={l.pubKey} value={<span className="text-sm">{info.publicKey.algorithm}</span>} />
            <Stat
              label={l.keySize}
              value={<span className="text-sm">{info.publicKey.keySize ? `${info.publicKey.keySize} bit` : info.publicKey.curve ?? '—'}</span>}
            />
            <Stat label={l.isCa} value={<span className="text-sm">{info.isCa === null ? '—' : info.isCa ? l.yes : l.no}</span>} />
          </div>

          <Panel title={l.subject}>
            <div className="space-y-0.5">
              <KV k={l.subject} v={<span className="break-all">{certDnString(info.subject)}</span>} />
              <KV k={l.issuer} v={<span className="break-all">{certDnString(info.issuer)}</span>} />
              <KV k={l.serial} v={info.serialNumber} />
              <KV k={l.version} v={`v${info.version}`} />
              <KV k={l.sigAlg} v={info.signatureAlgorithm} />
            </div>
          </Panel>

          <Panel title={l.validity}>
            <div className="space-y-0.5">
              <KV k={l.notBefore} v={info.notBefore} />
              <KV k={l.notAfter} v={info.notAfter} />
            </div>
          </Panel>

          <Panel title={l.fpSha256} right={<CopyBtn text={info.fingerprints.sha256} label={l.copyFp} />}>
            <div className="space-y-0.5">
              <KV k="SHA-256" v={<span className="text-phosphor break-all">{info.fingerprints.sha256}</span>} />
              <KV k="SHA-1" v={<span className="break-all">{info.fingerprints.sha1}</span>} />
            </div>
          </Panel>

          <Panel title={l.san}>
            {info.san.length === 0 ? (
              <p className="text-[12.5px] text-muted">{l.noSan}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {info.san.map((s, i) => (
                  <span key={`${i}-${s.value}`} className="px-2 py-0.5 text-[12px] font-mono border border-line-soft bg-panel-2 text-bright">
                    <span className="text-muted mr-1">{s.kind}:</span>{s.value}
                  </span>
                ))}
              </div>
            )}
          </Panel>

          {(info.isCa !== null || info.keyUsage.length > 0) && (
            <Panel title={l.keyUsage}>
              <div className="space-y-0.5">
                {info.pathLen !== null && <KV k={l.pathLen} v={info.pathLen === 0 ? '0' : info.pathLen === null ? l.unlimited : String(info.pathLen)} />}
                {info.keyUsage.length > 0 && <KV k={l.keyUsage} v={info.keyUsage.join(', ')} />}
              </div>
            </Panel>
          )}

          <p className="text-[11px] text-muted">{l.note} · {l.derSize}: {info.derSize} B</p>
        </>
      )}
    </div>
  )
}
