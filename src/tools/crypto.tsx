import React, { useState, useMemo } from 'react'
import CryptoJS from 'crypto-js'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn } from '../components/ui'

/* ================= Hash ================= */

export function HashTool() {
  const [input, setInput] = useState('')
  const out = useMemo(() => {
    if (!input) return null
    return {
      MD5: CryptoJS.MD5(input).toString(),
      'SHA-1': CryptoJS.SHA1(input).toString(),
      'SHA-256': CryptoJS.SHA256(input).toString(),
      'SHA-512': CryptoJS.SHA512(input).toString(),
      'SHA-3': CryptoJS.SHA3(input).toString(),
      RIPEMD160: CryptoJS.RIPEMD160(input).toString(),
    }
  }, [input])
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入文本" placeholder="输入待计算哈希的内容，实时输出..." rows={4} />
      {out && (
        <div className="space-y-1.5">
          {Object.entries(out).map(([k, v]) => (
            <div key={k} className="border border-line-soft bg-panel-2 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted">{k}</div>
                <div className="text-phosphor text-[12px] break-all">{v}</div>
              </div>
              <CopyBtn text={v} className="shrink-0 self-start" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= HMAC ================= */

export function HmacTool() {
  const [input, setInput] = useState('')
  const [key, setKey] = useState('')
  const [algo, setAlgo] = useState('SHA256')
  const out = useMemo(() => {
    if (!input || !key) return ''
    try {
      const fn = (CryptoJS as any)['Hmac' + algo]
      return fn(input, key).toString()
    } catch { return '' }
  }, [input, key, algo])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label="密钥 Key" placeholder="secret" />
        <Select value={algo} onChange={setAlgo} label="算法" options={[
          { value: 'MD5', label: 'HMAC-MD5' }, { value: 'SHA1', label: 'HMAC-SHA1' },
          { value: 'SHA256', label: 'HMAC-SHA256' }, { value: 'SHA512', label: 'HMAC-SHA512' },
        ]} />
      </div>
      <TA value={input} onChange={setInput} label="消息" rows={4} />
      {out && <TA value={out} readOnly label="HMAC 输出 (hex)" rows={3} />}
    </div>
  )
}

/* ================= AES ================= */

export function AesTool() {
  const [input, setInput] = useState('')
  const [key, setKey] = useState('')
  const [mode, setMode] = useState('ECB')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const getKey = () => CryptoJS.enc.Utf8.parse(key.padEnd(32, '\0').slice(0, 32))
  const getIv = () => CryptoJS.enc.Utf8.parse(key.padEnd(16, '\0').split('').reverse().join('').slice(0, 16))

  const run = (op: 'enc' | 'dec') => {
    setErr(null)
    if (!key) { setErr('请输入密钥'); return }
    try {
      const cfg: any = { mode: (CryptoJS.mode as any)[mode], padding: CryptoJS.pad.Pkcs7 }
      if (mode !== 'ECB') cfg.iv = getIv()
      if (op === 'enc') {
        const r = CryptoJS.AES.encrypt(input, getKey(), cfg)
        setOutput(r.toString())
      } else {
        const r = CryptoJS.AES.decrypt(input.trim(), getKey(), cfg)
        const s = r.toString(CryptoJS.enc.Utf8)
        if (!s) throw new Error('解密结果为空')
        setOutput(s)
      }
    } catch {
      setErr(op === 'enc' ? '加密失败，请检查输入。' : '解密失败：密文、密钥或模式不匹配。')
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label="密钥（自动派生 256 位）" placeholder="my-secret-key" />
        <Select value={mode} onChange={setMode} label="模式" options={[
          { value: 'ECB', label: 'ECB' }, { value: 'CBC', label: 'CBC（IV 由密钥派生）' },
        ]} />
      </div>
      <TA value={input} onChange={setInput} label="明文 / Base64 密文" rows={5} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>加密 → Base64</Btn>
        <Btn onClick={() => run('dec')}>解密 → 明文</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label="输出" rows={5} />
      <p className="text-[11px] text-muted">* 纯前端本地运算，密钥不会上传。ECB 模式不安全，仅用于兼容性测试；正式场景请使用 CBC/GCM + 随机 IV。</p>
    </div>
  )
}

/* ================= JWT ================= */

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return decodeURIComponent(escape(atob(s)))
}

export function JwtTool() {
  const [token, setToken] = useState('')
  const decoded = useMemo(() => {
    if (!token.trim()) return null
    try {
      const parts = token.trim().split('.')
      if (parts.length < 2) return { error: 'JWT 格式应为 header.payload.signature 三段结构' }
      const header = JSON.stringify(JSON.parse(b64urlDecode(parts[0])), null, 2)
      const payload = JSON.stringify(JSON.parse(b64urlDecode(parts[1])), null, 2)
      let extra: [string, string][] = []
      try {
        const p = JSON.parse(b64urlDecode(parts[1]))
        if (p.exp) extra.push(['过期时间 exp', new Date(p.exp * 1000).toLocaleString('zh-CN', { hour12: false }) + (p.exp * 1000 < Date.now() ? '（已过期）' : '（有效）')])
        if (p.iat) extra.push(['签发时间 iat', new Date(p.iat * 1000).toLocaleString('zh-CN', { hour12: false })])
        if (p.nbf) extra.push(['生效时间 nbf', new Date(p.nbf * 1000).toLocaleString('zh-CN', { hour12: false })])
        if (p.iss) extra.push(['签发者 iss', p.iss])
        if (p.sub) extra.push(['主体 sub', p.sub])
      } catch { /* ignore */ }
      return { header, payload, signature: parts[2] || '（无签名段）', extra }
    } catch (e) {
      return { error: '解析失败：' + (e as Error).message }
    }
  }, [token])

  return (
    <div className="space-y-3">
      <TA value={token} onChange={setToken} label="JWT Token" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xxxx" rows={4} />
      {decoded && 'error' in decoded && <ErrorNote msg={decoded.error!} />}
      {decoded && 'header' in decoded && (
        <div className="space-y-3">
          {decoded.extra!.length > 0 && (
            <Panel title="声明解析">
              {decoded.extra!.map(([k, v]) => <KV key={k} k={k} v={v} />)}
            </Panel>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Panel title="Header"><pre className="codeblock text-[12px] text-amber">{decoded.header}</pre></Panel>
            <Panel title="Payload"><pre className="codeblock text-[12px] text-phosphor">{decoded.payload}</pre></Panel>
          </div>
          <Panel title="Signature">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-danger break-all">{decoded.signature}</span>
              <CopyBtn text={decoded.signature!} className="shrink-0" />
            </div>
          </Panel>
          <p className="text-[11px] text-muted">* 仅做本地解码展示，不验证签名。切勿将生产环境的 Token 粘贴到不可信网站。</p>
        </div>
      )}
    </div>
  )
}

/* ================= Hash 类型识别 ================= */

const HASH_TYPES: { name: string; len: number; pattern: RegExp; note: string }[] = [
  { name: 'MD5 / NTLM', len: 32, pattern: /^[0-9a-f]{32}$/i, note: '32 位十六进制，常见于 MD5、NTLM、MD4' },
  { name: 'SHA-1 / MySQL5', len: 40, pattern: /^[0-9a-f]{40}$/i, note: '40 位十六进制，常见于 SHA-1、RIPEMD-160' },
  { name: 'SHA-224', len: 56, pattern: /^[0-9a-f]{56}$/i, note: '56 位十六进制' },
  { name: 'SHA-256 / SHA3-256', len: 64, pattern: /^[0-9a-f]{64}$/i, note: '64 位十六进制，也可能是 Blake2s' },
  { name: 'SHA-384', len: 96, pattern: /^[0-9a-f]{96}$/i, note: '96 位十六进制' },
  { name: 'SHA-512 / Whirlpool', len: 128, pattern: /^[0-9a-f]{128}$/i, note: '128 位十六进制，也可能是 Blake2b' },
  { name: 'bcrypt', len: 60, pattern: /^\$2[abyxy]\$\d{2}\$[./A-Za-z0-9]{53}$/, note: '$2a$/$2b$ 前缀，带 cost 因子，慢哈希' },
  { name: 'MD5 Crypt', len: 34, pattern: /^\$1\$/, note: '$1$ 前缀，Unix md5crypt' },
  { name: 'SHA-512 Crypt', len: 106, pattern: /^\$6\$/, note: '$6$ 前缀，Linux /etc/shadow 常见' },
  { name: 'SHA-256 Crypt', len: 63, pattern: /^\$5\$/, note: '$5$ 前缀' },
  { name: 'Argon2', len: 90, pattern: /^\$argon2(id|i|d)\$/, note: '现代密码哈希推荐算法，抗 GPU 破解' },
  { name: 'MySQL 4.1+', len: 41, pattern: /^\*[0-9a-f]{40}$/i, note: '* 前缀 + 40 位十六进制' },
  { name: 'Base64 编码串', len: 0, pattern: /^[A-Za-z0-9+/]+={0,2}$/, note: '可能是 Base64 编码而非哈希（注意 Base64 可逆！）' },
]

export function HashIdentifyTool() {
  const [input, setInput] = useState('')
  const results = useMemo(() => {
    const h = input.trim()
    if (!h) return null
    return HASH_TYPES.filter(t => {
      if (t.len > 0 && h.length !== t.len) return false
      return t.pattern.test(h)
    })
  }, [input])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="粘贴哈希串" placeholder="5f4dcc3b5aa765d61d8327deb882cf99" rows={3} />
      {results && (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">长度 {input.trim().length} · 可能匹配 <span className="text-phosphor">{results.length}</span> 种类型</div>
          {results.length === 0 && <ErrorNote msg="未匹配到已知哈希格式，可能是加盐哈希或自定义编码。" />}
          {results.map(r => (
            <div key={r.name} className="border border-line-soft bg-panel-2 px-3 py-2">
              <div className="text-phosphor text-[13px]">{r.name}</div>
              <div className="text-muted text-[12px]">{r.note}</div>
            </div>
          ))}
        </div>
      )}
      <Panel title="破解思路速查">
        <ul className="text-[12px] text-muted space-y-1 list-none">
          <li><span className="text-phosphor">hashcat</span> — GPU 破解利器：hashcat -m 0 hash.txt rockyou.txt（-m 指定哈希类型）</li>
          <li><span className="text-phosphor">john</span> — john --wordlist=dict.txt hash.txt</li>
          <li><span className="text-phosphor">在线彩虹表</span> — cmd5 / crackstation 可查未加盐的常见哈希</li>
          <li><span className="text-danger">注意</span> — bcrypt / Argon2 属慢哈希，字典爆破成本极高</li>
        </ul>
      </Panel>
    </div>
  )
}
