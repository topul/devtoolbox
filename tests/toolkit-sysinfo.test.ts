import { describe, expect, it } from 'vitest'
import {
  cpuUsage,
  parseDfPk,
  parseIpRoute,
  parseRouteGet,
  parseWindowsDisks,
  parseWindowsRoute,
  pickPrimaryAddresses,
  uptimeParts,
} from '../src/lib/toolkit/sysinfo'
import type { SysNetInterface } from '../src/lib/sysinfo-types'

describe('cpuUsage', () => {
  it('计算采样间隔内每核心与总体占用率', () => {
    // 单核：idle 涨 200、total 涨 1000 → 忙 80%
    const r = cpuUsage([{ idle: 0, total: 0 }], [{ idle: 200, total: 1000 }])
    expect(r.perCorePercent[0]).toBeCloseTo(80, 5)
    expect(r.overallPercent).toBeCloseTo(80, 5)
  })

  it('多核按忙闲加权汇总', () => {
    const r = cpuUsage(
      [
        { idle: 0, total: 0 },
        { idle: 0, total: 0 },
      ],
      [
        { idle: 1000, total: 1000 }, // 全闲
        { idle: 0, total: 1000 }, // 全忙
      ],
    )
    expect(r.perCorePercent).toEqual([0, 100])
    expect(r.overallPercent).toBeCloseTo(50, 5)
  })

  it('采样无增量（两次相同）返回 0 而不是 NaN', () => {
    const r = cpuUsage([{ idle: 5, total: 10 }], [{ idle: 5, total: 10 }])
    expect(r.overallPercent).toBe(0)
    expect(r.perCorePercent[0]).toBe(0)
  })

  it('空快照不崩', () => {
    expect(cpuUsage([], [])).toEqual({ overallPercent: 0, perCorePercent: [] })
  })
})

describe('uptimeParts', () => {
  it('秒数拆成天/时/分/秒', () => {
    expect(uptimeParts(0)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
    expect(uptimeParts(59)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 59 })
    expect(uptimeParts(90061)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 })
  })
  it('负数归零', () => {
    expect(uptimeParts(-5).seconds).toBe(0)
  })
})

describe('parseDfPk', () => {
  it('解析 macOS df -P -k（挂载点在最后、含空格）', () => {
    // df -P -k 的真实输出：固定 6 列，每条记录单行
    const out = [
      'Filesystem                   1024-blocks      Used Available Capacity Mounted on',
      '/dev/disk3s1s1                960000000  10000000 800000000     2%  /',
      '/dev/disk3s5                  960000000  50000000 800000000     7%  /System/Volumes/Data',
    ].join('\n')
    const disks = parseDfPk(out)
    expect(disks).toHaveLength(2)
    expect(disks[0]).toMatchObject({
      filesystem: '/dev/disk3s1s1',
      mount: '/',
      totalBytes: 960000000 * 1024,
      usedBytes: 10000000 * 1024,
      availBytes: 800000000 * 1024,
      usedPercent: 2,
    })
    expect(disks[1].mount).toBe('/System/Volumes/Data')
  })

  it('滤掉 tmpfs/devtmpfs/overlay 等伪文件系统（Linux）', () => {
    const out = [
      'Filesystem     1024-blocks    Used Available Capacity Mounted on',
      'tmpfs             1600000      100   1599900       1% /run',
      '/dev/sda1        50000000 20000000  30000000      40% /',
      'overlay          50000000 20000000  30000000      40% /var/lib/docker/overlay2/abc',
      '/dev/nvme0n1p2  100000000 10000000  90000000      10% /home',
    ].join('\n')
    const disks = parseDfPk(out)
    expect(disks.map((d) => d.mount)).toEqual(['/', '/home'])
    expect(disks[1].usedPercent).toBe(10)
  })

  it('畸形行不产生脏数据', () => {
    expect(parseDfPk('/dev/bad onlythree cols here')).toHaveLength(0)
    expect(parseDfPk('')).toHaveLength(0)
  })
})

describe('parseWindowsDisks', () => {
  it('解析 ConvertTo-Csv 输出并只留本地固定盘（DriveType=3）', () => {
    const csv = [
      '"DeviceID","Size","FreeSpace","DriveType"',
      '"C:","256060514304","123456789012","3"',
      '"D:","0","0","5"',
      '"E:","64000000000","32000000000","2"',
    ].join('\r\n')
    const disks = parseWindowsDisks(csv)
    expect(disks).toHaveLength(1)
    expect(disks[0]).toMatchObject({
      filesystem: 'C:',
      mount: 'C:',
      totalBytes: 256060514304,
      availBytes: 123456789012,
    })
    expect(disks[0].usedBytes).toBe(256060514304 - 123456789012)
    expect(disks[0].usedPercent).toBeGreaterThan(0)
    expect(disks[0].usedPercent).toBeLessThan(100)
  })

  it('跳过 #TYPE 行与空行', () => {
    const csv = '#TYPE Selected.CimInstance.Win32_LogicalDisk\n\r\n\r\n"#TYPE foo"\n'
    expect(parseWindowsDisks(csv)).toHaveLength(0)
  })
})

describe('parseRouteGet（macOS）', () => {
  it('提取 gateway 与 interface', () => {
    const out = [
      '   route to: default',
      'destination: default',
      '       mask: default',
      '    gateway: 192.168.1.1',
      '  interface: en0',
    ].join('\n')
    expect(parseRouteGet(out)).toEqual({ gateway: '192.168.1.1', iface: 'en0' })
  })
  it('无网关时返回 null', () => {
    expect(parseRouteGet('route: writing to routing socket: not in table')).toEqual({
      gateway: null,
      iface: null,
    })
  })
})

describe('parseIpRoute（Linux）', () => {
  const v4 = 'default via 10.0.2.2 dev eth0 proto dhcp src 10.0.2.15 metric 100'
  const v6 = 'default via fe80::1 dev eth0 proto ra metric 100'
  it('v4', () => expect(parseIpRoute(v4, 4)).toBe('10.0.2.2'))
  it('v6', () => expect(parseIpRoute(v6, 6)).toBe('fe80::1'))
  it('v4 解析器不接受 IPv6', () => expect(parseIpRoute(v6, 4)).toBeNull())
  it('无默认路由', () => expect(parseIpRoute('192.168.1.0/24 dev eth0', 4)).toBeNull())
})

describe('parseWindowsRoute', () => {
  it('从 route print -4 取默认网关', () => {
    const out = [
      'IPv4 Route Table',
      'Network Destination        Netmask          Gateway       Interface  Metric',
      '          0.0.0.0          0.0.0.0      192.168.1.1      192.168.1.5     25',
      '        127.0.0.0        255.0.0.0.0         On-link         127.0.0.1    331',
    ].join('\n')
    const g = parseWindowsRoute(out)
    expect(g.ipv4).toBe('192.168.1.1')
    expect(g.iface).toBe('192.168.1.5')
  })

  it('v6 默认路由 ::/0', () => {
    const out = '::/0                     fe80::1           fe80::abcd    256\n'
    const g = parseWindowsRoute(out)
    expect(g.ipv6).toBe('fe80::1')
  })
})

describe('pickPrimaryAddresses', () => {
  const ifaces: SysNetInterface[] = [
    {
      name: 'lo0',
      address: '127.0.0.1',
      family: 'IPv4',
      netmask: '255.0.0.0',
      cidr: '127.0.0.1/8',
      mac: '00:00:00:00:00:00',
      internal: true,
    },
    {
      name: 'en0',
      address: '192.168.1.5',
      family: 'IPv4',
      netmask: '255.255.255.0',
      cidr: '192.168.1.5/24',
      mac: 'aa:bb:cc:dd:ee:ff',
      internal: false,
    },
    {
      name: 'en0',
      address: 'fe80::1',
      family: 'IPv6',
      netmask: 'ffff:ffff:ffff:ffff::',
      cidr: null,
      mac: 'aa:bb:cc:dd:ee:ff',
      internal: false,
    },
    {
      name: 'en0',
      address: '240e:abcd::2',
      family: 'IPv6',
      netmask: 'ffff:ffff:ffff:ffff::',
      cidr: null,
      mac: 'aa:bb:cc:dd:ee:ff',
      internal: false,
    },
  ]
  it('选非内网 IPv4，IPv6 跳过 link-local', () => {
    expect(pickPrimaryAddresses(ifaces)).toEqual({
      ipv4: '192.168.1.5',
      ipv6: '240e:abcd::2',
    })
  })
  it('没有外网口时返回 null', () => {
    expect(
      pickPrimaryAddresses([
        {
          name: 'lo0',
          address: '::1',
          family: 'IPv6',
          netmask: '',
          cidr: null,
          mac: '',
          internal: true,
        },
      ]),
    ).toEqual({ ipv4: null, ipv6: null })
  })
})
