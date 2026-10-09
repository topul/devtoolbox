import React from 'react'
import type { PaletteCommandKind } from '../palette'

/**
 * UI shell strings (sidebar, home view, updater toast, common buttons).
 * Tool-internal strings live in the sibling files in this folder.
 */

export type Locale = 'zh' | 'en'

export interface UIStrings {
  searchPlaceholder: string
  allTools: string
  noMatch: string
  noMatchHome: (q: string) => React.ReactNode
  disclaimer: string
  localCompute: string
  hero: (n: number) => React.ReactNode
  legalTitle: string
  legalBody: string
  toolsCount: (n: number) => string
  langSwitch: string
  switchLangTip: string
  openMenu: string
  closeMenu: string
  toggleTheme: string
  switchToLight: string
  switchToDark: string
  themeLight: string
  themeDark: string
  searchToolsAria: string
  zoomAuto: string
  zoomTip: string
  collapseSidebar: string
  expandSidebar: string
  chatNav: string
  homeNav: string
  jumpToSection: string
  heroChips: string[]
  /** ⌘K 命令面板：空结果提示 */
  cmdkEmpty: string
  /** ⌘K 命令面板：命令型条目分组标题（切主题/语言等全局动作） */
  cmdkActions: string
  /** ⌘K 命令面板：快捷导航分组标题 */
  quickNav: string
  /** ⌘K 命令面板：底部按键提示（↑↓ / ↵） */
  cmdkSelect: string
  cmdkOpen: string
  updateChecking: string
  updateNone: string
  updateFound: (v: string) => string
  updateProgress: (p: number) => string
  updateReady: (v: string) => string
  updateRestart: string
  updateLater: string
  updateError: string
  checkUpdate: string
}

export const UI: Record<Locale, UIStrings> = {
  zh: {
    searchPlaceholder: '搜索工具 / payload / 端口...',
    allTools: '全部工具',
    noMatch: '[404] 没有匹配的工具',
    noMatchHome: (q: string) => <>没有找到匹配「{q}」的工具</>,
    disclaimer: '仅供授权测试与学习研究',
    localCompute: '所有计算均在本地完成',
    hero: (n: number) => (
      <>
        一个站点装下程序员与安全研究员的日常弹药库 — <span className="text-bright">{n} 个工具</span>
        ，从 AI 对话调试、MCP 接入到 JSON 格式化与反弹 Shell。全部本地运算，数据不出浏览器。
      </>
    ),
    legalTitle: '[!] 法律与道德声明：',
    legalBody:
      '本站渗透测试类工具（反弹 Shell、Payload 速查等）仅供安全研究、CTF 竞赛、授权渗透测试与防御学习使用。未经授权对他人系统发起测试属违法行为。所有运算均在本地浏览器完成，本站不收集任何输入数据。',
    toolsCount: (n: number) => `${n} 个工具`,
    langSwitch: 'EN',
    switchLangTip: '切换到英文',
    openMenu: '打开菜单',
    closeMenu: '关闭菜单',
    toggleTheme: '切换主题',
    switchToLight: '切换到亮色模式',
    switchToDark: '切换到暗黑模式',
    themeLight: '◐ 亮',
    themeDark: '◑ 暗',
    searchToolsAria: '搜索工具',
    zoomAuto: '自动',
    zoomTip: '界面缩放：自动 = 跟随屏幕宽度，宽屏自动放大',
    collapseSidebar: '收起侧边栏',
    expandSidebar: '展开侧边栏',
    chatNav: '对话',
    homeNav: '工具箱',
    jumpToSection: '跳到分组',
    heroChips: ['MCP 服务端', '流式对话', '工具调用', 'Agent 规则', 'JSON', 'JWT'],
    cmdkEmpty: '没有匹配的工具',
    cmdkActions: '操作',
    quickNav: '快捷入口',
    cmdkSelect: '选择',
    cmdkOpen: '打开',
    // 自动升级
    updateChecking: '正在检查更新...',
    updateNone: '已是最新版本',
    updateFound: (v: string) => `发现新版本 v${v}，正在下载...`,
    updateProgress: (p: number) => `正在下载更新 ${p}%`,
    updateReady: (v: string) => `v${v} 已下载完成`,
    updateRestart: '重启安装',
    updateLater: '稍后',
    updateError: '检查更新失败，请稍后重试',
    checkUpdate: '检查更新',
  },
  en: {
    searchPlaceholder: 'Search tools / payload / ports...',
    allTools: 'All Tools',
    noMatch: '[404] No matching tools',
    noMatchHome: (q: string) => <>No tools matching "{q}"</>,
    disclaimer: 'For authorized testing & research only',
    localCompute: 'All computation happens locally',
    hero: (n: number) => (
      <>
        An everyday arsenal for developers & security researchers —{' '}
        <span className="text-bright">{n} tools</span>, from AI chat debugging and MCP wiring to
        JSON formatting and reverse shells. 100% local, data never leaves your machine.
      </>
    ),
    legalTitle: '[!] Legal & Ethics Notice:',
    legalBody:
      "Offensive tools (reverse shells, payload cheat sheets) are provided for security research, CTF, authorized pentesting and defensive education only. Testing others' systems without authorization is illegal. All computation runs locally; no input data is collected.",
    toolsCount: (n: number) => `${n} tools`,
    langSwitch: '中',
    switchLangTip: 'Switch to Chinese',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    toggleTheme: 'Toggle theme',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
    themeLight: '◐ Light',
    themeDark: '◑ Dark',
    searchToolsAria: 'Search tools',
    zoomAuto: 'Auto',
    zoomTip: 'UI scale: Auto follows screen width and enlarges on large displays',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    chatNav: 'Chat',
    homeNav: 'Toolbox',
    jumpToSection: 'Jump to group',
    heroChips: ['MCP server', 'Streaming chat', 'Tool calling', 'Agent rules', 'JSON', 'JWT'],
    cmdkEmpty: 'No matching tools',
    cmdkActions: 'Actions',
    quickNav: 'Quick access',
    cmdkSelect: 'Select',
    cmdkOpen: 'Open',
    updateChecking: 'Checking for updates...',
    updateNone: 'You are up to date',
    updateFound: (v: string) => `New version v${v} found, downloading...`,
    updateProgress: (p: number) => `Downloading update ${p}%`,
    updateReady: (v: string) => `v${v} downloaded`,
    updateRestart: 'Restart & Install',
    updateLater: 'Later',
    updateError: 'Update check failed, try again later',
    checkUpdate: 'Check Update',
  },
}

/** Shared button labels used by src/components/ui.tsx primitives */
export const COMMON: Record<
  Locale,
  {
    copy: string
    copied: string
    /** Markdown 外链：点开走系统浏览器（应用窗口本身不导航） */
    openInBrowser: string
    /** Markdown 里的外链图片：CSP 只允许本地资源，外链一律不加载 */
    imageBlocked: string
    /** 抽屉 / 弹层关闭按钮的无障碍标签 */
    close: string
    /** 危险操作的行内二次确认（如「清空」点一次变「确认清空 / 取消」） */
    confirm: string
    cancel: string
    /** 结果区被截断时的提示：已显示多少、共多少 */
    showingOf: (shown: number, total: number) => string
    /** 结果区空状态的引导：告诉用户这里该放什么 */
    emptyResult: string
  }
> = {
  zh: {
    copy: '复制',
    copied: '✓ 已复制',
    openInBrowser: '在浏览器中打开',
    imageBlocked: '图片未加载（外链资源被安全策略拦截）',
    close: '关闭',
    confirm: '确认',
    cancel: '取消',
    showingOf: (shown, total) => `已显示 ${shown} / ${total} 行`,
    emptyResult: '结果会显示在这里',
  },
  en: {
    copy: 'Copy',
    copied: '✓ Copied',
    openInBrowser: 'Open in browser',
    imageBlocked: 'Image not loaded (external resource blocked by policy)',
    close: 'Close',
    confirm: 'Confirm',
    cancel: 'Cancel',
    showingOf: (shown, total) => `Showing ${shown} of ${total} lines`,
    emptyResult: 'Result will appear here',
  },
}

/**
 * 命令面板「命令型条目」的文案。
 *
 * 按 kind 取（而不是按 id）：新增命令时只补一个 kind 的文案，
 * 不用记得给每条命令各写一遍 —— 漏一处就是界面上少一段。
 * 双语键完全一致由 i18n:check 把关。
 */
export const PALETTE_LABEL: Record<Locale, Record<PaletteCommandKind, string>> = {
  zh: {
    theme: '切换主题',
    locale: '切换语言',
    zoom: '界面缩放',
    sidebar: '折叠 / 展开侧栏',
    update: '检查更新',
  },
  en: {
    theme: 'Toggle theme',
    locale: 'Switch language',
    zoom: 'UI scale',
    sidebar: 'Collapse / expand sidebar',
    update: 'Check for updates',
  },
}
