import { describe, it, expect } from 'vitest'
import {
  buildSmugglingTemplates,
  buildTimingProbe,
  TE_VARIANTS,
} from '../src/lib/toolkit/smuggling'
import { parseNmap } from '../src/lib/toolkit/nmap'

function splitRaw(raw: string): { head: string[]; body: string } {
  const i = raw.indexOf('\r\n\r\n')
  return { head: raw.slice(0, i).split('\r\n'), body: raw.slice(i + 4) }
}

describe('buildSmugglingTemplates', () => {
  const tpls = buildSmugglingTemplates({ host: 'lab.local', path: '/', smuggledPath: '/admin' })

  it('returns three templates', () => {
    expect(tpls.map((t) => t.id)).toEqual(['clte', 'tecl', 'tete'])
  })

  it('CL.TE Content-Length equals actual body byte length', () => {
    const clte = tpls.find((t) => t.id === 'clte')!
    const { head, body } = splitRaw(clte.raw)
    const cl = Number(head.find((h) => h.startsWith('Content-Length:'))!.split(': ')[1])
    expect(cl).toBe(new TextEncoder().encode(body).length)
  })

  it('CL.TE body starts with a zero chunk and carries the smuggled request', () => {
    const { body } = splitRaw(tpls.find((t) => t.id === 'clte')!.raw)
    expect(body.startsWith('0\r\n\r\nGET /admin')).toBe(true)
  })

  it('TE.CL first chunk length header is hex of its content bytes', () => {
    const tecl = tpls.find((t) => t.id === 'tecl')!
    const { body } = splitRaw(tecl.raw)
    const firstLine = body.slice(0, body.indexOf('\r\n'))
    const declared = parseInt(firstLine, 16)
    const chunkContent = body.slice(firstLine.length + 2, declared + firstLine.length + 2)
    expect(chunkContent).toContain('GET /admin')
  })

  it('TE.TE contains an obfuscated TE header', () => {
    const tete = tpls.find((t) => t.id === 'tete')!
    expect(tete.raw).toContain('Transfer-Encoding: cow')
  })
})

describe('buildTimingProbe', () => {
  it('builds an unterminated chunked body with correct CL', () => {
    const raw = buildTimingProbe('lab.local', '/')
    const { head, body } = splitRaw(raw)
    expect(head).toContain('Transfer-Encoding: chunked')
    const cl = Number(head.find((h) => h.startsWith('Content-Length:'))!.split(': ')[1])
    expect(cl).toBe(new TextEncoder().encode(body).length)
    expect(body).toContain('4\r\nAAAA\r\nX')
  })
})

describe('TE_VARIANTS', () => {
  it('includes documented obfuscations', () => {
    expect(TE_VARIANTS.length).toBeGreaterThanOrEqual(10)
    expect(TE_VARIANTS.some((v) => v.value.includes('cow'))).toBe(true)
  })
})

describe('parseNmap grepable', () => {
  it('parses Host and Ports', () => {
    const raw =
      'Host: 10.0.0.1 (router.local)\tStatus: Up\n' +
      'Host: 10.0.0.1 (router.local)\tPorts: 22/open/tcp//ssh//OpenSSH 8.0/, 80/open/tcp//http//nginx/\tIgnored State: closed (998)\n'
    const r = parseNmap(raw)
    expect(r.ok).toBe(true)
    expect(r.format).toBe('grepable')
    expect(r.hosts[0].ip).toBe('10.0.0.1')
    expect(r.hosts[0].hostname).toBe('router.local')
    expect(r.hosts[0].ports).toHaveLength(2)
    expect(r.hosts[0].ports[0]).toMatchObject({
      port: 22,
      state: 'open',
      protocol: 'tcp',
      service: 'ssh',
    })
    expect(r.hosts[0].ports[0].version).toBe('OpenSSH 8.0')
    expect(r.openCount).toBe(2)
  })
})

describe('parseNmap normal', () => {
  it('parses the human-readable table', () => {
    const raw = [
      'Starting Nmap',
      'Nmap scan report for db.internal (10.0.0.5)',
      'PORT     STATE SERVICE VERSION',
      '22/tcp   open  ssh     OpenSSH 7.9',
      '5432/tcp open  postgresql PostgreSQL DB 13.4',
      '',
      'Nmap scan report for 10.0.0.6',
      '80/tcp open http nginx',
    ].join('\n')
    const r = parseNmap(raw)
    expect(r.format).toBe('normal')
    expect(r.hosts).toHaveLength(2)
    expect(r.hosts[0].hostname).toBe('db.internal')
    expect(r.hosts[0].ip).toBe('10.0.0.5')
    expect(r.hosts[0].ports[1]).toMatchObject({ port: 5432, service: 'postgresql' })
    expect(r.hosts[1].hostname).toBe('')
    expect(r.hosts[1].ports[0].port).toBe(80)
    expect(r.openCount).toBe(3)
  })
})

describe('parseNmap xml', () => {
  it('parses <host><port> structure', () => {
    const raw = `<?xml version="1.0"?>
<nmaprun>
<host><status state="up"/>
<address addr="192.168.1.10" addrtype="ipv4"/>
<hostnames><hostname name="web.lan" type="user"/></hostnames>
<ports>
<port protocol="tcp" portid="443"><state state="open"/><service name="https" version="nginx 1.25"/></port>
<port protocol="tcp" portid="22"><state state="closed"/><service name="ssh"/></port>
</ports>
</host>
</nmaprun>`
    const r = parseNmap(raw)
    expect(r.format).toBe('xml')
    expect(r.hosts).toHaveLength(1)
    expect(r.hosts[0].ip).toBe('192.168.1.10')
    expect(r.hosts[0].hostname).toBe('web.lan')
    // 端口按数字排序，22 在 443 前；按端口号查找断言
    const httpsPort = r.hosts[0].ports.find((p) => p.port === 443)!
    expect(httpsPort).toMatchObject({ state: 'open', service: 'https' })
    expect(httpsPort.version).toBe('nginx 1.25')
    expect(r.openCount).toBe(1)
  })
})

describe('parseNmap errors', () => {
  it('rejects empty and unrecognized text', () => {
    expect(parseNmap('').ok).toBe(false)
    expect(parseNmap('hello world').ok).toBe(false)
  })
})
