/**
 * 本机信息的 IPC 契约 —— 主进程与渲染进程共用。
 *
 * 「我的 IP / 系统版本 / CPU 内存磁盘占用」这类信息只能在主进程取
 * （渲染进程没有 node:os，也不能执行 df / route），渲染层只负责展示。
 * 改动这里等于改 IPC 协议，preload 与 electron/main/sysinfo.ts 需同步。
 *
 * 数据来源全部是本地只读 API 与只读系统命令（df / route / Get-CimInstance），
 * 不发起任何网络请求，也不读取命令行参数之外的任何用户文件。
 */

export interface SysNetInterface {
  /** 网卡名，如 en0 / eth0 / WLAN */
  name: string
  /** IP 字面量（IPv6 去掉 zone 后缀） */
  address: string
  family: 'IPv4' | 'IPv6'
  netmask: string
  /** 如 192.168.1.5/24；算不出前缀长度时为 null */
  cidr: string | null
  mac: string
  /** true = 回环等内部接口 */
  internal: boolean
}

export interface SysDisk {
  /** 设备/文件系统名，如 /dev/disk3s1s1、C: */
  filesystem: string
  /** 挂载点（Windows 即盘符） */
  mount: string
  totalBytes: number
  usedBytes: number
  availBytes: number
  /** 0-100，已用百分比 */
  usedPercent: number
}

export interface SysGateway {
  ipv4: string | null
  ipv6: string | null
  /** 出口网卡名（拿得到时） */
  iface: string | null
}

export interface SysInfoResult {
  ok: boolean
  /** 采集时刻（epoch ms） */
  collectedAt: number

  /* ---------------- 系统 ---------------- */
  hostname: string
  /** process.platform：darwin / win32 / linux … */
  platform: string
  /** os.type()：Darwin / Windows_NT / Linux */
  osType: string
  osRelease: string
  /** os.version()：内核版本（Windows 上是内部版本号） */
  osVersion: string
  arch: string
  machine: string
  endianness: 'BE' | 'LE'
  uptimeSeconds: number
  username: string
  homedir: string
  tmpdir: string
  shell: string | null

  /* ---------------- 资源 ---------------- */
  cpu: {
    model: string
    /** 逻辑核心数 */
    cores: number
    speedMhz: number
    /** 0-100，采样间隔内的总体占用 */
    overallPercent: number
    /** 每逻辑核心 0-100 */
    perCorePercent: number[]
  }
  memory: {
    totalBytes: number
    freeBytes: number
    usedBytes: number
    /** 0-100 */
    usedPercent: number
  }
  /** 1/5/15 分钟平均负载；Windows 恒为 [0,0,0] */
  loadAvg: [number, number, number]

  /* ---------------- 网络与磁盘 ---------------- */
  gateway: SysGateway
  interfaces: SysNetInterface[]
  disks: SysDisk[]

  /** 实际用到的系统命令（透明可核，与 port-lookup 一致） */
  commands: string[]
  /** 单项采集失败不致命，错误累积在这里（如 df 缺失时磁盘列表为空） */
  warnings: string[]
  error?: string
}
