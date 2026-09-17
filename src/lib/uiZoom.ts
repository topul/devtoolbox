/**
 * 界面缩放：默认「自动」——跟随 index.css 里的宽屏媒体查询；
 * 手动档把 --ui-zoom 写到根节点上（内联样式优先级高于媒体查询），用户说了算。
 */
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'devtoolbox-ui-zoom'
/** 空字符串代表「自动」 */
const STEPS = ['', '1', '1.1', '1.25', '1.5']

export function useUiZoom() {
  const [step, setStep] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved !== null && STEPS.includes(saved) ? saved : ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    const root = document.documentElement
    if (!step) root.style.removeProperty('--ui-zoom')
    else root.style.setProperty('--ui-zoom', step)
    try { localStorage.setItem(STORAGE_KEY, step) } catch { /* 隐私模式忽略 */ }
  }, [step])

  const cycle = useCallback(() => {
    setStep((cur) => STEPS[(STEPS.indexOf(cur) + 1) % STEPS.length])
  }, [])

  return {
    /** '自动' 时为空串 */
    percent: step ? `${Math.round(Number(step) * 100)}%` : '',
    isAuto: !step,
    cycle,
  }
}
