/**
 * 本机信息采集的纯函数层 —— 不碰 node:os / child_process，只做解析与计算，
 * 主进程（electron/main/sysinfo.ts）负责取数，这里负责把命令输出变成结构化结果。
 *
 * 约定与其它 toolkit 模块一致：语言中立，只返回事实；双语由界面层映射。
 */
import type { SysDisk, SysGateway, SysNetInterface } from '../sysinfo-types'

export interface CpuTimes {
  idle: number
  total: number
}

export const clampPct = (n: number): number => {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/**
 * 由两次 os.cpus() 时间片快照计算占用率。
 * 入参是每核心的 {idle, total}（jiffies），返回每核心与总体百分比。
 */
export function cpuUsage(
  before: CpuTimes[],
  after: CpuTimes[],
): {
  overallPercent: number
  perCorePercent: number[]
} {
  const n = Math.min(before.length, after.length)
  if (n === 0) return { overallPercent: 0, perCorePercent: [] }
  const perCore: number[] = []
  let idleDelta = 0
  let totalDelta = 0
  for (let i = 0; i < n; i++) {
    const idle = after[i].idle - before[i].idle
    const total = after[i].total - before[i].total
    idleDelta += idle
    totalDelta += total
    perCore.push(total > 0 ? clampPct(((total - idle) / total) * 100) : 0)
  }
  return {
    overallPercent: totalDelta > 0 ? clampPct(((totalDelta - idleDelta) / totalDelta) * 100) : 0,
    perCorePercent: perCore,
  }
}

export interface UptimeParts {
  days: number
  hours: number
  minutes: number
  seconds: number
}

/** 秒数拆成 天/时/分/秒，界面层自己拼双语 */
export function uptimeParts(totalSeconds: number): UptimeParts {
  const s = Math.max(0, Math.floor(totalSeconds))
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  }
}

/**
 * 解析 POSIX `df -P -k` 输出（-P 保证每条记录单行，块大小 1024）。
 *
 *   Filesystem 1024-blocks Used Available Capacity Mounted on
 *   /dev/disk3s1s1  960000000 10000000 800000000    2% /
 *
 * 只保留真实块设备（/dev/ 开头），滤掉 tmpfs / overlay 等伪文件系统；
 * 挂载点可能含空格，因此 Capacity（必为数字%）之后的所有列拼回挂载点。
 */
export function parseDfPk(output: string): SysDisk[] {
  const disks: SysDisk[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line || !/^\/dev\//.test(line)) continue
    const cols = line.split(/\s+/)
    if (cols.length < 6) continue
    const fs = cols[0]
    const blocks1k = Number(cols[1])
    const used1k = Number(cols[2])
    const avail1k = Number(cols[3])
    const capMatch = /^(\d+)%$/.exec(cols[4])
    if (!capMatch || !Number.isFinite(blocks1k)) continue
    const mount = cols.slice(5).join(' ')
    const totalBytes = blocks1k * 1024
    const usedBytes = used1k * 1024
    const availBytes = avail1k * 1024
    disks.push({
      filesystem: fs,
      mount,
      totalBytes,
      usedBytes,
      availBytes,
      usedPercent: clampPct(Number(capMatch[1])),
    })
  }
  return disks
}

/**
 * 解析 Windows PowerShell CSV（ConvertTo-Csv -NoTypeInformation）：
 *   "C:","256000000000","120000000000","3"
 * 列序 DeviceID,Size,FreeSpace,DriveType；DriveType=3 是本地固定盘，
 * 其余（光驱 5、可移动 2、网络 4）忽略。引号与 CR 都做兼容。
 */
export function parseWindowsDisks(csv: string): SysDisk[] {
  const disks: SysDisk[] = []
  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || /^"?(DeviceID|#TYPE)/i.test(line)) continue
    const cols: string[] = []
    const re = /"([^"]*)"|([^,]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) cols.push((m[1] ?? m[2]).trim())
    if (cols.length < 4) continue
    const [device, sizeS, freeS, typeS] = cols
    if (Number(typeS) !== 3) continue
    const totalBytes = Number(sizeS)
    const freeBytes = Number(freeS)
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue
    const usedBytes = Math.max(0, totalBytes - freeBytes)
    disks.push({
      filesystem: device,
      mount: device,
      totalBytes,
      usedBytes,
      availBytes: Math.max(0, freeBytes),
      usedPercent: clampPct((usedBytes / totalBytes) * 100),
    })
  }
  return disks
}

/** macOS `route -n get default` / `route -n get -inet6 default` 输出 */
export function parseRouteGet(output: string): { gateway: string | null; iface: string | null } {
  let gateway: string | null = null
  let iface: string | null = null
  for (const line of output.split('\n')) {
    const gm = /^\s*gateway:\s*(\S+)/.exec(line)
    if (gm) gateway = gm[1]
    const im = /^\s*interface:\s*(\S+)/.exec(line)
    if (im) iface = im[1]
  }
  return { gateway, iface }
}

/** Linux `ip -4 route show default`（兼容多默认路由，取第一条） */
export function parseIpRoute(output: string, family: 4 | 6): string | null {
  for (const line of output.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('default')) continue
    const via = /\bvia\s+(\S+)/.exec(t)
    if (via && (family === 4 ? /^\d+\.\d+\.\d+\.\d+$/.test(via[1]) : via[1].includes(':'))) {
      return via[1]
    }
  }
  return null
}

/**
 * Windows `route print -4` / `-6`：取 0.0.0.0 默认路由的网关列。
 *   Network Destination Netmask Gateway Interface Metric
 *   0.0.0.0            0.0.0.0  192.168.1.1  192.168.1.5  25
 */
export function parseWindowsRoute(output: string): SysGateway {
  const g: SysGateway = { ipv4: null, ipv6: null, iface: null }
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] === '0.0.0.0' && cols[1] === '0.0.0.0' && cols[2] && cols[2] !== '0.0.0.0') {
      g.ipv4 = cols[2]
      g.iface = cols[3] || null
      break
    }
    if (cols[0] === '::/0' && cols[1] && cols[1] !== '::/0') {
      g.ipv6 = cols[1]
      if (!g.iface) g.iface = cols[2] || null
    }
  }
  return g
}

/**
 * 从网卡列表里挑「主 IP」：优先非内网的 IPv4，其次非内网 IPv6。
 * 顺序就是 os.networkInterfaces() 的枚举顺序（macOS 上通常 en0 在前）。
 */
export function pickPrimaryAddresses(ifaces: SysNetInterface[]): {
  ipv4: string | null
  ipv6: string | null
} {
  const external = ifaces.filter((i) => !i.internal)
  const v4 = external.find((i) => i.family === 'IPv4')
  const v6 = external.find((i) => i.family === 'IPv6' && !/^fe80:/i.test(i.address))
  return { ipv4: v4?.address ?? null, ipv6: v6?.address ?? null }
}
