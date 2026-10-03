/**
 * 焦点管理的纯逻辑。
 *
 * 为什么要抽成纯函数：焦点陷阱的正确性（「Tab 在末尾要环绕回首元素」）很难靠肉眼验，
 * 而且必须能在 Node 冒烟里断言。把判定规则做成不依赖 React 的纯函数，
 * 组件只负责把 DOM 收集好传进来。
 *
 * 这里刻意不 import React —— 与 lib/ 的分层约定一致。
 */

/** 可聚焦元素的选择器。`disabled` / `tabindex="-1"` / 隐藏的元素都要排除。 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  // 原生可聚焦但不在上面几条里的：折叠器 summary、可编辑区、媒体控件
  'summary',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
].join(',')

/**
 * 把容器里真正可聚焦的元素按 DOM 顺序收集出来。
 *
 * **为什么不用 data-focus-id**：早期版本只收集带该属性的节点，理由是「冒烟里可以喂假元素」。
 * 但真实产品代码里没有任何地方给输入框声明它 —— 全项目只有抽屉的「×」按钮声明了。
 * 于是 items 恒为 ['drawer-close']，环绕判定走length===1 分支直接返回，
 * 抽屉里的表单对键盘用户完全不可达。更糟的是当时的测试假 DOM 里
 * `getAttribute('data-focus-id')` 永远返回 id，等于桩自己复刻了缺陷，736 项全绿。
 *
 * 现在直接返回元素本身：可聚焦性由 FOCUSABLE_SELECTOR 判定（真实 CSS 选择器），
 * 顺序由 querySelectorAll 的文档序决定，两者都不需要作者手工标注。
 */
export function collectFocusable(container: ParentNode | null): HTMLElement[] {
  if (!container || typeof container.querySelectorAll !== 'function') return []
  const out: HTMLElement[] = []
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  nodes.forEach(el => {
    // offsetParent 为 null 在固定定位元素上会误判，用 getClientRects 长度更准；
    // SSR 环境下两者都拿不到，此时不做可见性过滤（测试环境本来就都是可见的）
    const hidden = typeof el.getClientRects === 'function' && el.getClientRects().length === 0
    if (hidden && typeof el.getClientRects === 'function') return
    out.push(el)
  })
  return out
}

/**
 * Tab / Shift+Tab 被按下时，把焦点圈在容器内。
 *
 * 环绕发生在容器自己的首/末元素上：焦点在末元素按 Tab → 回首元素；首元素按 Shift+Tab → 回末元素。
 * 焦点在中间时不拦，交给浏览器原生顺序处理。
 *
 * @param container 弹层容器
 * @param dir 方向
 * @returns 是否处理了这次按键。false 表示焦点本来就在范围内（或容器里没元素），调用方别 preventDefault。
 */
export function trapTab(container: HTMLElement | null, dir: 'forward' | 'backward'): boolean {
  if (!container) return false
  const items = collectFocusable(container)
  if (items.length === 0) return false
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  if (!active) return false
  // 焦点还在容器外（比如刚打开还没接管）：不拦，交给打开时的初始聚焦逻辑
  if (!container.contains(active)) return false
  const at = items.indexOf(active)
  if (at < 0) return false
  const last = items.length - 1
  let next: number | null = null
  if (dir === 'forward' && at === last) next = 0
  if (dir === 'backward' && at === 0) next = last
  if (next === null) return false
  const el = items[next]
  if (el && typeof el.focus === 'function') el.focus()
  return true
}

/**
 * 把焦点放进容器第一个可聚焦元素；容器里没有可聚焦元素时聚焦容器本身。
 * 抽屉打开时用。
 */
export function focusFirst(container: HTMLElement | null): void {
  if (!container) return
  const items = collectFocusable(container)
  if (items.length > 0) items[0].focus()
  else container.focus()
}
