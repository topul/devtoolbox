/**
 * 侧边栏收起状态（桌面端）。移动端本来就是抽屉，不走这套。
 * 收起后在桌面端保留一条窄栏（品牌 / 展开 / 搜索 / 分类跳转 / 缩放·语言·主题），
 * 保证收起后所有入口仍然可达，而不是「藏起来就找不到了」。
 */
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'devtoolbox-sidebar-collapsed'

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch { /* 隐私模式忽略 */ }
  }, [collapsed])

  const toggle = useCallback(() => setCollapsed((c) => !c), [])

  return { collapsed, setCollapsed, toggle }
}

/* ================= 导航分组的展开状态 ================= */

const SECTIONS_KEY = 'devtoolbox-open-sections'
const DEFAULT_OPEN = ['ai', 'http']

/**
 * 侧栏里哪些分组是展开的。
 *
 * 默认展开 **AI 与 HTTP 两组** —— 65 个工具全摊开会让人找不到东西，
 * 而这两块是每天都在用的。其余组折叠成一行，点一下再展开。
 *
 * 注意：展开状态存在 localStorage，**老版本升级上来的用户不会自动多展开 http 组**
 * （用自己调过的折叠状态覆盖默认值是对的，不该被我们改掉）。要让他们也能看到，
 * 得让他们自己点一次，或者进一次该组里的工具 —— `ensureOpen` 会自动展开。
 */
export function useOpenSections() {
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SECTIONS_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch { /* 解析失败就回默认 */ }
    return DEFAULT_OPEN
  })

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(open))
    } catch { /* 隐私模式忽略 */ }
  }, [open])

  const isOpen = useCallback((id: string) => open.includes(id), [open])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  /** 确保某个分组是展开的（切到该组里的工具时用，别让选中项藏在折叠区里） */
  const ensureOpen = useCallback((id: string) => {
    setOpen((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  const closeAll = useCallback(() => setOpen([]), [])

  return { open, isOpen, toggle, ensureOpen, closeAll }
}
