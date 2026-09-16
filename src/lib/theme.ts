import { useState, useEffect, useCallback } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'devtoolbox-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  // 跟随系统
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

  // 初始化
  useEffect(() => {
    const stored = getInitialTheme()
    setThemeState(stored)
    applyTheme(stored)

    // Electron: 同步到 nativeTheme，并监听系统主题变化
    if (window.electronAPI) {
      window.electronAPI.setTheme(stored)
      window.electronAPI.onThemeChanged((changed) => {
        setThemeState(changed)
        applyTheme(changed)
      })
    }

    setReady(true)
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
