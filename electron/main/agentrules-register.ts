/**
 * 「Agent 规则文件生成器」的 IPC 注册。
 *
 * 编排逻辑在 electron/main/agentrules-ipc.ts（依赖注入、不 import electron）；
 * 本文件提供真实宿主能力（选目录、写文件）并接到 ipcMain 上。
 */
import { app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import { createAgentRulesController } from './agentrules-ipc'
import { getMainWindow } from './window'
import type { AgentScanSpec, RulesTarget } from '../../src/lib/agentrules-types'

const agentRules = createAgentRulesController({
  defaultRoot: () => app.getPath('home'),
  pickDirectory: async (title) => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      // 对话框标题由渲染层给（主进程不留界面文案）
      ...(title ? { title } : {}),
    }
    const win = getMainWindow()
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  },
  writeFile: async (fullPath, content) => {
    try {
      await fs.promises.writeFile(fullPath, content, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export function setupAgentRulesIpc(): void {
  ipcMain.handle('agentrules:default-root', () => agentRules.defaultRoot())
  ipcMain.handle('agentrules:pick', (_e, title?: string) => agentRules.pick(title))
  ipcMain.handle('agentrules:scan', (_e, spec: AgentScanSpec) => agentRules.scan(spec))
  ipcMain.handle('agentrules:save', (_e, root: string, target: RulesTarget, content: string) =>
    agentRules.save(root, target, content),
  )
}
