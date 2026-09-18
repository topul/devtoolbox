import { useState, useEffect, useCallback } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'devtoolbox-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  // Follow the OS preference
  if (window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'light') {
    root.classList.add('light')
    root.classList.remove('dark')
  } else {
    root.classList.add('dark')
    root.classList.remove('light')
  }
  root.style.colorScheme = theme
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [ready, setReady] = useState(false)

  // Initialise on mount
  useEffect(() => {
    const stored = getInitialTheme()
    setThemeState(stored)
    applyTheme(stored)

    // Electron: mirror the choice into nativeTheme and follow OS theme changes.
    // 退订函数必须还回去 —— 否则每次挂载都留下一个 ipcRenderer 监听器（HMR 下会累积成告警）。
    let off: (() => void) | undefined
    if (window.electronAPI) {
      window.electronAPI.setTheme(stored)
      off = window.electronAPI.onThemeChanged((changed) => {
        setThemeState(changed)
        applyTheme(changed)
      })
    }

    setReady(true)
    return () => off?.()
  }, [])

  const toggleTheme = useCallback(async () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
    applyTheme(next)

    if (window.electronAPI) {
      await window.electronAPI.setTheme(next)
    }
  }, [theme])

  return { theme, toggleTheme, ready }
}
