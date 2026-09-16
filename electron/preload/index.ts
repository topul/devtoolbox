import { contextBridge, ipcRenderer } from 'electron'

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

const api: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme:changed', (_event, theme) => callback(theme))
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdaterEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, evt: UpdaterEvent): void => callback(evt)
    ipcRenderer.on('updater:event', listener)
    return () => ipcRenderer.removeListener('updater:event', listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', api)
} else {
  // @ts-expect-error fallback for non-isolated context
  window.electronAPI = api
}
