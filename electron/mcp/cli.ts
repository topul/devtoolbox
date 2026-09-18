/**
 * devtoolbox-mcp 命令行入口。
 *
 * 三种用法：
 *   1. 无参数                → 作为 MCP 服务端跑 stdio 传输（客户端 spawn 这个进程）
 *   2. `--list`              → 打印全部可用工具（给人看，或让脚本自行拼参数）
 *   3. `--call <tool> <json>`→ 直接调一次工具，结果打到 stdout（终端 / 脚本 / Agent 的 shell 用）
 *
 * 铁律：stdout 只允许出现协议消息，一切诊断信息走 stderr。
 * 否则客户端解析 JSON-RPC 会因为多了一行日志直接崩掉。
 */
import readline from 'node:readline'
import { MCP_TOOLS, MCP_GROUPS, toProtocolTools } from '../../src/lib/mcp-catalog'
import { callTool, encodeMessage, handleMessage, LATEST_PROTOCOL, SERVER_NAME, type ServerMeta } from './server'

// 版本号由构建脚本用 esbuild --define 注入，避免为了读 package.json 打开 resolveJsonModule
const VERSION = process.env.DTB_VERSION ?? 'dev'

const META: ServerMeta = { name: SERVER_NAME, version: VERSION }

function log(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(' ') + '\n')
}

function printHelp(): void {
  process.stdout.write(
    [
      `devtoolbox-mcp ${VERSION}  —  DevOps Toolbox 的 MCP 能力端`,
      '',
      '用法:',
      '  devtoolbox-mcp                  以 MCP stdio 服务端运行（供 AI 客户端接入）',
      '  devtoolbox-mcp --list           列出全部工具及参数',
      '  devtoolbox-mcp --tools-json     以 MCP tools/list 结构输出 JSON',
      '  devtoolbox-mcp --call <工具> [JSON参数]',
      '                                  直接调用某个工具，结果打到 stdout',
      '  devtoolbox-mcp --help           显示本帮助',
      '',
      `协议版本: ${LATEST_PROTOCOL}`,
      `工具数量: ${MCP_TOOLS.length}`,
      '',
    ].join('\n'),
  )
}

function printList(): void {
  const lines: string[] = [`共 ${MCP_TOOLS.length} 个工具`, '']
  for (const g of MCP_GROUPS) {
    const items = MCP_TOOLS.filter((t) => t.group === g)
    if (!items.length) continue
    lines.push(`[${g}]`)
    for (const t of items) {
      const params = Object.entries(t.inputSchema.properties)
        .map(([k, v]) => (t.inputSchema.required?.includes(k) ? k : `${k}?`))
        .join(', ')
      lines.push(`  ${t.name}(${params})`)
      lines.push(`      ${t.description}`)
    }
    lines.push('')
  }
  process.stdout.write(lines.join('\n') + '\n')
}

async function runCall(argv: string[]): Promise<number> {
  const name = argv[0]
  if (!name) {
    log('错误: --call 需要指定工具名')
    return 2
  }
  let args: Record<string, unknown> = {}
  if (argv[1]) {
    try {
      args = JSON.parse(argv[1]) as Record<string, unknown>
    } catch (e) {
      log('错误: 参数不是合法 JSON — ' + (e as Error).message)
      return 2
    }
  }
  try {
    process.stdout.write((await callTool(name, args)) + '\n')
    return 0
  } catch (e) {
    log('执行失败: ' + (e as Error).message)
    return 1
  }
}

function runStdioServer(): void {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  // 串行处理并写入：既保证响应顺序与请求一致，也避免两个大响应同时写 stdout 时交错
  let chain: Promise<void> = Promise.resolve()
  let closed = false

  rl.on('line', (line) => {
    const raw = line.trim()
    if (!raw) return
    chain = chain
      .then(() => handleMessage(raw, META))
      .then((res) => {
        if (res) process.stdout.write(encodeMessage(res) + '\n')
      })
      .catch((e: unknown) => {
        log('内部错误: ' + (e as Error).message)
      })
  })

  rl.on('close', () => {
    closed = true
    void chain.then(() => {
      if (closed) process.exit(0)
    })
  })

  // 客户端异常退出时管道会断，静默收场即可，别把栈打到 stderr 吓人
  process.stdin.on('error', () => process.exit(0))
  process.stdout.on('error', () => process.exit(0))
}

/** 返回退出码；返回 null 表示「服务端已启动，不要退出进程」 */
async function main(): Promise<number | null> {
  const argv = process.argv.slice(2)
  const first = argv[0]

  if (first === '--help' || first === '-h') {
    printHelp()
    return 0
  }
  if (first === '--version' || first === '-v') {
    process.stdout.write(VERSION + '\n')
    return 0
  }
  if (first === '--list') {
    printList()
    return 0
  }
  if (first === '--tools-json') {
    process.stdout.write(JSON.stringify({ tools: toProtocolTools() }, null, 2) + '\n')
    return 0
  }
  if (first === '--call') {
    return runCall(argv.slice(1))
  }
  if (first && first.startsWith('-')) {
    log(`未知参数: ${first}（用 --help 看用法）`)
    return 2
  }

  log(`${SERVER_NAME}-mcp ${VERSION} 已就绪，工具 ${MCP_TOOLS.length} 个，协议 ${LATEST_PROTOCOL}`)
  runStdioServer()
  return null
}

void main().then((code) => {
  if (code !== null) process.exit(code)
})
