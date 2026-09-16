import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, ErrorNote, KV, CopyBtn } from '../components/ui'

/* ================= URL 解析器 ================= */

export function UrlParserTool() {
  const [input, setInput] = useState('https://user:pass@api.example.com:8443/v1/users?id=42&token=abc%20def&tag=a&tag=b#section')

  const parsed = useMemo(() => {
    const t = input.trim()
    if (!t) return null
    try {
      const u = new URL(t.includes('://') ? t : 'http://' + t)
      const params: { k: string; v: string }[] = []
      u.searchParams.forEach((v, k) => params.push({ k, v }))
      return {
        protocol: u.protocol.replace(':', ''),
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '(默认)'),
        pathname: decodeURIComponent(u.pathname),
        search: u.search,
        hash: decodeURIComponent(u.hash.replace(/^#/, '')),
        params,
      }
    } catch {
      return { error: '无法解析为 URL' }
    }
  }, [input])

  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label="URL" placeholder="https://example.com/path?a=1&b=2#frag" />
      {parsed && 'error' in parsed && <ErrorNote msg={parsed.error!} />}
      {parsed && !('error' in parsed) && (
        <div className="space-y-3">
          <Panel title="组成部分">
            <KV k="协议" v={parsed.protocol} />
            {parsed.username && <KV k="用户名" v={<span className="text-amber">{parsed.username}</span>} />}
            {parsed.password && <KV k="密码" v={<span className="text-danger">{parsed.password}</span>} />}
            <KV k="主机" v={<span className="text-phosphor">{parsed.hostname}</span>} />
            <KV k="端口" v={parsed.port} />
            <KV k="路径" v={parsed.pathname} />
            {parsed.hash && <KV k="锚点 (#)" v={parsed.hash} />}
          </Panel>
          <Panel title={`查询参数 (${parsed.params.length})`}>
            {parsed.params.length === 0 && <span className="text-muted text-[12px]">无查询参数</span>}
            {parsed.params.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-line-soft last:border-0">
                <div className="min-w-0 text-[12.5px]">
                  <span className="text-phosphor">{p.k}</span>
                  <span className="text-muted"> = </span>
                  <span className="text-bright break-all">{p.v}</span>
                </div>
                <CopyBtn text={`${p.k}=${p.v}`} className="shrink-0" />
              </div>
            ))}
          </Panel>
          <div className="flex gap-2 flex-wrap">
            <Btn onClick={() => setInput(encodeURI(input.trim()))}>整体 URL 编码</Btn>
            <Btn variant="ghost" onClick={() => setInput(decodeURI(input.trim()))}>整体解码</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= User-Agent 解析 ================= */

interface UaInfo { browser: string; version: string; os: string; device: string; bot: string | null }

function parseUa(ua: string): UaInfo {
  const t = ua
  let bot: string | null = null
  const botMatch = t.match(/(Googlebot|Bingbot|Baiduspider|YandexBot|DuckDuckBot|Slurp|Sogou|Bytespider|GPTBot|ClaudeBot|curl|wget|python-requests|PostmanRuntime|sqlmap|nmap|Nikto|masscan|Go-http-client)/i)
  if (botMatch) bot = botMatch[1]

  let browser = '未知', version = ''
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/MSIE ([\d.]+)/, 'IE'],
    [/Trident.*rv:([\d.]+)/, 'IE'],
    [/MicroMessenger\/([\d.]+)/, '微信内置浏览器'],
    [/CriOS\/([\d.]+)/, 'Chrome (iOS)'],
    [/curl\/([\d.]+)/, 'curl'],
    [/python-requests\/([\d.]+)/, 'python-requests'],
  ]
  for (const [re, name] of rules) {
    const m = t.match(re)
    if (m) { browser = name; version = m[1]; break }
  }

  let os = '未知'
  if (/Windows NT 10/.test(t)) os = 'Windows 10/11'
  else if (/Windows NT 6\.3/.test(t)) os = 'Windows 8.1'
  else if (/Windows NT 6\.1/.test(t)) os = 'Windows 7'
  else if (/iPhone|iPod/.test(t)) os = 'iOS (iPhone)' + (t.match(/OS ([\d_]+)/) ? ' ' + t.match(/OS ([\d_]+)/)![1].replace(/_/g, '.') : '')
  else if (/iPad/.test(t)) os = 'iOS (iPad)'
  else if (/Android ([\d.]+)/.test(t)) os = 'Android ' + t.match(/Android ([\d.]+)/)![1]
  else if (/Mac OS X ([\d_]+)/.test(t)) os = 'macOS ' + t.match(/Mac OS X ([\d_]+)/)![1].replace(/_/g, '.')
  else if (/Linux/.test(t)) os = 'Linux'

  let device = '桌面设备'
  if (/Mobile|iPhone|Android.*Mobile/.test(t)) device = '手机'
  else if (/iPad|Tablet|Android(?!.*Mobile)/.test(t)) device = '平板'

  return { browser, version, os, device, bot }
}

const UA_EXAMPLES: [string, string][] = [
  ['Chrome / Win', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'],
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  ['sqlmap', 'sqlmap/1.7.2#stable (https://sqlmap.org)'],
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
]

export function UserAgentTool() {
  const [input, setInput] = useState('')
  const info = useMemo(() => input.trim() ? parseUa(input) : null, [input])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="User-Agent 字符串" rows={4} placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) ..." />
      <div className="flex gap-2 flex-wrap">
        {UA_EXAMPLES.map(([name, ua]) => (
          <button key={name} onClick={() => setInput(ua)}
            className="px-2 py-1 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {name}
          </button>
        ))}
      </div>
      {info && (
        <Panel title="解析结果">
          <KV k="浏览器" v={<span className="text-phosphor">{info.browser} {info.version}</span>} />
          <KV k="操作系统" v={info.os} />
          <KV k="设备类型" v={info.device} />
          <KV k="爬虫/工具" v={info.bot ? <span className="text-danger">{info.bot}（自动化程序）</span> : <span className="text-muted">未识别到</span>} />
        </Panel>
      )}
    </div>
  )
}

/* ================= IP 整形转换 ================= */

function ipToLong(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = parseInt(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}
function longToIp(n: number): string {
  return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.')
}

export function IpIntTool() {
  const [input, setInput] = useState('127.0.0.1')

  const result = useMemo(() => {
    const t = input.trim()
    if (!t) return null
    let n: number | null = null
    if (/^\d+$/.test(t)) n = parseInt(t) >>> 0
    else if (/^0x[0-9a-f]+$/i.test(t)) n = parseInt(t, 16) >>> 0
    else if (/^0[0-7]+$/.test(t)) n = parseInt(t, 8) >>> 0
    else n = ipToLong(t)
    if (n === null || n > 0xFFFFFFFF) return { error: '无法识别的 IP 格式' }
    const ip = longToIp(n)
    return {
      n, ip,
      hex: '0x' + n.toString(16).padStart(8, '0').toUpperCase(),
      octal: '0' + n.toString(8),
      dottedHex: ip.split('.').map(o => '0x' + parseInt(o).toString(16).padStart(2, '0')).join('.'),
      dottedOctal: ip.split('.').map(o => '0' + parseInt(o).toString(8).padStart(3, '0')).join('.'),
    }
  }, [input])

  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label="IP 地址 / 整数 / Hex / 八进制" placeholder="127.0.0.1 或 2130706433" />
      {result && 'error' in result && <ErrorNote msg={result.error!} />}
      {result && !('error' in result) && (
        <Panel title="等价表示（SSRF / 过滤绕过常用）">
          <KV k="点分十进制" v={<span className="text-phosphor">{result.ip}</span>} />
          <KV k="十进制整数" v={<>{result.n} <CopyBtn text={String(result.n)} /></>} />
          <KV k="十六进制" v={<>{result.hex} <CopyBtn text={result.hex} /></>} />
          <KV k="八进制" v={<>{result.octal} <CopyBtn text={result.octal} /></>} />
          <KV k="点分 Hex" v={<>{result.dottedHex} <CopyBtn text={result.dottedHex} /></>} />
          <KV k="点分八进制" v={<>{result.dottedOctal} <CopyBtn text={result.dottedOctal} /></>} />
        </Panel>
      )}
      <p className="text-[11px] text-muted">
        * 多数 HTTP 客户端与浏览器接受 http://2130706433 、http://0x7F000001 等形式访问 127.0.0.1，
        常用于 SSRF 场景绕过内网地址黑名单。
      </p>
    </div>
  )
}

/* ================= Cookie 解析 ================= */

const COOKIE_ATTR_NOTES: Record<string, string> = {
  expires: '过期时间（GMT 格式）',
  'max-age': '存活秒数，优先级高于 Expires',
  domain: '生效域名，缺省为当前主机（不含子域）',
  path: '生效路径',
  secure: '仅通过 HTTPS 传输',
  httponly: '禁止 JS 读取（防 XSS 窃取）',
  samesite: '跨站发送策略：Strict / Lax / None（None 必须配合 Secure）',
  partitioned: 'CHIPS：第三方 Cookie 分区存储',
}

export function CookieTool() {
  const [input, setInput] = useState('sessionid=abc123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; Domain=.example.com; Secure; HttpOnly; SameSite=Lax')

  const parsed = useMemo(() => {
    const t = input.trim()
    if (!t) return null
    const segs = t.split(';').map(s => s.trim()).filter(Boolean)
    if (!segs.length) return null
    const first = segs[0]
    const eq = first.indexOf('=')
    const cookie = eq > 0 ? { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() } : null
    const attrs = segs.slice(cookie ? 1 : 0).map(s => {
      const i = s.indexOf('=')
      const k = (i > 0 ? s.slice(0, i) : s).trim().toLowerCase()
      const v = i > 0 ? s.slice(i + 1).trim() : '(flag)'
      return { k, v, note: COOKIE_ATTR_NOTES[k] }
    })
    return { cookie, attrs }
  }, [input])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="Set-Cookie 响应头值 / Cookie 请求头" rows={3} />
      {parsed && (
        <div className="space-y-3">
          {parsed.cookie ? (
            <Panel title="Cookie 本体">
              <KV k="名称" v={<span className="text-phosphor">{parsed.cookie.name}</span>} />
              <KV k="值" v={<span className="break-all">{parsed.cookie.value}</span>} />
            </Panel>
          ) : (
            <ErrorNote msg="首段不是 name=value 结构，可能只粘贴了属性部分" />
          )}
          {parsed.attrs.length > 0 && (
            <Panel title="属性">
              {parsed.attrs.map((a, i) => (
                <div key={i} className="py-1 border-b border-line-soft last:border-0 text-[12.5px]">
                  <span className="text-phosphor">{a.k}</span>
                  {a.v !== '(flag)' && <span className="text-muted"> = {a.v}</span>}
                  {a.note && <div className="text-[11px] text-muted">{a.note}</div>}
                </div>
              ))}
            </Panel>
          )}
          <Panel title="安全检查">
            {(() => {
              const ks = parsed.attrs.map(a => a.k)
              const checks: [boolean, string, string][] = [
                [ks.includes('httponly'), 'HttpOnly', '缺失时可被 XSS 窃取'],
                [ks.includes('secure'), 'Secure', '缺失时可经 HTTP 明文泄露'],
                [ks.includes('samesite'), 'SameSite', '缺失时 CSRF 风险更高'],
              ]
              return checks.map(([ok, name, risk]) => (
                <div key={name} className="py-1 border-b border-line-soft last:border-0 text-[12.5px]">
                  <span className={ok ? 'text-phosphor' : 'text-danger'}>{ok ? '✓' : '✗'} {name}</span>
                  {!ok && <span className="text-muted text-[11px]"> — {risk}</span>}
                </div>
              ))
            })()}
          </Panel>
        </div>
      )}
    </div>
  )
}
