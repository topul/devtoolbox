/**
 * 应用自身信息类 IPC：版本号、外链打开、MCP 接入信息。
 * 返回的都是「应用跑在哪、怎么接」这类自描述数据，不依赖任何运行中的服务。
 */
import { app, ipcMain, shell } from 'electron'
import { homedir } from 'node:os'
import fs from 'node:fs'
import { buildClientConfig, configHints, resolveMcpLaunch } from '../mcp/paths'
import { safeExternalUrl } from '../../src/lib/external-link'
import type { McpInfo } from '../../src/lib/mcp-types'

export function setupAppIpc(): void {
  ipcMain.handle('app:get-version', () => app.getVersion())

  /**
   * 打开外链（对话里的 Markdown 链接）。
   * 链接来自模型输出，属于不可信输入 → 协议白名单在 `safeExternalUrl` 里，
   * 只放行 http/https/mailto，并且拒绝带账号密码的地址。
   */
  ipcMain.handle('app:open-external', async (_e, url: unknown): Promise<boolean> => {
    const safe = safeExternalUrl(url)
    if (!safe) return false
    try {
      await shell.openExternal(safe)
      return true
    } catch {
      return false
    }
  })

  /**
   * MCP 接入信息。
   *
   * 关键点：安装包里没有独立的 node，所以启动命令指向应用自身的可执行文件（process.execPath），
   * 再靠 ELECTRON_RUN_AS_NODE=1 让它以纯 Node 模式跑服务端脚本。
   * 路径由主进程在运行时算出来，界面只负责展示与复制 —— 不让用户自己去猜路径。
   */
  ipcMain.handle('mcp:info', (): McpInfo => {
    const launch = resolveMcpLaunch(
      {
        isPackaged: app.isPackaged,
        execPath: process.execPath,
        resourcesPath: process.resourcesPath,
        appRoot: app.getAppPath(),
      },
      (p) => {
        try {
          return fs.existsSync(p)
        } catch {
          return false
        }
      },
    )
    return {
      launch: {
        ...launch,
        configJson: buildClientConfig(launch),
        packaged: app.isPackaged,
        version: app.getVersion(),
      },
      hints: configHints(homedir(), process.platform),
    }
  })
}
