/**
 * 系统代理开关（macOS / Windows / Linux）
 *
 * 抓包的前提是让系统流量走本机代理，而 Electron 自身的 session.setProxy 只作用于本应用，
 * 所以这里直接操作各平台的系统设置：
 *   - macOS：networksetup。**写操作需要管理员权限**（读不需要）：直接调用会返回
 *            `** Error: Command requires admin privileges.` exit=14。因此把整批命令写进临时脚本，
 *            用 osascript `do shell script … with administrator privileges` 一次授权执行，只弹一次密码框。
 *   - Windows：注册表 HKCU\...\Internet Settings（WinINET，覆盖 Edge/Chrome/系统组件）。写 HKCU 不需要提权，
 *              并尽力广播设置变更通知。
 *   - Linux：gsettings（GNOME），设置 http/https 代理与 manual 模式，无需 root。
 *
 * 接管前会把原始配置（含 bypass 列表）快照并落盘到 userData：
 *   - 退出/手动都能精确还原；
 *   - 「上次退出时没还原成功」也能在下次启动识别出来并提示还原。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SystemProxyState } from '../../src/lib/proxy-types'

const run = promisify(execFile)

/** 绝对路径：GUI 启动的进程 PATH 未必包含 /usr/sbin */
const NETWORKSETUP = '/usr/sbin/networksetup'

interface ProxyEndpoint {
  enabled: boolean
  server: string
  port: number
}

export interface MacServiceSnapshot {
  service: string
  web: ProxyEndpoint
  secure: ProxyEndpoint
  /** 空数组表示原本没有 bypass 列表 */
  bypass: string[]
}

interface Snapshot {
  platform: NodeJS.Platform
  createdAt: string
  /** 接管时使用的本机端口，用于判断当前系统代理是否指向本工具 */
  port: number
  mac?: MacServiceSnapshot[]
  win?: { proxyEnable: string; proxyServer: string; proxyOverride: string }
  linux?: { mode: string; httpHost: string; httpPort: string; httpsHost: string; httpsPort: string }
}

/** 无论系统代理指向哪里都要绕过的地址，避免把本机/内网流量也卷进来 */
export const REQUIRED_BYPASS = ['127.0.0.1', 'localhost', '*.local']

export function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** 生成接管系统代理的批处理命令（纯函数，便于单独校验引号与 bypass 合并） */
export function buildMacSetCommands(snapshots: MacServiceSnapshot[], host: string, port: number): string[] {
  const commands: string[] = []
  for (const s of snapshots) {
    commands.push(`${NETWORKSETUP} -setwebproxy ${shellQuote(s.service)} ${host} ${port}`)
    commands.push(`${NETWORKSETUP} -setsecurewebproxy ${shellQuote(s.service)} ${host} ${port}`)
    commands.push(`${NETWORKSETUP} -setwebproxystate ${shellQuote(s.service)} on`)
    commands.push(`${NETWORKSETUP} -setsecurewebproxystate ${shellQuote(s.service)} on`)
    const bypass = [...new Set([...s.bypass, ...REQUIRED_BYPASS])]
    commands.push(`${NETWORKSETUP} -setproxybypassdomains ${shellQuote(s.service)} ${bypass.map(shellQuote).join(' ')}`)
  }
  return commands
}

/** 生成还原批处理命令：server/port、开关状态、bypass 三个维度都要回到原样 */
export function buildMacRestoreCommands(snapshots: MacServiceSnapshot[]): string[] {
  const commands: string[] = []
  for (const s of snapshots) {
    commands.push(`${NETWORKSETUP} -setwebproxy ${shellQuote(s.service)} ${shellQuote(s.web.server || '0.0.0.0')} ${s.web.port || 0}`)
    commands.push(`${NETWORKSETUP} -setsecurewebproxy ${shellQuote(s.service)} ${shellQuote(s.secure.server || '0.0.0.0')} ${s.secure.port || 0}`)
    commands.push(`${NETWORKSETUP} -setwebproxystate ${shellQuote(s.service)} ${s.web.enabled ? 'on' : 'off'}`)
    commands.push(`${NETWORKSETUP} -setsecurewebproxystate ${shellQuote(s.service)} ${s.secure.enabled ? 'on' : 'off'}`)
    commands.push(`${NETWORKSETUP} -setproxybypassdomains ${shellQuote(s.service)} ${s.bypass.length ? s.bypass.map(shellQuote).join(' ') : `''`}`)
  }
  return commands
}

function emptyState(detail: string, supported = true): SystemProxyState {
  return { enabled: false, server: '', supported, managed: false, detail }
}

function isCanceled(message: string): boolean {
  return /cancel|User canceled|-128/i.test(message)
}

export class SystemProxyManager {
  private snapshot: Snapshot | null = null
  private snapshotFile: string

  constructor(snapshotFile: string) {
    this.snapshotFile = snapshotFile
    this.snapshot = this.loadSnapshot()
  }

  /* ================= 快照 ================= */

  private loadSnapshot(): Snapshot | null {
    try {
      if (!fs.existsSync(this.snapshotFile)) return null
      const parsed = JSON.parse(fs.readFileSync(this.snapshotFile, 'utf8')) as Snapshot
      return parsed && parsed.platform === process.platform ? parsed : null
    } catch {
      return null
    }
  }

  private saveSnapshot(snapshot: Snapshot): void {
    this.snapshot = snapshot
    try {
      fs.mkdirSync(path.dirname(this.snapshotFile), { recursive: true })
      fs.writeFileSync(this.snapshotFile, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
    } catch { /* 落盘失败不影响本次接管，只是下次启动认不出来 */ }
  }

  private clearSnapshot(): void {
    this.snapshot = null
    try { fs.rmSync(this.snapshotFile, { force: true }) } catch { /* ignore */ }
  }

  get isManaging(): boolean {
    return this.snapshot !== null
  }

  /* ================= 对外接口 ================= */

  async getState(): Promise<SystemProxyState> {
    try {
      if (process.platform === 'darwin') return await this.getMac()
      if (process.platform === 'win32') return await this.getWin()
      if (process.platform === 'linux') return await this.getLinux()
      return emptyState(`不支持的平台 ${process.platform}`, false)
    } catch (err) {
      return emptyState(`读取系统代理失败：${(err as Error).message}`)
    }
  }

  /** 把系统代理指向本机抓包端口 */
  async set(host: string, port: number): Promise<SystemProxyState> {
    const server = `${host}:${port}`
    try {
      if (process.platform === 'darwin') return await this.setMac(host, port, server)
      if (process.platform === 'win32') return await this.setWin(server)
      if (process.platform === 'linux') return await this.setLinux(host, port, server)
      return emptyState(`不支持的平台 ${process.platform}`, false)
    } catch (err) {
      const msg = (err as Error).message
      return {
        ...(await this.getState()),
        managed: this.isManaging,
        detail: isCanceled(msg) ? '已取消授权，系统代理未修改' : `设置系统代理失败：${msg}`,
      }
    }
  }

  /** 还原到接管之前的系统代理设置 */
  async restore(): Promise<SystemProxyState> {
    const snap = this.snapshot ?? this.loadSnapshot()
    if (!snap) {
      const cur = await this.getState()
      return { ...cur, managed: false, detail: '没有本工具留下的系统代理快照，无需还原' }
    }
    try {
      if (process.platform === 'darwin' && snap.mac) await this.restoreMac(snap.mac)
      else if (process.platform === 'win32' && snap.win) await this.restoreWin(snap.win)
      else if (process.platform === 'linux' && snap.linux) await this.restoreLinux(snap.linux)
      this.clearSnapshot()
      return { ...(await this.getState()), managed: false, detail: '已还原为接管前的系统代理设置' }
    } catch (err) {
      const msg = (err as Error).message
      return {
        ...(await this.getState()),
        managed: true,
        detail: isCanceled(msg) ? '已取消授权，系统代理保持原样' : `还原失败：${msg}`,
      }
    }
  }

  /* ================= macOS ================= */

  /** 提权执行一批命令（只弹一次密码框）；用户取消会抛错 */
  private async runElevated(commands: string[]): Promise<void> {
    const file = path.join(os.tmpdir(), `devtoolbox-proxy-${process.pid}-${Date.now()}.sh`)
    // 不用 set -e：单条失败（如某个网卡不支持 bypass）不应阻断其余命令，否则会「还原到一半」。
    // 失败用累加标记收集，最后以非零退出码回报给调用方。
    const body = commands.map((c) => `${c} || FAILED=1`).join('\n')
    fs.writeFileSync(file, `#!/bin/sh\nFAILED=0\n${body}\nexit $FAILED\n`, { mode: 0o700 })
    try {
      await run(
        'osascript',
        ['-e', `do shell script "/bin/sh ${shellQuote(file)}" with administrator privileges`],
        { timeout: 180_000 },
      )
    } finally {
      try { fs.rmSync(file, { force: true }) } catch { /* ignore */ }
    }
  }

  private async macServices(): Promise<string[]> {
    const { stdout } = await run(NETWORKSETUP, ['-listallnetworkservices'])
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('An asterisk') && !l.startsWith('*'))
  }

  private async macReadEndpoint(flag: string, service: string): Promise<ProxyEndpoint> {
    try {
      const { stdout } = await run(NETWORKSETUP, [flag, service])
      const val = (k: string): string => {
        const line = stdout.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(k.toLowerCase()))
        return line ? line.slice(line.indexOf(':') + 1).trim() : ''
      }
      return { enabled: val('Enabled').toLowerCase() === 'yes', server: val('Server'), port: Number(val('Port')) || 0 }
    } catch {
      return { enabled: false, server: '', port: 0 }
    }
  }

  private async macReadBypass(service: string): Promise<string[]> {
    try {
      const { stdout } = await run(NETWORKSETUP, ['-getproxybypassdomains', service])
      if (/there aren't any bypass domains/i.test(stdout)) return []
      return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  private async captureMac(): Promise<MacServiceSnapshot[]> {
    const out: MacServiceSnapshot[] = []
    for (const service of await this.macServices()) {
      out.push({
        service,
        web: await this.macReadEndpoint('-getwebproxy', service),
        secure: await this.macReadEndpoint('-getsecurewebproxy', service),
        bypass: await this.macReadBypass(service),
      })
    }
    return out
  }

  private async setMac(host: string, port: number, server: string): Promise<SystemProxyState> {
    const snapshots = await this.captureMac()
    if (!snapshots.length) return emptyState('未找到可设置代理的网卡服务')

    try {
      await this.runElevated(buildMacSetCommands(snapshots, host, port))
    } catch (err) {
      const msg = (err as Error).message
      return {
        ...(await this.getState()),
        managed: this.isManaging,
        detail: isCanceled(msg) ? '已取消授权，系统代理未修改' : `设置失败：${msg}`,
      }
    }

    this.saveSnapshot({ platform: 'darwin', createdAt: new Date().toISOString(), port, mac: snapshots })
    return { ...(await this.getState()), managed: true, detail: `${snapshots.length} 个网卡服务已指向 ${server}` }
  }

  private async restoreMac(snapshots: MacServiceSnapshot[]): Promise<void> {
    await this.runElevated(buildMacRestoreCommands(snapshots))
  }

  private async getMac(): Promise<SystemProxyState> {
    const services = await this.macServices()
    const snap = this.snapshot ?? this.loadSnapshot()
    const expected = snap ? `127.0.0.1:${snap.port}` : null
    const pointingHere: string[] = []
    let foreign: { service: string; server: string } | null = null

    for (const service of services) {
      const web = await this.macReadEndpoint('-getwebproxy', service)
      const endpoint = web.enabled ? web : await this.macReadEndpoint('-getsecurewebproxy', service)
      if (!endpoint.enabled || !endpoint.server) continue
      const server = `${endpoint.server}:${endpoint.port}`
      if (expected && server === expected) pointingHere.push(service)
      else if (!foreign) foreign = { service, server }
    }

    if (pointingHere.length && expected) {
      return {
        enabled: true,
        server: expected,
        supported: true,
        managed: true,
        detail: `${pointingHere.length} 个网卡服务已指向本工具（${pointingHere.join('、')}）—— 上次接管未还原，可点「取消系统代理」还原`,
      }
    }
    if (foreign) {
      return {
        enabled: true,
        server: foreign.server,
        supported: true,
        managed: false,
        detail: `${foreign.service} 已启用代理 ${foreign.server}，由其它工具设置（本工具不会改动它）`,
      }
    }
    return {
      enabled: false,
      server: '',
      supported: true,
      managed: false,
      detail: snap ? '未检测到系统代理（本工具留有快照，可点「取消系统代理」清理）' : '未检测到系统代理',
    }
  }

  /* ================= Windows ================= */

  private async setWin(server: string): Promise<SystemProxyState> {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const read = async (v: string): Promise<string> => {
      try {
        const { stdout } = await run('reg', ['query', key, '/v', v])
        const line = stdout.split(/\r?\n/).find((l) => l.includes(v))
        return line ? line.trim().split(/\s{2,}/).pop() ?? '' : ''
      } catch {
        return ''
      }
    }
    if (!this.isManaging) {
      this.saveSnapshot({
        platform: 'win32',
        createdAt: new Date().toISOString(),
        port: Number(server.split(':').pop()) || 0,
        win: {
          proxyEnable: await read('ProxyEnable'),
          proxyServer: await read('ProxyServer'),
          proxyOverride: await read('ProxyOverride'),
        },
      })
    }

    await run('reg', ['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'])
    await run('reg', ['add', key, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', server, '/f'])
    try {
      await run('reg', ['add', key, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', 'localhost;127.*;<local>', '/f'])
    } catch { /* 可选 */ }

    const detail = ['已写入 WinINET 代理设置']
    try {
      await run('powershell', ['-NoProfile', '-Command',
        "Add-Type -Namespace Win32 -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"wininet.dll\", SetLastError=true)] public static extern bool InternetSetOption(System.IntPtr h, int o, System.IntPtr b, int l);'; [Win32.Native]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0) | Out-Null; [Win32.Native]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0) | Out-Null",
      ])
      detail.push('已广播设置变更')
    } catch {
      detail.push('未广播变更（已启动的程序需重启后生效）')
    }
    return { ...(await this.getWin()), managed: true, detail: detail.join('；') }
  }

  private async restoreWin(win: NonNullable<Snapshot['win']>): Promise<void> {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    await run('reg', ['add', key, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', win.proxyServer, '/f'])
    await run('reg', ['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', win.proxyEnable === '0x1' ? '1' : '0', '/f'])
    if (win.proxyOverride) {
      await run('reg', ['add', key, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', win.proxyOverride, '/f'])
    }
  }

  private async getWin(): Promise<SystemProxyState> {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    try {
      const { stdout } = await run('reg', ['query', key])
      const find = (v: string): string => {
        const line = stdout.split(/\r?\n/).find((l) => l.includes(v))
        return line ? line.trim().split(/\s{2,}/).pop() ?? '' : ''
      }
      const on = find('ProxyEnable') === '0x1'
      const server = find('ProxyServer')
      const snap = this.snapshot ?? this.loadSnapshot()
      const managed = on && !!snap && Number(server.split(':').pop()) === snap.port
      return {
        enabled: on,
        server: on ? server : '',
        supported: true,
        managed,
        detail: on ? (managed ? 'WinINET 代理已指向本工具' : 'WinINET 代理已启用（非本工具设置）') : '未检测到系统代理',
      }
    } catch {
      return emptyState('无法读取注册表代理设置')
    }
  }

  /* ================= Linux ================= */

  private async setLinux(host: string, port: number, server: string): Promise<SystemProxyState> {
    const get = async (schema: string, key: string): Promise<string> => {
      try {
        const { stdout } = await run('gsettings', ['get', schema, key])
        return stdout.trim().replace(/'/g, '')
      } catch {
        return ''
      }
    }
    if (!this.isManaging) {
      this.saveSnapshot({
        platform: 'linux',
        createdAt: new Date().toISOString(),
        port,
        linux: {
          mode: await get('org.gnome.system.proxy', 'mode'),
          httpHost: await get('org.gnome.system.proxy.http', 'host'),
          httpPort: await get('org.gnome.system.proxy.http', 'port'),
          httpsHost: await get('org.gnome.system.proxy.https', 'host'),
          httpsPort: await get('org.gnome.system.proxy.https', 'port'),
        },
      })
    }
    await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', `'${host}'`])
    await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(port)])
    await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', `'${host}'`])
    await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(port)])
    await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual'])
    return { ...(await this.getLinux()), managed: true, detail: `GNOME 代理已设为 ${server}` }
  }

  private async restoreLinux(linux: NonNullable<Snapshot['linux']>): Promise<void> {
    if (linux.mode === 'manual') {
      await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', `'${linux.httpHost}'`])
      await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', linux.httpPort])
      await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', `'${linux.httpsHost}'`])
      await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', linux.httpsPort])
      await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual'])
    } else {
      await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none'])
    }
  }

  private async getLinux(): Promise<SystemProxyState> {
    try {
      const { stdout } = await run('gsettings', ['get', 'org.gnome.system.proxy', 'mode'])
      const mode = stdout.trim().replace(/'/g, '')
      if (mode !== 'manual') {
        return { enabled: false, server: '', supported: true, managed: false, detail: `GNOME 代理模式：${mode}` }
      }
      const host = (await run('gsettings', ['get', 'org.gnome.system.proxy.http', 'host'])).stdout.trim().replace(/'/g, '')
      const port = (await run('gsettings', ['get', 'org.gnome.system.proxy.http', 'port'])).stdout.trim()
      const snap = this.snapshot ?? this.loadSnapshot()
      const managed = !!snap && host === '127.0.0.1' && port === String(snap.port)
      return { enabled: true, server: `${host}:${port}`, supported: true, managed, detail: 'GNOME 代理已设 manual' }
    } catch {
      return emptyState('当前桌面环境不支持 gsettings', false)
    }
  }
}
