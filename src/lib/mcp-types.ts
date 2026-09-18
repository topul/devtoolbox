/**
 * MCP 面板的类型契约 —— 主进程与渲染进程共用。
 * 主进程侧 `electron/mcp/paths.ts` 与 `electron/main/index.ts` 实现，preload 透传给界面。
 */

export interface McpLaunchInfo {
  /** 服务端脚本在该机器上的绝对路径 */
  serverPath: string
  /** 客户端要 spawn 的可执行文件 */
  command: string
  args: string[]
  env: Record<string, string>
  /** 脚本是否真实存在（false 表示还没构建，配置粘过去也起不来） */
  serverPathExists: boolean
  /** 可直接粘贴的 mcpServers 配置片段 */
  configJson: string
  packaged: boolean
  version: string
}

export interface McpConfigHint {
  client: string
  /** 配置文件在该机器上的路径；说明文案由界面按语言渲染 */
  path: string
}

export interface McpInfo {
  launch: McpLaunchInfo
  hints: McpConfigHint[]
}
