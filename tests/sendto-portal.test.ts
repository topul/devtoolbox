// @vitest-environment jsdom
/**
 * 「发送到」菜单的浮层契约 —— 回归测试。
 *
 * 背景（bug 现场）：工具页都渲染在带 `zoom` 的 <main>（content-zoom，宽屏 1.06~1.22）里。
 * CSS zoom 会让祖先成为 fixed 元素的包含块，菜单若内联渲染在该容器内：
 *   1. fixed 的 left/top 按缩放容器坐标系解释 → 菜单偏移、被整体放大，不像浮层；
 *   2. 菜单超出容器宽度 → 主文档出现横向滚动条。
 * Drawer 用 createPortal 挂 body 解掉了同一个坑，本菜单必须同样 portal 到 body，
 * 让 fixed 坐标回到真实视口系。测试断言的就是这条契约。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../src/lib/i18n'
import { SendToMenu } from '../src/components/SendTo'

// React 19 的 act 需要显式声明测试环境，否则每次调用都刷 warning
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PAYLOAD = { sourceLabel: 'GET /api/users' }

let container: HTMLElement | null = null

afterEach(() => {
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

/** 菜单容器：唯一同时带 fixed 与尺寸类 w-60 的面板（背板无尺寸类，触发按钮不是 div） */
function findMenu(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.className.includes('fixed') && el.className.includes('w-60'),
    ) ?? null
  )
}

/** 透明背板：z-[90] 的那层 */
function findBackdrop(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('div')].find((el) =>
      el.className.includes('z-[90]'),
    ) ?? null
  )
}

/** 挂载组件并点开「发送到」，返回渲染容器（模拟工具页里的调用方 DOM） */
function openMenu(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(I18nProvider, null, createElement(SendToMenu, { payload: PAYLOAD })))
  })
  const trigger = container.querySelector('button')
  expect(trigger?.textContent).toContain('发送到')
  act(() => {
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  return container
}

describe('SendToMenu 浮层契约', () => {
  it('打开后菜单挂到 document.body，不留在调用方容器内', () => {
    const host = openMenu()
    const menu = findMenu()
    expect(menu).not.toBeNull()
    // 契约核心：父节点是 body，而不是工具页（缩放）容器里的某个节点
    expect(menu!.parentElement).toBe(document.body)
    expect(host.contains(menu!)).toBe(false)
  })

  it('透明背板同样挂到 body 且层级在菜单之下', () => {
    openMenu()
    const backdrop = findBackdrop()
    expect(backdrop).not.toBeNull()
    expect(backdrop!.parentElement).toBe(document.body)
    const menu = findMenu()
    expect(menu).not.toBeNull()
    expect(backdrop!.className).toContain('z-[90]')
    expect(menu!.className).toContain('z-[91]')
  })

  it('点背板关闭菜单', () => {
    openMenu()
    const backdrop = findBackdrop()
    expect(backdrop).not.toBeNull()
    act(() => {
      backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(findMenu()).toBeNull()
    expect(findBackdrop()).toBeNull()
  })

  it('SSR（预渲染）只输出触发按钮，不炸', async () => {
    // 预渲染走 renderToString，portal 分支必须被 typeof document 守卫挡掉。
    const { renderToString } = await import('react-dom/server')
    const html = renderToString(
      createElement(I18nProvider, null, createElement(SendToMenu, { payload: PAYLOAD })),
    )
    expect(html).toContain('发送到')
  })
})
