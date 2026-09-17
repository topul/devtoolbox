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
