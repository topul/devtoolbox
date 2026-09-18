/**
 * MCP 启动配置生成 —— 主进程用，界面把结果作为可粘贴的 JSON 片段展示。
 *
 * 关键点：安装包里没有独立的 node 可执行文件。因此 `command` 指向应用自身的可执行文件，
 * 并用 `ELECTRON_RUN_AS_NODE=1` 让它以纯 Node 模式运行脚本 —— 这是 Electron 官方支持的做法，
 * 也是唯一不依赖用户机器上已装 node 的方案。
 */
import path from 'node:path'

export interface McpLaunch {
  /** MCP 服务端脚本在该机器上的绝对路径 */
  serverPath: string
  /** 客户端要 spawn 的可执行文件 */
  command: string
  args: string[]
  env: Record<string, string>
  /** 该路径当前是否真实存在（界面据此给出红色警示） */
  serverPathExists: boolean
}

export interface ResolveOptions {
  isPackaged: boolean
  /** process.execPath */
  execPath: string
  /** process.resourcesPath */
  resourcesPath: string
  /** 开发态项目根目录 */
  appRoot: string
  /** 产物文件名 */
  serverFile?: string
}

export const MCP_SERVER_FILE = 'devtoolbox-mcp.cjs'

export function resolveMcpLaunch(opts: ResolveOptions, exists: (p: string) => boolean): McpLaunch {
  const file = opts.serverFile ?? MCP_SERVER_FILE
  const serverPath = opts.isPackaged
    ? path.join(opts.resourcesPath, 'mcp', file)
    : path.join(opts.appRoot, 'out', 'mcp', file)
  return {
    serverPath,
    command: opts.execPath,
    args: [serverPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    serverPathExists: exists(serverPath),
  }
}

/** 生成 mcpServers 结构：Claude Desktop / Cursor / WorkBuddy 等客户端通用 */
export function buildClientConfig(launch: McpLaunch, key = 'devtoolbox'): string {
  return JSON.stringify(
    {
      mcpServers: {
        [key]: {
          command: launch.command,
          args: launch.args,
          env: launch.env,
        },
      },
    },
    null,
    2,
  )
}

/**
 * 常见客户端的配置文件位置（仅供界面提示，不做写入）。
 * 只回传「客户端名 + 路径」，描述文案由渲染层按语言渲染 —— 主进程不该持有界面文案。
 */
export interface ConfigHint {
  client: string
  path: string
}

export function configHints(home: string, platform: NodeJS.Platform): ConfigHint[] {
  const hints: ConfigHint[] = []
  if (platform === 'darwin') {
    hints.push({
      client: 'Claude Desktop',
      path: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    })
  } else if (platform === 'win32') {
    hints.push({
      client: 'Claude Desktop',
      path: path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'),
    })
  } else {
    hints.push({
      client: 'Claude Desktop',
      path: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    })
  }
  hints.push({ client: 'Cursor', path: path.join(home, '.cursor', 'mcp.json') })
  hints.push({ client: 'WorkBuddy', path: path.join(home, '.workbuddy', 'mcp.json') })
  return hints
}
