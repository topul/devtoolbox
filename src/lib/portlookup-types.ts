/**
 * 端口占用查询的 IPC 契约 —— 主进程与渲染进程共用。
 *
 * 「这个端口被谁占了」是本地排障高频动作，必须查到进程名/_pid 才有用，
 * 所以查询在主进程执行（lsof / netstat），渲染层只展示结果。
 * 改动这里等于改 IPC 协议，preload 与 electron/main/portlookup.ts 需同步。
 */

export interface PortEntry {
  /** 进程 id；权限不足拿不到时为 null */
  pid: number | null
  /** 进程名；同上 */
  process: string
  /** TCP / UDP */
  proto: string
  /** 本地地址，如 127.0.0.1:8080 */
  local: string
  /** 对端地址，监听时通常是 *:* */
  foreign: string
  /** LISTEN / ESTABLISHED / …（Windows 是 LISTENING，原样保留） */
  state: string
}

export interface PortLookupResult {
  ok: boolean
  port: number
  entries: PortEntry[]
  /** 实际执行的命令（透明可核） */
  command: string
  /** lsof/netstat 缺失或执行失败时给出原因 */
  error?: string
}
