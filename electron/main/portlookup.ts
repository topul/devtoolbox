/**
 * 端口占用查询 —— 主进程执行 lsof / netstat，渲染层只展示。
 *
 * 平台策略：
 *   - macOS / Linux：首选 lsof -nP -i :<port>（能同时给出进程名与 pid）；
 *     lsof 不在或权限不够时退回 netstat -an（只有地址与状态，没有进程）。
 *   - Windows：netstat -ano 过滤端口，再用 tasklist 按批把 pid 映射成进程名。
 */
import { execFile } from 'node:child_process'
import type { PortEntry, PortLookupResult } from '../../src/lib/portlookup-types'

function run(
  cmd: string,
  args: string[],
  timeoutMs = 8000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // lsof 查无结果时退出码非 0（exit 1），这不算错误，stdout 照样可用
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(err && !stdout ? (err as Error).message : (stderr ?? '')),
        })
      },
    )
  })
}

/** lsof 行：COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME [->FOREIGN] [(STATE)] */
function parseLsof(out: string): PortEntry[] {
  const entries: PortEntry[] = []
  for (const line of out.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 9) continue
    const nameField = cols[8]
    const rest = cols.slice(9).join(' ')
    const stateM = /\(([^)]+)\)/.exec(rest)
    // NAME 形如 `127.0.0.1:8080` 或 `127.0.0.1:8080->1.2.3.4:5678`
    const [local, foreign = '*:*'] = nameField.split('->')
    entries.push({
      pid: /^\d+$/.test(cols[1]) ? Number(cols[1]) : null,
      process: cols[0],
      proto: cols[7].replace(/[0-9]/g, '') || 'TCP',
      local,
      foreign,
      state: stateM ? stateM[1] : '',
    })
  }
  return entries
}

/** netstat -an 行（Linux/macos 兜底）：Proto Local Foreign State [PID/Name] */
function parseNetstat(out: string): PortEntry[] {
  const entries: PortEntry[] = []
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4 || !/^(tcp|udp)/i.test(cols[0])) continue
    const [proto, local, foreign, state, owner] = cols
    const ownerM = owner && /^\d+/.test(owner) ? /^(\d+)\/?(.*)$/.exec(owner) : null
    entries.push({
      pid: ownerM ? Number(ownerM[1]) : null,
      process: ownerM && ownerM[2] ? ownerM[2] : '',
      proto: proto.toUpperCase(),
      local,
      foreign,
      state: state || '',
    })
  }
  return entries
}

/** Windows：netstat -ano 行 + tasklist 批量映射 pid → 进程名 */
async function parseWindows(
  port: number,
): Promise<{ entries: PortEntry[]; command: string; error?: string }> {
  const command = `netstat -ano | findstr :${port}`
  const { stdout } = await run('netstat', ['-ano'])
  const entries: PortEntry[] = []
  for (const line of stdout.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || !/^(tcp|udp)$/i.test(cols[0])) continue
    const [proto, local, foreign, state, pidS] = cols
    // 注意 IPv6 嵌套端口如 [::]:8080，以及非本端口结尾匹配
    if (!new RegExp(`:(${port})$`).test(local)) continue
    entries.push({
      pid: /^\d+$/.test(pidS) ? Number(pidS) : null,
      process: '',
      proto: proto.toUpperCase(),
      local,
      foreign,
      state,
    })
  }
  const pids = [...new Set(entries.map((e) => e.pid).filter((p): p is number => p !== null))]
  // 端口占用场景 pid 通常 ≤ 5 个，逐个查够用
  for (const pid of pids) {
    const { stdout: one } = await run('tasklist', [
      '/FO',
      'CSV',
      '/NH',
      '/FI',
      `PID eq ${String(pid)}`,
    ])
    const name = /"([^"]+)"/.exec(one)?.[1]
    if (name) for (const e of entries) if (e.pid === pid) e.process = name
  }
  return { entries, command }
}

export async function lookupPort(port: number): Promise<PortLookupResult> {
  const p = Math.floor(port)
  const base: Pick<PortLookupResult, 'ok' | 'port'> = { ok: true, port: p }
  if (!Number.isFinite(p) || p < 0 || p > 65535) {
    return { ...base, ok: false, port: p, entries: [], command: '', error: 'INVALID_PORT' }
  }

  if (process.platform === 'win32') {
    const r = await parseWindows(p)
    return { ...base, entries: r.entries, command: r.command, error: r.error }
  }

  const args = ['-nP', '-i', `:${p}`]
  const lsof = await run('lsof', args)
  if (lsof.stdout.trim()) {
    return { ...base, entries: parseLsof(lsof.stdout), command: `lsof ${args.join(' ')}` }
  }
  // lsof 缺失（stderr 有 exec not found 类信息）才退 netstat；「无占用」直接返回空
  if (/not found|ENOENT|No such file/i.test(lsof.stderr)) {
    const ns = await run('netstat', ['-an'])
    const entries = parseNetstat(ns.stdout).filter((e) =>
      new RegExp(`:(\\[${p}\\]|${p})\\b`).test(e.local),
    )
    return { ...base, entries, command: 'netstat -an', error: ns.stderr.trim() || undefined }
  }
  return {
    ...base,
    entries: [],
    command: `lsof ${args.join(' ')}`,
    error: lsof.stderr.trim() || undefined,
  }
}
