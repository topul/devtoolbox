/**
 * 自签证书 / CSR 生成器 —— 本地开发与内网测试用的 X.509 工厂。
 *
 * 设计取舍：RSA 2048/4096 生成约需 1-3 秒（4096 更久），是整个工具箱里
 * 少数真正需要 loading 态 + 按钮禁用的同步密集操作，走 useAsyncAction 防重入。
 * 私钥结果只放 useState 不进持久化 —— 落盘的私钥迟早变成 Shares take-off 的
 * 安全事故，宁可让用户重填表单也要保住「私钥不出会话」这条线。
 */
import React, { useCallback, useMemo, useState } from 'react'
import {
  Btn,
  ErrorNote,
  Input,
  KV,
  Panel,
  ResultPanel,
  Select,
  TA,
  ToolShell,
  useAsyncAction,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import {
  generateCsr,
  generateSelfSigned,
  parsePemSummary,
  type CertGenOptions,
} from '../lib/toolkit/certgen'

const L = {
  zh: {
    modeSelfSigned: '自签证书',
    modeCsr: 'CSR（待签）',
    cn: 'Common Name（CN）',
    cnPh: 'localhost 或域名，如 api.example.local',
    sans: 'SAN（每行一条，域名或 IP）',
    sansPh: 'localhost\n127.0.0.1\n*.dev.local',
    org: 'O（组织，可选）',
    ou: 'OU（部门，可选）',
    country: 'C（国家代码，可选）',
    days: '有效天数',
    bits: '密钥位数',
    gen: '生成',
    genBusy: '生成中…',
    genHint: '2048 位约需 1-3 秒，4096 更久',
    errGen: '生成失败：请检查输入（国家代码一般为两位字母，CN 不能为空）',
    certPemTitle: '证书 PEM',
    csrPemTitle: 'CSR PEM',
    keyPemTitle: '私钥 PEM',
    keyWarning: '私钥只显示一次且不落盘，请立即保存到安全位置',
    summary: '证书摘要',
    subject: '主题',
    notAfter: '有效期至',
    noteTitle: '安全说明',
    note: "**安全说明**：密钥与证书全部在本机生成，私钥不出本机、不写盘。自签证书只用于本地开发与内网测试，浏览器会提示不受信任 —— 信任方式：macOS 双击 .crt 导入钥匙串并设为「始终信任」；Linux 放入 /usr/local/share/ca-certificates/ 后执行 update-ca-certificates。生产环境请走正规 CA（含 Let's Encrypt）签发，CSR 模式就是为此准备的。",
  },
  en: {
    modeSelfSigned: 'Self-signed cert',
    modeCsr: 'CSR (to be signed)',
    cn: 'Common Name (CN)',
    cnPh: 'localhost or a domain, e.g. api.example.local',
    sans: 'SAN (one per line, domain or IP)',
    sansPh: 'localhost\n127.0.0.1\n*.dev.local',
    org: 'O (organization, optional)',
    ou: 'OU (unit, optional)',
    country: 'C (country code, optional)',
    days: 'Validity (days)',
    bits: 'Key size',
    gen: 'Generate',
    genBusy: 'Generating…',
    genHint: '2048-bit takes ~1-3s; 4096 takes longer',
    errGen:
      'Generation failed: check the input (country code should be two letters; CN is required)',
    certPemTitle: 'Certificate PEM',
    csrPemTitle: 'CSR PEM',
    keyPemTitle: 'Private key PEM',
    keyWarning: 'The private key is shown once and never persisted — save it somewhere safe now',
    summary: 'Certificate summary',
    subject: 'Subject',
    notAfter: 'Valid until',
    noteTitle: 'Security notes',
    note: '**Security notes**: keys and certificates are generated entirely on this machine; the private key never leaves your device or touches disk. Self-signed certs are for local development and intranet testing only — browsers will warn they are untrusted. To trust one: macOS double-click the .crt into Keychain and set "Always Trust"; on Linux drop it into /usr/local/share/ca-certificates/ and run update-ca-certificates. For production use a real CA (Let\'s Encrypt works too) — that is what the CSR mode is for.',
  },
}

const BITS_OPTIONS = [
  { value: '2048', label: '2048' },
  { value: '4096', label: '4096' },
]

type GenMode = 'selfsigned' | 'csr'

interface GenOutput {
  keyPem: string
  certPem?: string
  csrPem?: string
}

export function CertGenTool() {
  const l = useLocalized(L)
  const [mode, setMode] = usePersistedState('certgen', 'mode', 'selfsigned')
  const [cn, setCn] = usePersistedState('certgen', 'cn', '')
  const [sans, setSans] = usePersistedState('certgen', 'sans', '')
  const [org, setOrg] = usePersistedState('certgen', 'org', '')
  const [ou, setOu] = usePersistedState('certgen', 'ou', '')
  const [country, setCountry] = usePersistedState('certgen', 'country', '')
  const [days, setDays] = usePersistedState('certgen', 'days', '825')
  const [bits, setBits] = usePersistedState('certgen', 'bits', '2048')

  // 结果不进持久化：私钥永不落盘
  const [result, setResult] = useState<GenOutput | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const switchMode = (m: GenMode) => {
    setMode(m)
    setResult(null)
    setErr(null)
  }

  const doGenerate = useCallback(async () => {
    setErr(null)
    setResult(null)
    try {
      const opts: CertGenOptions = {
        commonName: cn.trim(),
        altNames: sans
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        days: Math.max(1, parseInt(days, 10) || 825),
        keyBits: bits === '4096' ? 4096 : 2048,
        subject: {
          O: org.trim() || undefined,
          OU: ou.trim() || undefined,
          C: country.trim() || undefined,
        },
      }
      setResult(mode === 'csr' ? await generateCsr(opts) : await generateSelfSigned(opts))
    } catch {
      setErr(l.errGen)
    }
  }, [cn, sans, org, ou, country, days, bits, mode, l.errGen])

  const { busy, run } = useAsyncAction(doGenerate)

  // CSR 没有 notAfter，parsePemSummary 对 CSR 返回 null，自然不显示摘要行
  const summary = useMemo(
    () => (result?.certPem ? parsePemSummary(result.certPem) : null),
    [result],
  )

  return (
    <ToolShell toolId="certgen">
      <Panel title={l.modeSelfSigned + ' / ' + l.modeCsr}>
        <div className="flex flex-col gap-3">
          {/* 模式切换：选中态用 primary 高亮 */}
          <div className="flex gap-2">
            <Btn
              variant={mode === 'selfsigned' ? 'primary' : 'default'}
              onClick={() => switchMode('selfsigned')}
            >
              {l.modeSelfSigned}
            </Btn>
            <Btn variant={mode === 'csr' ? 'primary' : 'default'} onClick={() => switchMode('csr')}>
              {l.modeCsr}
            </Btn>
          </div>

          <Input value={cn} onChange={setCn} label={l.cn} placeholder={l.cnPh} toolInput />
          <TA
            value={sans}
            onChange={setSans}
            label={l.sans}
            placeholder={l.sansPh}
            rows={4}
            spellCheck
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input value={org} onChange={setOrg} label={l.org} />
            <Input value={ou} onChange={setOu} label={l.ou} />
            <Input value={country} onChange={setCountry} label={l.country} />
          </div>
          <div className="flex items-end gap-3">
            <div className="w-40 shrink-0">
              <Input value={days} onChange={setDays} label={l.days} />
            </div>
            <div className="w-40 shrink-0">
              <Select value={bits} onChange={setBits} options={BITS_OPTIONS} label={l.bits} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Btn
              variant="primary"
              disabled={busy || cn.trim().length === 0}
              onClick={() => void run()}
            >
              {busy ? l.genBusy : l.gen}
            </Btn>
            <span className="text-[11.5px] text-muted">{l.genHint}</span>
          </div>
        </div>
      </Panel>

      <ErrorNote msg={err} />

      {result && (
        <>
          {/* 私钥区：永远放在最显眼的位置，警告先行 */}
          <div
            role="status"
            className="rounded-lg border border-amber/35 bg-amber/10 px-3 py-2 text-[12.5px] text-amber"
          >
            ⚠ {l.keyWarning}
          </div>
          <ResultPanel title={l.keyPemTitle} text={result.keyPem} maxHeight={200} />

          <ResultPanel
            title={result.certPem ? l.certPemTitle : l.csrPemTitle}
            text={result.certPem ?? result.csrPem}
            maxHeight={260}
          />

          {summary && (
            <Panel title={l.summary}>
              <KV k={l.subject} v={summary.subject} />
              <KV k={l.notAfter} v={summary.notAfter} />
            </Panel>
          )}
        </>
      )}

      <Panel title={l.noteTitle}>{l.note}</Panel>
    </ToolShell>
  )
}
