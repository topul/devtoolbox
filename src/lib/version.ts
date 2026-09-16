// 版本号管理工具
// 在 Electron 环境下通过 app.getVersion() 获取，Web 环境下使用硬编码版本

const FALLBACK_VERSION = '1.0.0'

export async function getVersion(): Promise<string> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      return await window.electronAPI.getVersion()
    } catch {
      return FALLBACK_VERSION
    }
  }
  return FALLBACK_VERSION
}
