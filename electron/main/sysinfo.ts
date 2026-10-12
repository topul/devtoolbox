/**
 * 本机信息采集 —— 在主进程读 node:os 并执行只读系统命令（df / route）。
 *
 * 安全边界：
 *   - 全部参数都是硬编码常量，没有任何来自渲染层的字符串拼进命令行（无注入面）；
 *   - 命令只读：df / route / Get-CimInstance，不改任何系统状态；
 *   - 不联网：不查公网 IP，结果里只有网卡本地地址与默认网关；
 *   - 单项失败（如容器里没有 route）只记 warning，不影响其它信息返回。
 *
 * 输出解析全部走 src/lib/toolkit/sysinfo 的纯函数，本文件只负责取数。
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import {
  cpuUsage,
  parseDfPk,
  parseIpRoute,
  parseRouteGet,
  parseWindowsDisks,
  parseWindowsRoute,
  type CpuTimes,
} from '../../src/lib/toolkit/sysinfo'
import type {
  SysDisk,
  SysGateway,
  SysInfoResult,
  SysNetInterface,
} from '../../src/lib/sysinfo-types'

const SAMPLE_DELAY_MS = 400

function run(
  cmd: string,
  args: string[],
  timeoutMs = 8000,
): Promise<{ stdout: string; stderr: string; error: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error: err ? String(err.message ?? err) : '',
        })
      },
    )
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function snapshotCpu(): CpuTimes[] {
  return os.cpus().map((c) => {
    const t = c.times
    const total = t.user + t.nice + t.sys + t.irq + t.idle
    return { idle: t.idle, total }
  })
}

function listInterfaces(): SysNetInterface[] {
  const out: SysNetInterface[] = []
  const table = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(table)) {
    for (const a of addrs ?? []) {
      // IPv6 可能带 zone（fe80::1%en0），展示时去掉，网卡名本就在旁边
      const address = a.address.replace(/%.+$/, '')
      out.push({
        name,
        address,
        family: a.family === 'IPv6' ? 'IPv6' : 'IPv4',
        netmask: a.netmask,
        cidr: a.cidr,
        mac: a.mac,
        internal: a.internal,
      })
    }
  }
  return out
}

async function collectDisks(commands: string[], warnings: string[]): Promise<SysDisk[]> {
  if (process.platform === 'win32') {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,Size,FreeSpace,DriveType | ConvertTo-Csv -NoTypeInformation',
    ]
    commands.push('powershell Get-CimInstance Win32_LogicalDisk')
    const r = await run('powershell', args)
    if (r.error) warnings.push(`disk: ${r.error || r.stderr}`)
    return parseWindowsDisks(r.stdout)
  }
  commands.push('df -P -k')
  const r = await run('df', ['-P', '-k'])
  if (r.error) warnings.push(`disk: ${r.error || r.stderr}`)
  return parseDfPk(r.stdout)
}

async function collectGateway(commands: string[], warnings: string[]): Promise<SysGateway> {
  if (process.platform === 'win32') {
    commands.push('route print')
    const r = await run('route', ['print'])
    if (r.error) warnings.push(`gateway: ${r.error || r.stderr}`)
    return parseWindowsRoute(r.stdout)
  }

  if (process.platform === 'darwin') {
    commands.push('route -n get default')
    const [v4r, v6r] = await Promise.all([
      run('route', ['-n', 'get', 'default']),
      run('route', ['-n', 'get', '-inet6', 'default']),
    ])
    if (v4r.error) warnings.push(`gateway: ${v4r.error}`)
    const v4 = parseRouteGet(v4r.stdout)
    const v6 = parseRouteGet(v6r.stdout)
    return { ipv4: v4.gateway, ipv6: v6.gateway, iface: v4.iface ?? v6.iface }
  }

  // Linux：优先 iproute2 的 ip 命令
  commands.push('ip route show default')
  const [v4r, v6r] = await Promise.all([
    run('ip', ['-4', 'route', 'show', 'default']),
    run('ip', ['-6', 'route', 'show', 'default']),
  ])
  if (v4r.error && v6r.error) {
    warnings.push(`gateway: ${v4r.error || 'ip route unavailable'}`)
  }
  const v4 = parseIpRoute(v4r.stdout, 4)
  const v6 = parseIpRoute(v6r.stdout, 6)
  const dev = /\bdev\s+(\S+)/.exec(v4r.stdout)?.[1] ?? null
  return { ipv4: v4, ipv6: v6, iface: dev }
}

export async function collectSystemInfo(): Promise<SysInfoResult> {
  const commands: string[] = []
  const warnings: string[] = []

  try {
    const [user, before, after] = await Promise.all([
      // userInfo 在某些容器里可能因 pw 缺失抛错；放到 try 链里一起兜
      Promise.resolve().then(() => {
        try {
          return os.userInfo()
        } catch {
          return null
        }
      }),
      Promise.resolve(snapshotCpu()),
      sleep(SAMPLE_DELAY_MS).then(() => snapshotCpu()),
    ])

    const cpu = cpuUsage(before, after)
    const cpus = os.cpus()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const load = os.loadavg()

    const [disks, gateway, interfaces] = await Promise.all([
      collectDisks(commands, warnings),
      collectGateway(commands, warnings),
      Promise.resolve(listInterfaces()),
    ])

    return {
      ok: true,
      collectedAt: Date.now(),
      hostname: os.hostname(),
      platform: process.platform,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: os.version(),
      arch: os.arch(),
      machine: os.machine(),
      endianness: os.endianness(),
      uptimeSeconds: Math.floor(os.uptime()),
      username: user?.username ?? '',
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
      shell: user?.shell ?? null,
      cpu: {
        model: cpus[0]?.model?.trim() ?? '',
        cores: cpus.length,
        speedMhz: cpus[0]?.speed ?? 0,
        overallPercent: cpu.overallPercent,
        perCorePercent: cpu.perCorePercent,
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usedPercent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
      },
      loadAvg: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
      gateway,
      interfaces,
      disks,
      commands,
      warnings,
    }
  } catch (err) {
    return {
      ok: false,
      collectedAt: Date.now(),
      hostname: '',
      platform: process.platform,
      osType: '',
      osRelease: '',
      osVersion: '',
      arch: os.arch(),
      machine: os.machine(),
      endianness: os.endianness(),
      uptimeSeconds: 0,
      username: '',
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
      shell: null,
      cpu: { model: '', cores: 0, speedMhz: 0, overallPercent: 0, perCorePercent: [] },
      memory: { totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0 },
      loadAvg: [0, 0, 0],
      gateway: { ipv4: null, ipv6: null, iface: null },
      interfaces: [],
      disks: [],
      commands,
      warnings,
      error: (err as Error).message,
    }
  }
}
