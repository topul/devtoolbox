/**
 * docker run → docker-compose 转换 —— 渲染进程与 MCP 服务端共用，零依赖。
 *
 * 解析刻意「宽松」：不在已知表里的 flag 直接丢掉而不报错（docker CLI 的 flag
 * 太多，逐个报错会让整条命令没法用）；而「带值 flag」只认已知表内的 ——
 * 未知 flag 若也去吞下一个 token，会把 image 吃掉，比少映射一个选项糟糕得多。
 * YAML 手写而非用 js-yaml：compose 需要的子集就是映射 + 列表，手写还能完全
 * 控制缩进与引号风格（含特殊字符一律单引号，内部单引号翻倍转义）。
 */

export interface ComposeService {
  image?: string
  containerName?: string
  restart?: string
  user?: string
  workingDir?: string
  hostname?: string
  privileged?: boolean
  entrypoint?: string
  /** KEY=VALUE 映射，生成时输出为 `- KEY=VALUE` 列表风格 */
  environment?: Record<string, string>
  envFile?: string[]
  ports?: string[]
  volumes?: string[]
  devices?: string[]
  capAdd?: string[]
  networks?: string[]
  /** 尾部命令保留 token 数组：sh -c "…" 的分组信息在生成时按列表输出 */
  command?: string[]
}

export interface ComposeServiceEntry {
  name: string
  image: string
  service: ComposeService
}

export type ParseDockerRunResult = { service: ComposeService; image: string } | { error: string }

/** 带值的长/短 flag：已知表的才去吞下一个 token（表外未映射的照吞值但不落字段） */
const VALUE_FLAGS = new Set([
  '--name',
  '--publish',
  '--volume',
  '--mount',
  '--env',
  '--env-file',
  '--network',
  '--net',
  '--restart',
  '--user',
  '--workdir',
  '--hostname',
  '--cap-add',
  '--cap-drop',
  '--device',
  '--entrypoint',
  '--label',
  '--memory',
  '--cpus',
  '--pull',
  '--platform',
  '--ip',
  '--dns',
  '--add-host',
  '--log-driver',
  '--log-opt',
  '--health-cmd',
  '--tmpfs',
  '--pid',
  '--ipc',
  '--shm-size',
  '--stop-signal',
  '--stop-timeout',
  '--ulimit',
  '--security-opt',
  '--group-add',
  '--sysctl',
  '--storage-opt',
  '--memory-swap',
  '--cpu-shares',
  '--runtime',
  '--cidfile',
  '--detach-keys',
  '--attach',
])
/** 无值长 flag：见一个丢一个 */
const BOOL_FLAGS = new Set([
  '--rm',
  '--init',
  '--interactive',
  '--tty',
  '--detach',
  '--quiet',
  '--no-healthcheck',
  '--oom-kill-disable',
  '--read-only',
  '--publish-all',
])
/** 无值短 flag，可组合（-it / -dti） */
const SHORT_BOOL = new Set(['d', 'i', 't', 'q', 'P'])
/** 带值短 flag */
const SHORT_VALUE = new Set(['p', 'v', 'e', 'u', 'w', 'h', 'm', 'l', 'a'])

export function parseDockerRun(cmd: string): ParseDockerRunResult {
  const tokens = tokenize(cmd)
  // 兼容粘贴完整命令：sudo / docker / container / run 前缀逐个剥掉
  while (tokens.length > 0 && ['sudo', 'docker', 'container', 'run'].includes(tokens[0])) {
    tokens.shift()
  }

  const svc: ComposeService = {}
  const env: Record<string, string> = {}
  const command: string[] = []
  let image: string | undefined

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // 第一个非 flag token 是 image，其后全部归入尾部 command
    if (image !== undefined) {
      command.push(t)
      continue
    }

    if (t.startsWith('--')) {
      const [flag, inlineVal] = splitFirst(t, '=')
      if (BOOL_FLAGS.has(flag) && inlineVal === undefined) continue
      if (VALUE_FLAGS.has(flag)) {
        const val = inlineVal ?? tokens[i + 1]
        if (val !== undefined) {
          applyValue(flag, val, svc, env)
          if (inlineVal === undefined) i += 1
        }
        continue
      }
      if (flag === '--privileged') {
        // --privileged 本体在 BOOL 表里，带 = 值的写法落到这里
        svc.privileged = inlineVal !== 'false'
        continue
      }
      // 未知长 flag：只丢 flag 本身，不吞下一个 token，避免把 image 吃掉
      continue
    }

    if (t.startsWith('-') && t.length > 1) {
      const eq = t.indexOf('=')
      const body = t.slice(1, eq === -1 ? undefined : eq)
      if (eq === -1 && [...body].every((c) => SHORT_BOOL.has(c))) continue
      if (body.length === 1 && SHORT_VALUE.has(body)) {
        const val = eq === -1 ? tokens[i + 1] : t.slice(eq + 1)
        if (val !== undefined) {
          applyValue('-' + body, val, svc, env)
          if (eq === -1) i += 1
        }
        continue
      }
      continue
    }

    image = t
  }

  if (image === undefined) {
    return { error: '未能解析出镜像名：命令里必须包含镜像（如 nginx:1.25-alpine）。' }
  }
  if (Object.keys(env).length > 0) svc.environment = env
  if (command.length > 0) svc.command = command
  svc.image = image
  return { service: svc, image }
}

/** 引号感知的分词：引号剥掉并与相邻字符并成一个 token（--name="my app" → 一个 token） */
function tokenize(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of cmd) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur !== '') {
        out.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur !== '') out.push(cur)
  return out
}

function applyValue(
  flag: string,
  val: string,
  svc: ComposeService,
  env: Record<string, string>,
): void {
  switch (flag) {
    case '--name':
      svc.containerName = val
      break
    case '-p':
    case '--publish':
      svc.ports = addList(svc.ports, val)
      break
    case '-v':
    case '--volume':
      svc.volumes = addList(svc.volumes, val)
      break
    case '--mount': {
      const v = parseMount(val)
      if (v) svc.volumes = addList(svc.volumes, v)
      break
    }
    case '-e':
    case '--env': {
      const [k, v] = splitFirst(val, '=')
      if (k) env[k] = v ?? ''
      break
    }
    case '--env-file':
      svc.envFile = addList(svc.envFile, val)
      break
    case '--network':
    case '--net':
      for (const n of val.split(',')) if (n.trim()) svc.networks = addList(svc.networks, n.trim())
      break
    case '--restart':
      svc.restart = val
      break
    case '-u':
    case '--user':
      svc.user = val
      break
    case '-w':
    case '--workdir':
      svc.workingDir = val
      break
    case '-h':
    case '--hostname':
      svc.hostname = val
      break
    case '--cap-add':
      svc.capAdd = addList(svc.capAdd, val)
      break
    case '--device':
      svc.devices = addList(svc.devices, val)
      break
    case '--entrypoint':
      svc.entrypoint = val
      break
    default:
      break // 其余已知 flag（memory/label/pull…）compose 无对应或暂不映射，吞掉即可
  }
}

/** --mount 宽松解析：只取 source/src、target/dst/destination、readonly/ro */
function parseMount(v: string): string | null {
  const parts: Record<string, string> = {}
  for (const kv of v.split(',')) {
    const [k, val] = splitFirst(kv.trim(), '=')
    if (k) parts[k] = val ?? ''
  }
  const dst = parts.target ?? parts.dst ?? parts.destination
  if (dst === undefined) return null
  const src = parts.source ?? parts.src
  const ro = parts.readonly !== undefined || parts.ro !== undefined
  return src !== undefined ? `${src}:${dst}${ro ? ':ro' : ''}` : dst
}

function addList(list: string[] | undefined, v: string): string[] {
  const out = list ?? []
  out.push(v)
  return out
}

function splitFirst(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep)
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + sep.length)]
}

/* ---------- YAML 生成 ---------- */

export function toComposeYaml(services: ComposeServiceEntry[]): string {
  if (services.length === 0) return 'services: {}\n'
  const lines: string[] = ['services:']
  for (const { name, image, service } of services) {
    lines.push(`  ${yamlKey(name)}:`)
    const s = { ...service, image } // 外部显式传入的 image 优先于 service.image
    if (s.image) lines.push(`    image: ${yamlScalar(s.image)}`)
    if (s.containerName) lines.push(`    container_name: ${yamlScalar(s.containerName)}`)
    if (s.restart) lines.push(`    restart: ${yamlScalar(s.restart)}`)
    if (s.user) lines.push(`    user: ${yamlScalar(s.user)}`)
    if (s.workingDir) lines.push(`    working_dir: ${yamlScalar(s.workingDir)}`)
    if (s.hostname) lines.push(`    hostname: ${yamlScalar(s.hostname)}`)
    if (s.privileged) lines.push('    privileged: true')
    if (s.entrypoint) lines.push(`    entrypoint: ${yamlScalar(s.entrypoint)}`)
    if (s.environment && Object.keys(s.environment).length > 0) {
      lines.push('    environment:')
      for (const [k, v] of Object.entries(s.environment)) {
        lines.push(`      - ${yamlScalar(`${k}=${v}`)}`)
      }
    }
    emitList(lines, 'env_file', s.envFile)
    emitList(lines, 'ports', s.ports)
    emitList(lines, 'volumes', s.volumes)
    emitList(lines, 'devices', s.devices)
    emitList(lines, 'cap_add', s.capAdd)
    emitList(lines, 'networks', s.networks)
    if (s.command && s.command.length > 0) {
      if (s.command.length === 1) lines.push(`    command: ${yamlScalar(s.command[0])}`)
      else emitList(lines, 'command', s.command)
    }
  }
  return lines.join('\n') + '\n'
}

function emitList(lines: string[], key: string, values: string[] | undefined): void {
  if (!values || values.length === 0) return
  lines.push(`    ${key}:`)
  for (const v of values) lines.push(`      - ${yamlScalar(v)}`)
}

/** YAML 标量：含空格或有歧义风险的包单引号，内部单引号翻倍；空串用 '' */
function yamlScalar(s: string): string {
  if (s === '') return "''"
  // 有意保守：`a: b`（冒号+空格）、` #` 注释、行首指示符等才需要引号；
  // nginx:1.25、8080:80、./a:/b 这类中间无空格的冒号是合法 plain scalar，不强加引号
  const needsQuote = /\s/.test(s) || /(:\s|\s#|^#|:$)/.test(s) || /^[&*!|>%@`'"?\-[\]{},]/.test(s)
  return needsQuote ? `'${s.replace(/'/g, "''")}'` : s
}

/** 服务名 key 常规就是字母数字/点/横线/下划线，其余同样加引号保险 */
function yamlKey(name: string): string {
  return /^[\w.-]+$/.test(name) ? name : yamlScalar(name)
}
