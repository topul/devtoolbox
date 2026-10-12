/**
 * Nmap 输出解析 —— 纯函数。
 *
 * 支持三种格式，按内容自动识别：
 *  - grepable (-oG)：Host: 行 + Ports: 字段
 *  - XML (-oX)：<host><ports><port>
 *  - 普通文本（默认输出 / -oN）：Nmap scan report + 端口表
 * 输出统一的主机 → 端口结构，便于把侦察结果整理成表。
 */

export interface NmapPort {
  port: number
  protocol: string
  state: string
  service: string
  version?: string
}

export interface NmapHost {
  ip: string
  hostname: string
  ports: NmapPort[]
}

export interface NmapResult {
  ok: boolean
  error?: string
  format: 'grepable' | 'xml' | 'normal'
  hosts: NmapHost[]
  openCount: number
}

/* ---------------- grepable (-oG) ---------------- */

function parseGrepable(raw: string): NmapHost[] {
  // 真实 -oG 每个主机输出两行（Status 行 + Ports 行），按 IP 聚合
  const byIp = new Map<string, NmapHost>()
  for (const line of raw.split('\n')) {
    if (!line.startsWith('Host:')) continue
    const hostM = /^Host:\s*(\S+)\s*\(([^)]*)\)/.exec(line)
    if (!hostM) continue
    const ip = hostM[1]
    const hostname = hostM[2] && hostM[2] !== '' ? hostM[2] : ''
    let host = byIp.get(ip)
    if (!host) {
      host = { ip, hostname, ports: [] }
      byIp.set(ip, host)
    } else if (!host.hostname && hostname) {
      host.hostname = hostname
    }
    // -oG 字段以 tab 分隔；Ports 字段内部全是斜杠和逗号，不能用字符类硬切
    const portsField = line.split('\t').find((f) => f.startsWith('Ports:'))
    if (portsField && portsField.slice('Ports:'.length).trim()) {
      for (const entry of portsField
        .slice('Ports:'.length)
        .trim()
        .split(/\s*,\s*/)) {
        // 22/open/tcp//ssh//OpenSSH 7.9/
        const f = entry.split('/')
        if (f.length < 5) continue
        const port = Number(f[0])
        if (!Number.isInteger(port)) continue
        host.ports.push({
          port,
          state: f[1],
          protocol: f[2],
          service: f[4] || 'unknown',
          version: f[6]?.trim() || undefined,
        })
      }
    }
  }
  return [...byIp.values()]
}

/* ---------------- XML (-oX) ---------------- */

function parseXml(raw: string): NmapHost[] {
  const hosts: NmapHost[] = []
  // 不引第三方 XML 库；nmap -oX 结构稳定，做标签级提取
  for (const hostBlock of raw.split(/<host\b/).slice(1)) {
    const block = hostBlock.slice(0, hostBlock.indexOf('</host>') + 7)
    const addrM = /<address\s+addr="([^"]+)"\s+addrtype="ipv4"/.exec(block)
    if (!addrM) continue
    const ip = addrM[1]
    const hostM =
      /<hostname\s+type="user"\s+name="([^"]+)"/.exec(block) ??
      /<hostname\s+name="([^"]+)"/.exec(block)
    const ports: NmapPort[] = []
    const portsSection = (block.split('<ports>')[1] ?? '').split('</ports>')[0] ?? ''
    for (const pm of portsSection.matchAll(
      /<port\s+protocol="([^"]+)"\s+portid="(\d+)"[^>]*>([\s\S]*?)<\/port>/g,
    )) {
      const [, protocol, portStr, inner] = pm
      const stateM = /<state\s+state="([^"]+)"/.exec(inner)
      const svcM = /<service\s[^>]*name="([^"]*)"[^>]*>/.exec(inner)
      const verM = /<service\s[^>]*version="([^"]*)"/.exec(inner)
      ports.push({
        port: Number(portStr),
        protocol,
        state: stateM?.[1] ?? 'unknown',
        service: svcM?.[1] || 'unknown',
        version: verM?.[1] || undefined,
      })
    }
    hosts.push({ ip, hostname: hostM?.[1] ?? '', ports })
  }
  return hosts
}

/* ---------------- 普通文本 ---------------- */

function parseNormal(raw: string): NmapHost[] {
  const hosts: NmapHost[] = []
  let cur: NmapHost | null = null
  for (const line of raw.split('\n')) {
    const hostM = /^Nmap scan report for\s+(?:(\S+)\s+\()?([0-9a-fA-F:.]+)\)?\s*$/.exec(line)
    if (hostM) {
      if (cur) hosts.push(cur)
      cur = { ip: hostM[2], hostname: hostM[1] ?? '', ports: [] }
      continue
    }
    if (!cur) continue
    // 22/tcp   open  ssh     OpenSSH 7.9 (protocol 2.0)
    const pm = /^(\d+)\/(tcp|udp|sctp)\s+(\S+)\s+(\S+)?\s*(.*)$/.exec(line.trim())
    if (pm) {
      cur.ports.push({
        port: Number(pm[1]),
        protocol: pm[2],
        state: pm[3],
        service: pm[4] || 'unknown',
        version: pm[5]?.trim() || undefined,
      })
    }
  }
  if (cur) hosts.push(cur)
  return hosts
}

export function parseNmap(raw: string): NmapResult {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'EMPTY', format: 'normal', hosts: [], openCount: 0 }

  let format: NmapResult['format']
  let hosts: NmapHost[]
  if (text.startsWith('<?xml') || /<nmaprun/.test(text.slice(0, 200))) {
    format = 'xml'
    hosts = parseXml(text)
  } else if (/^Host:\s/m.test(text)) {
    format = 'grepable'
    hosts = parseGrepable(text)
  } else if (/^Nmap scan report/m.test(text) || /^\d+\/(tcp|udp)\s/m.test(text)) {
    format = 'normal'
    hosts = parseNormal(text)
  } else {
    return { ok: false, error: 'UNRECOGNIZED', format: 'normal', hosts: [], openCount: 0 }
  }

  // 端口排序 + 只保留有端口的主机（XML 里 up 但没扫出端口的主机也保留——它至少有 IP）
  for (const h of hosts) h.ports.sort((a, b) => a.port - b.port)
  const openCount = hosts.reduce((n, h) => n + h.ports.filter((p) => p.state === 'open').length, 0)
  return { ok: true, format, hosts, openCount }
}
