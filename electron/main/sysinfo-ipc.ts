/**
 * 本机信息 IPC：渲染进程通过 system.info() 取一次系统快照。
 * 采集本身有 ~400ms 的 CPU 采样间隔，且全是本地只读操作，所以每次请求现取、不缓存。
 */
import { ipcMain } from 'electron'
import { collectSystemInfo } from './sysinfo'
import type { SysInfoResult } from '../../src/lib/sysinfo-types'

export function setupSysInfoIpc(): void {
  ipcMain.handle('system:info', async (): Promise<SysInfoResult> => {
    return collectSystemInfo()
  })
}
