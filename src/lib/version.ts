// App version helper.
// In Electron it comes from app.getVersion(); in the browser build it falls back
// to a hard-coded value.

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
