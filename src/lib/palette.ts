/**
 * 命令面板里的**命令型条目**（与「跳到某个工具」的导航型条目相对）。
 *
 * 为什么单独放一个文件：⌘K 原本只能导航 —— 能帮你找到工具，却不能帮你做点什么。
 * 于是「切主题 / 切语言 / 调缩放」这三个最高频的全局动作，只能去侧栏底栏找，
 * 侧栏一收起就没了。把它们放进命令面板，键盘用户全程不用离开键盘。
 *
 * 放在 lib/ 而不是 App.tsx 里的原因：条目的**元数据**（id / 类型 / 标签）是纯数据，
 * 抽出来才能被 smoke:ux 直接断言（id 唯一、id 是 ASCII、该有的类型都在）。
 * 执行逻辑留在 App.tsx —— 它需要组件状态，测试里没有意义。
 */

/** 命令类型。与 ToolId 一样是**语言中立**的稳定标识，中文文案走 locales。 */
export type PaletteCommandKind = 'theme' | 'locale' | 'zoom' | 'sidebar' | 'update'

export interface PaletteCommandDef {
  /** 稳定 id，ASCII，语言中立（可做存储键） */
  id: string
  kind: PaletteCommandKind
  /** 面板里显示的字符（与SECTION_ICONS 同一套 Unicode 符号约定） */
  icon: string
}

/**
 * 命令清单。顺序即面板里的显示顺序：
 * 视图类（主题/语言/缩放/侧栏）排在前面 —— 用得最多；检查更新放最后（低频且可能要联网）。
 */
export const PALETTE_COMMANDS: readonly PaletteCommandDef[] = [
  { id: 'cmd-theme', kind: 'theme', icon: '◐' },
  { id: 'cmd-locale', kind: 'locale', icon: '⇅' },
  { id: 'cmd-zoom', kind: 'zoom', icon: '⇕' },
  { id: 'cmd-sidebar', kind: 'sidebar', icon: '«' },
  { id: 'cmd-update', kind: 'update', icon: '↻' },
] as const