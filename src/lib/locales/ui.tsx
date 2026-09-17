import React from 'react'

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
  jumpToCategory: string
  heroChips: string[]
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
    hero: (n: number) => <>一个站点装下程序员与安全研究员的日常弹药库 — <span className="text-bright">{n} 个工具</span>，从 JSON 格式化到反弹 Shell 生成。全部本地运算，数据不出浏览器。</>,
    legalTitle: '[!] 法律与道德声明：',
    legalBody: '本站渗透测试类工具（反弹 Shell、Payload 速查等）仅供安全研究、CTF 竞赛、授权渗透测试与防御学习使用。未经授权对他人系统发起测试属违法行为。所有运算均在本地浏览器完成，本站不收集任何输入数据。',
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
    jumpToCategory: '跳到分类',
    heroChips: ['JSON', 'JWT', '反弹 Shell', 'Payload', '哈希', '子网'],
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
    hero: (n: number) => <>An everyday arsenal for developers & security researchers — <span className="text-bright">{n} tools</span>, from JSON formatting to reverse shells. 100% local, data never leaves your machine.</>,
    legalTitle: '[!] Legal & Ethics Notice:',
    legalBody: 'Offensive tools (reverse shells, payload cheat sheets) are provided for security research, CTF, authorized pentesting and defensive education only. Testing others\' systems without authorization is illegal. All computation runs locally; no input data is collected.',
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
    jumpToCategory: 'Jump to category',
    heroChips: ['JSON', 'JWT', 'Reverse Shell', 'Payload', 'Hash', 'Subnet'],
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
export const COMMON: Record<Locale, { copy: string; copied: string }> = {
  zh: { copy: '复制', copied: '✓ 已复制' },
  en: { copy: 'Copy', copied: '✓ Copied' },
}
