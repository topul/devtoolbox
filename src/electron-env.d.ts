// Electron bridge types, as seen from the renderer process

export interface UpdaterEvent {
  type: 'checking' | 'available' | 'progress' | 'downloaded' | 'none' | 'error'
  version?: string
  percent?: number
}

export interface ElectronAPI {
  getVersion: () => Promise<string>
  getTheme: () => Promise<'dark' | 'light'>
  setTheme: (theme: 'dark' | 'light' | 'system') => Promise<'dark' | 'light'>
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => void
  checkForUpdates: () => Promise<void>
  quitAndInstall: () => Promise<void>
  onUpdaterEvent: (callback: (evt: UpdaterEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
