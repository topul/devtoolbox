import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react'
import { Command } from 'cmdk'
import {
  TOOLS,
  SECTIONS,
  sectionOf,
  searchTools,
  toolsInSection,
  visibleToolCount,
  visibleTools,
  ToolDef,
  CategoryId,
  SectionId,
} from './lib/registry'
import { useTheme } from './lib/theme'
import { useUiZoom } from './lib/uiZoom'
import { useSidebarCollapsed, useOpenSections } from './lib/sidebar'
import { useI18n, I18nProvider } from './lib/i18n'
import { PALETTE_COMMANDS, type PaletteCommandDef } from './lib/palette'
import { PALETTE_LABEL } from './lib/locales/ui'
import { getVersion } from './lib/version'
import { UpdateToast, useUpdater } from './components/Updater'
import { ChatTool } from './tools/chat'
import { cn } from './lib/cn'

/**
 * 导航分组的图标：侧栏窄栏、侧栏展开态、首页分区、命令面板共用一套。
 * 用 Unicode 符号而不是图标库：零依赖，且与各平台系统字体兼容。
 */
const SECTION_ICONS: Record<SectionId, string> = {
  ai: '✦',
  http: '⇅',
  codec: '⇄',
  security: '⚿',
  network: '⌁',
  content: '⚙',
  misc: '▤',
}

/** 每个分组的粉彩 chip 配色（index.css 的 .chip-*）：侧栏导航与工具卡片共用一套色相 */
const SECTION_CHIP: Record<SectionId, string> = {
  ai: 'chip-emerald',
  http: 'chip-sky',
  codec: 'chip-amber',
  security: 'chip-rose',
  network: 'chip-teal',
  content: 'chip-indigo',
  misc: 'chip-violet',
}

/** 高频工具的专属卡片字形；没列出的回落到分组图标 */
const TOOL_GLYPHS: Record<string, string> = {
  json: '{ }',
  base64: 'B64',
  jwt: 'JWT',
  'http-client': '⇅',
  'regex-replace': '.*',
  graphql: '◈',
  'traffic-proxy': '◎',
  'mcp-server': '✦',
}

/**
 * 常用工具网格里的暖色渐变焦点卡（全站只有这一张：克制才有点睛效果）。
 * 抓包代理是桌面端独占的旗舰能力，值得这个位置。
 */
const WARM_FEATURED_TOOL = 'traffic-proxy'

/** 首页每个分区先展示的工具数，其余的收进「+N 更多」虚线卡 */
const SEC_PREVIEW = 7

/** 首页与侧栏共用的分组内容：组 → 其下的工具（按分类顺序） */
type SectionGroup = { tools: ToolDef[]; cats: Map<CategoryId, ToolDef[]> }

/** 平台相关的快捷键提示（Mac 显示 ⌘K，其他显示 Ctrl K） */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  )
}

function AppInner() {
  const { locale, setLocale, t, toolName, catName, sectionName } = useI18n()
  const [activeId, setActiveId] = useState<string | null>(
    () => location.hash.replace('#', '') || null,
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [version, setVersion] = useState('')
  const { theme, toggleTheme } = useTheme()
  const zoom = useUiZoom()
  const sidebar = useSidebarCollapsed()
  const openSections = useOpenSections()
  const updater = useUpdater()

  useEffect(() => {
    getVersion().then(setVersion)
  }, [])

  const openTool = useCallback((id: string | null) => {
    setActiveId(id)
    location.hash = id ?? ''
    setSidebarOpen(false)
    window.scrollTo({ top: 0 })
  }, [])

  /** 窄栏里点分组图标：回到首页并滚到对应分区（收起状态下也能快速跳转） */
  const jumpToSection = useCallback(
    (sec: SectionId) => {
      openTool(null)
      setTimeout(() => {
        document
          .getElementById(`sec-${sec}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
    },
    [openTool],
  )

  /** ⌘K / Ctrl+K 全局唤起命令面板 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onHash = () => setActiveId(location.hash.replace('#', '') || null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const active = TOOLS.find((t) => t.id === activeId) ?? null

  /**
   * 视图路由：打开应用就是对话 —— 这是「AI 优先」的落点，工具箱退居其次。
   * hash 为空 = 对话；#home = 工具网格；#<tool-id> = 具体工具。
   */
  const view: 'chat' | 'home' | 'tool' = active ? 'tool' : activeId === 'home' ? 'home' : 'chat'

  /** 分组聚合：组 → 其下的工具，组内再按分类细分（组里只有一个分类时不显示分类小标题） */
  const grouped = useMemo(() => {
    const map = new Map<SectionId, SectionGroup>()
    for (const sec of SECTIONS) {
      const tools = toolsInSection(sec.id)
      if (!tools.length) continue
      const cats = new Map<CategoryId, ToolDef[]>()
      for (const cat of sec.categories) {
        const items = tools.filter((t) => t.category === cat)
        if (items.length) cats.set(cat, items)
      }
      map.set(sec.id, { tools, cats })
    }
    return map
  }, [])

  // 当前工具所在的分组自动展开：否则选中项藏在折叠区里，侧栏看不出你在哪
  const ensureSectionOpen = openSections.ensureOpen
  useEffect(() => {
    if (active) ensureSectionOpen(sectionOf(active.category))
  }, [active, ensureSectionOpen])

  const kbdHint = IS_MAC ? '⌘K' : 'Ctrl K'

  return (
    <div className="min-h-screen bg-terminal flex">
      {/* ============ Sidebar ============ */}
      <aside
        className={`
        fixed lg:sticky top-0 z-50 h-screen h-[100dvh] w-[82vw] max-w-[300px] shrink-0 flex flex-col
        bg-panel/95 lg:bg-transparent backdrop-blur lg:backdrop-blur-none
        transition-[transform,width] duration-200 pt-safe pl-safe
        ${sidebar.collapsed ? 'lg:w-[4rem]' : 'lg:w-[17rem]'}
        ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0 lg:shadow-none'}
      `}
      >
        {/* 桌面端：侧栏是浮在画布上的白卡片，靠弥散阴影分层而不是 1px 描边；
            移动端抽屉不受影响（lg: 前缀外的样式保持原样） */}
        <div className="flex flex-col flex-1 min-h-0 lg:m-3 lg:mr-0 lg:rounded-[20px] lg:bg-panel lg:shadow-soft-card overflow-hidden">
        {/* ===== 桌面端窄栏（收起态） ===== */}
        {sidebar.collapsed && (
          <div data-sb-rail className="hidden lg:flex flex-col flex-1 min-h-0">
            <button
              onClick={() => openTool(null)}
              className="py-3 text-phosphor text-[15px] hover:opacity-80 !min-h-0"
              title={t.chatNav}
              aria-label={t.chatNav}
            >
              ✦
            </button>
            <button
              onClick={() => openTool('home')}
              className="py-2 text-muted hover:text-bright text-[14px] !min-h-0"
              title={t.homeNav}
              aria-label={t.homeNav}
            >
              ⌂
            </button>
            <button
              onClick={sidebar.toggle}
              className="py-2 border-y border-line-soft text-muted hover:text-bright text-[13px] !min-h-0"
              title={t.expandSidebar}
              aria-label={t.expandSidebar}
            >
              »
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              className="py-2.5 border-b border-line-soft text-muted hover:text-bright text-[13px] !min-h-0"
              title={`${t.searchToolsAria} (${kbdHint})`}
              aria-label={t.searchToolsAria}
            >
              ⌕
            </button>

            <div className="flex-1 min-h-0 overflow-y-auto py-1">
              {SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => jumpToSection(sec.id)}
                  className={cn(
                    'w-full py-2 text-[14px] rounded-md transition-colors !min-h-0',
                    sec.id === 'ai'
                      ? 'text-phosphor/80 hover:text-phosphor'
                      : 'text-muted hover:text-bright hover:bg-panel-2',
                  )}
                  title={`${t.jumpToSection}: ${sectionName(sec.id)}`}
                  aria-label={sectionName(sec.id)}
                >
                  {SECTION_ICONS[sec.id]}
                </button>
              ))}
            </div>

            <div className="border-t border-line-soft py-1">
              <button
                onClick={zoom.cycle}
                className="w-full py-1.5 text-muted hover:text-bright text-[11px] !min-h-0"
                title={t.zoomTip}
                aria-label={t.zoomTip}
              >
                ⇕
              </button>
              <button
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                className="w-full py-1.5 text-muted hover:text-bright text-[10px] !min-h-0"
                title={t.switchLangTip}
                aria-label={t.switchLangTip}
              >
                {t.langSwitch}
              </button>
              <button
                onClick={toggleTheme}
                className="w-full py-1.5 text-muted hover:text-bright text-[11px] !min-h-0"
                title={theme === 'dark' ? t.switchToLight : t.switchToDark}
                aria-label={t.toggleTheme}
              >
                {theme === 'dark' ? '◑' : '◐'}
              </button>
            </div>
          </div>
        )}

        {/* ===== 移动端抽屉 + 桌面端展开态 ===== */}
        <div className={cn('flex flex-col flex-1 min-h-0', sidebar.collapsed ? 'lg:hidden' : '')}>
          <div className="flex items-center px-3 pt-4 pb-2">
            <button
              onClick={() => openTool(null)}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left group !min-h-0"
            >
              <span className="chip-c grad-hero w-9 h-9 !rounded-[13px] text-white text-[15px] shadow-[0_6px_16px_-6px_rgba(11,169,119,.55)]">
                ✦
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold tracking-tight text-bright group-hover:text-phosphor transition-colors truncate">
                  BUGBUCKET<span className="text-phosphor">.BOX</span>
                </span>
                <span className="block text-[10px] text-muted tracking-[0.2em] mt-0.5 uppercase">
                  Dev × Sec Toolkit
                </span>
              </span>
            </button>
            <button
              onClick={sidebar.toggle}
              className="hidden lg:flex items-center self-stretch px-2 text-muted hover:text-bright text-[14px] transition-colors"
              title={t.collapseSidebar}
              aria-label={t.collapseSidebar}
            >
              «
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden px-2 self-stretch flex items-center text-muted text-xl"
              aria-label={t.closeMenu}
            >
              ×
            </button>
          </div>

          {/* 搜索入口：直接打开命令面板（⌘K），不再做侧栏内过滤 */}
          <div className="px-3 pb-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="w-full flex items-center gap-2 rounded-full bg-panel-2 px-3.5 py-2 text-[12.5px] text-muted hover:text-bright transition-colors"
            >
              <span className="text-[12px]">⌕</span>
              <span className="flex-1 text-left truncate">{t.searchPlaceholder}</span>
              <kbd className="shrink-0 rounded-md bg-panel px-1.5 py-0.5 text-[10px] text-muted shadow-soft-sm">
                {kbdHint}
              </kbd>
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 py-1 space-y-0.5">
            <button
              onClick={() => openTool(null)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors',
                view === 'chat'
                  ? 'bg-phosphor-faint text-phosphor font-semibold'
                  : 'text-muted hover:text-bright hover:bg-panel-2',
              )}
            >
              <span className="chip-c chip-emerald w-[26px] h-[26px] text-[13px]">✦</span>
              {t.chatNav}
            </button>
            <button
              onClick={() => openTool('home')}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors',
                view === 'home'
                  ? 'bg-phosphor-faint text-phosphor font-semibold'
                  : 'text-muted hover:text-bright hover:bg-panel-2',
              )}
            >
              <span className="chip-c chip-slate w-[26px] h-[26px] text-[13px]">⌂</span>
              {t.homeNav}
              <span className="ml-auto text-[10.5px] text-muted/60">{visibleToolCount()}</span>
            </button>

            {[...grouped.entries()].map(([sec, entry]) => {
              const open = openSections.isOpen(sec)
              const multiCat = entry.cats.size > 1
              return (
                <div key={sec} className="pt-1">
                  <button
                    onClick={() => openSections.toggle(sec)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-panel-2 text-muted hover:text-bright"
                  >
                    <span
                      className={cn(
                        'chip-c w-[26px] h-[26px] text-[13px]',
                        SECTION_CHIP[sec],
                      )}
                    >
                      {SECTION_ICONS[sec]}
                    </span>
                    <span className="text-[13px] font-medium truncate">{sectionName(sec)}</span>
                    <span className="ml-auto text-[10.5px] text-muted/60 shrink-0">
                      {entry.tools.length}
                    </span>
                    <span
                      className={cn(
                        'text-[8px] shrink-0 text-muted/50 transition-transform duration-200',
                        open && 'rotate-90',
                      )}
                    >
                      ▶
                    </span>
                  </button>

                  <div
                    className="collapse-grid"
                    style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                    aria-hidden={!open}
                    {...(open ? {} : { inert: '' as unknown as boolean })}
                  >
                    <div>
                      <div className="pb-1">
                        {[...entry.cats.entries()].map(([cat, items]) => (
                          <div key={cat}>
                            {multiCat && (
                              <div className="pl-[46px] pr-2 pt-1.5 pb-0.5 text-[10.5px] text-muted/60 select-none truncate">
                                {catName(cat)}
                              </div>
                            )}
                            {items.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => openTool(item.id)}
                                className={cn(
                                  'w-full text-left rounded-lg pl-[46px] pr-2 py-1.5 text-[12.5px] transition-colors truncate',
                                  active?.id === item.id
                                    ? 'bg-phosphor-faint text-phosphor font-medium'
                                    : 'text-muted hover:text-bright hover:bg-panel-2',
                                )}
                              >
                                {toolName(item)}
                                {item.hot && (
                                  <span className="ml-1.5 text-[9px] text-amber">★</span>
                                )}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </nav>

          {/* 底栏：操作三键 + 版本行（免责声明收进 ⓘ 悬浮提示，不再常驻占行） */}
          <div data-sb-foot className="px-3 pt-2 pb-3 space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={zoom.cycle}
                className="rounded-xl bg-panel-2 px-1.5 py-1.5 text-[10.5px] text-muted text-center truncate hover:text-bright transition-colors"
                aria-label={t.zoomTip}
                title={t.zoomTip}
              >
                ⇕ {zoom.percent || t.zoomAuto}
              </button>
              <button
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                className="rounded-xl bg-panel-2 px-1.5 py-1.5 text-[10.5px] text-muted text-center truncate hover:text-bright transition-colors"
                aria-label={t.switchLangTip}
                title={t.switchLangTip}
              >
                {t.langSwitch}
              </button>
              <button
                onClick={toggleTheme}
                className="rounded-xl bg-panel-2 px-1.5 py-1.5 text-[10.5px] text-muted text-center truncate hover:text-bright transition-colors"
                aria-label={t.toggleTheme}
                title={theme === 'dark' ? t.switchToLight : t.switchToDark}
              >
                {theme === 'dark' ? t.themeLight : t.themeDark}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted/80">
              <span className="truncate">
                <span className="cursor-help text-amber/90" title={t.disclaimer}>
                  ⓘ
                </span>{' '}
                {t.localCompute} · v{version || '...'}
              </span>
              {window.electronAPI && (
                <button
                  onClick={() => window.electronAPI?.checkForUpdates()}
                  className="shrink-0 text-muted/80 hover:text-phosphor rounded-md border border-line-soft hover:border-phosphor/40 px-1.5 py-1 text-[9.5px] transition-colors"
                >
                  {t.checkUpdate}
                </button>
              )}
            </div>
          </div>
        </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 anim-overlay-in"
          style={{ background: 'var(--c-overlay)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ============ 命令面板（⌘K） ============ */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenTool={openTool} />

      {/* ============ Main ============ */}
      <main className={cn('flex-1 min-w-0 content-zoom', view === 'chat' ? 'overflow-hidden' : '')}>
        {/* mobile topbar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-1 border-b border-line-soft bg-panel/90 backdrop-blur px-2 py-1.5 pt-safe">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-bright text-lg px-3 py-1"
            aria-label={t.openMenu}
          >
            ☰
          </button>
          <button
            onClick={() => openTool(null)}
            className="text-[13px] font-semibold tracking-tight text-bright px-1 py-1 !min-h-0"
          >
            BUGBUCKET<span className="text-phosphor">.BOX</span>
          </button>
          <span className="flex-1 text-right text-[11px] text-muted truncate px-2">
            {active ? `${SECTION_ICONS[sectionOf(active.category)]} ${toolName(active)}` : ''}
          </span>
          <button
            onClick={toggleTheme}
            className="text-muted rounded-md border border-line-soft px-2.5 py-1 text-[12px] hover:text-bright transition-colors"
            aria-label={t.toggleTheme}
            title={theme === 'dark' ? t.switchToLight : t.switchToDark}
          >
            {theme === 'dark' ? '◐' : '◑'}
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="text-muted rounded-md border border-line-soft px-2.5 py-1 text-[12px]"
            aria-label={t.searchToolsAria}
          >
            ⌕
          </button>
        </div>

        {view === 'chat' ? (
          <ChatTool />
        ) : !active ? (
          <HomeView grouped={grouped} onOpen={openTool} />
        ) : (
          <ToolView tool={active} onBack={() => openTool(null)} />
        )}
      </main>

      <UpdateToast state={updater} />
    </div>
  )
}

/* ================= Command palette (⌘K) ================= */

/**
 * 全局命令面板：模糊搜索所有工具（中英文 + 描述 + 关键词），键盘上下选择回车直达。
 * 过滤复用 searchTools（与侧栏搜索同一套词表），cmdk 只负责列表与键盘导航。
 */
function CommandPalette({
  open,
  onOpenChange,
  onOpenTool,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onOpenTool: (id: string | null) => void
}) {
  const { t, toolName, toolDesc, sectionName, locale, setLocale } = useI18n()
  const { toggleTheme } = useTheme()
  const zoom = useUiZoom()
  const sidebar = useSidebarCollapsed()
  const [q, setQ] = useState('')

  const results = useMemo(() => searchTools(q), [q])
  const groups = useMemo(() => {
    const map = new Map<SectionId, ToolDef[]>()
    for (const tool of results) {
      const sec = sectionOf(tool.category)
      if (!map.has(sec)) map.set(sec, [])
      map.get(sec)!.push(tool)
    }
    return [...map.entries()]
  }, [results])

  // 关闭时清空搜索词，下次打开总是从全量开始
  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  const run = useCallback(
    (id: string | null) => {
      onOpenTool(id)
      onOpenChange(false)
    },
    [onOpenTool, onOpenChange],
  )

  /** 命令型条目：点完就关面板，别让用户以为面板还在原地 */
  const runCommand = useCallback(
    (fn: () => void) => {
      fn()
      onOpenChange(false)
    },
    [onOpenChange],
  )

  // 命令只在输入为空（面板刚开、还没打字）时露出来：一旦在搜工具，
  // 混进几条设置项会让结果变噪音
  const showCommands = !q.trim()

  const execute = useCallback(
    (c: PaletteCommandDef) => {
      switch (c.kind) {
        case 'theme':
          return runCommand(toggleTheme)
        case 'locale':
          return runCommand(() => setLocale(locale === 'zh' ? 'en' : 'zh'))
        case 'zoom':
          return runCommand(zoom.cycle)
        case 'sidebar':
          return runCommand(sidebar.toggle)
        case 'update':
          return runCommand(() => {
            void window.electronAPI?.checkForUpdates()
          })
      }
    },
    [runCommand, toggleTheme, locale, setLocale, zoom, sidebar],
  )

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      label={t.searchToolsAria}
      loop
    >
      <Command.Input value={q} onValueChange={setQ} placeholder={t.searchPlaceholder} />
      <Command.List>
        <Command.Empty>{t.cmdkEmpty}</Command.Empty>
        {showCommands && (
          <Command.Group heading={t.cmdkActions}>
            {PALETTE_COMMANDS.map((c) => (
              <Command.Item key={c.id} value={c.id} onSelect={() => execute(c)}>
                <span className="cmdk-name">
                  {c.icon} {PALETTE_LABEL[locale][c.kind]}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {showCommands && (
          <Command.Group heading={t.quickNav}>
            <Command.Item value="nav-chat" onSelect={() => run(null)}>
              ✦ {t.chatNav}
            </Command.Item>
            <Command.Item value="nav-home" onSelect={() => run('home')}>
              ⌂ {t.homeNav} <span className="cmdk-count">({visibleToolCount()})</span>
            </Command.Item>
          </Command.Group>
        )}
        {groups.map(([sec, tools]) => (
          <Command.Group key={sec} heading={`${SECTION_ICONS[sec]} ${sectionName(sec)}`}>
            {tools.map((tool) => (
              <Command.Item key={tool.id} value={tool.id} onSelect={() => run(tool.id)}>
                <span className="cmdk-name">{toolName(tool)}</span>
                <span className="cmdk-desc">{toolDesc(tool)}</span>
                {tool.hot && <span className="text-[9px] text-amber">★</span>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
      <div className="cmdk-foot">
        <span>
          <kbd>↑↓</kbd> {t.cmdkSelect}
        </span>
        <span>
          <kbd>↵</kbd> {t.cmdkOpen}
        </span>
        <span>
          <kbd>esc</kbd> {t.closeMenu}
        </span>
      </div>
    </Command.Dialog>
  )
}

/* ================= Home ================= */

function HomeView({
  grouped,
  onOpen,
}: {
  grouped: Map<SectionId, SectionGroup>
  onOpen: (id: string | null) => void
}) {
  const { t, toolName, toolDesc, sectionName, sectionDesc } = useI18n()
  /** 「+N 更多」点开后就保持展开：回头看一眼全部比反复折叠更顺手 */
  const [expanded, setExpanded] = useState<ReadonlySet<SectionId>>(new Set())
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t.greetMorning : hour < 18 ? t.greetAfternoon : t.greetEvening
  const favorites = visibleTools().filter((x) => x.hot)

  const expandSection = (sec: SectionId): void => {
    setExpanded((prev) => new Set(prev).add(sec))
  }

  return (
    <div className="fade-in">
      <div className="w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 pt-10 md:pt-12 pb-12 pb-safe">
        {/* hero：时段问候 + 一句话定位 + 能力 chips（白卡丸，不描边） */}
        <div className="mb-7">
          <h1 className="text-[26px] md:text-[30px] font-extrabold tracking-tight text-bright">
            {greeting}
          </h1>
          <p className="mt-2.5 text-[13.5px] text-muted max-w-2xl leading-relaxed">
            {t.hero(visibleToolCount())}
          </p>
          <div className="mt-4 flex gap-2 flex-wrap text-[11.5px]">
            {t.heroChips.map((k) => (
              <span key={k} className="px-3 py-1 rounded-full bg-panel text-muted shadow-soft-sm">
                {k}
              </span>
            ))}
          </div>
        </div>

        {/* AI 渐变焦点卡：全页唯一的品牌渐变面，视觉锚点 */}
        <button
          onClick={() => onOpen(null)}
          className="grad-hero group relative overflow-hidden w-full text-left rounded-[24px] p-6 md:p-8 text-white shadow-[0_20px_44px_-16px_rgba(11,169,119,.45)] mb-10"
        >
          {/* 装饰弥散光斑 */}
          <div className="absolute -top-36 right-[24%] w-72 h-72 rounded-full bg-white/15 pointer-events-none" />
          <div className="absolute -bottom-24 -right-10 w-52 h-52 rounded-full bg-white/10 pointer-events-none" />
          <div className="relative flex items-center gap-8">
            <div className="flex-1 min-w-0">
              <span className="inline-block text-[10.5px] font-semibold tracking-[0.12em] bg-white/20 rounded-full px-3 py-1">
                {t.featTag}
              </span>
              <div className="mt-3 text-[19px] md:text-[21px] font-bold tracking-tight">
                {t.featTitle}
              </div>
              <p className="mt-2 text-[12.5px] text-white/85 max-w-xl leading-relaxed">
                {t.featDesc}
              </p>
              <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-phosphor transition-transform duration-150 group-hover:translate-x-0.5">
                {t.featCta} <span aria-hidden>→</span>
              </span>
            </div>
            {/* 迷你对话装饰（纯视觉，不进可及性树） */}
            <div
              aria-hidden
              className="hidden md:flex flex-col gap-2.5 w-[280px] shrink-0 select-none"
            >
              <div className="self-end rounded-2xl rounded-br-md bg-white/25 px-3.5 py-2 text-[11.5px] text-white/95">
                curl → fetch
              </div>
              <div className="self-start w-[80%] rounded-2xl rounded-bl-md bg-white/15 px-3.5 py-2.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/90 mr-1" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/60 mr-1" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/35" />
              </div>
            </div>
          </div>
        </button>

        {/* 常用工具：hot 标记聚合，抓包代理以暖色渐变卡点睛 */}
        {favorites.length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="chip-c chip-amber w-8 h-8 !rounded-[11px] text-[14px]">★</span>
              <h2 className="text-[15.5px] font-bold tracking-tight text-bright">{t.favTitle}</h2>
              <span className="text-[11px] text-muted/70">{t.toolsCount(favorites.length)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {favorites.map((tool) =>
                tool.id === WARM_FEATURED_TOOL ? (
                  <WarmToolCard
                    key={tool.id}
                    name={toolName(tool)}
                    desc={toolDesc(tool)}
                    glyph={TOOL_GLYPHS[tool.id] ?? '◎'}
                    onOpen={() => onOpen(tool.id)}
                  />
                ) : (
                  <ToolCard
                    key={tool.id}
                    sec={sectionOf(tool.category)}
                    name={toolName(tool)}
                    desc={toolDesc(tool)}
                    hot={!!tool.hot}
                    glyph={TOOL_GLYPHS[tool.id] ?? SECTION_ICONS[sectionOf(tool.category)]}
                    onOpen={() => onOpen(tool.id)}
                  />
                ),
              )}
            </div>
          </section>
        )}

        {/* 分区网格：平铺（不再按分类分小节），超出 7 个收进「+N 更多」 */}
        {[...grouped.entries()].map(([sec, entry]) => {
          const all = entry.tools
          const shown = expanded.has(sec) ? all : all.slice(0, SEC_PREVIEW)
          const hidden = all.length - shown.length
          return (
            <section key={sec} id={`sec-${sec}`} className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={cn('chip-c w-8 h-8 !rounded-[11px] text-[14px]', SECTION_CHIP[sec])}
                >
                  {SECTION_ICONS[sec]}
                </span>
                <h2 className="text-[15.5px] font-bold tracking-tight text-bright">
                  {sectionName(sec)}
                </h2>
                <span className="text-[11px] text-muted/70">{t.toolsCount(all.length)}</span>
                <span className="hidden md:inline text-[12px] text-muted/70 truncate">
                  {sectionDesc(sec)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {shown.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    sec={sec}
                    name={toolName(tool)}
                    desc={toolDesc(tool)}
                    hot={!!tool.hot}
                    glyph={TOOL_GLYPHS[tool.id] ?? SECTION_ICONS[sec]}
                    onOpen={() => onOpen(tool.id)}
                  />
                ))}
                {hidden > 0 && (
                  <button
                    onClick={() => expandSection(sec)}
                    className="tool-more-card rounded-2xl min-h-[120px] flex flex-col items-center justify-center gap-1 text-[12px] font-medium"
                  >
                    <span className="text-[18px] font-semibold">＋{hidden}</span>
                    {t.moreTools(hidden)}
                  </button>
                )}
              </div>
            </section>
          )
        })}

        <footer className="rounded-2xl bg-panel shadow-soft-sm px-4 py-3 text-[12px] text-muted leading-relaxed">
          <span className="text-amber font-semibold">{t.legalTitle}</span>
          {t.legalBody}
        </footer>
      </div>
    </div>
  )
}

/** 工具卡片：白卡 + 粉彩 chip + 弥散阴影，hover 浮起（不描边） */
function ToolCard({
  sec,
  name,
  desc,
  hot,
  glyph,
  onOpen,
}: {
  sec: SectionId
  name: string
  desc: string
  hot: boolean
  glyph: string
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="tool-grid-card text-left rounded-2xl bg-panel p-4 shadow-soft-card hover:shadow-soft-pop"
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn('chip-c w-9 h-9 !rounded-xl text-[13px]', SECTION_CHIP[sec])}>
          {glyph}
        </span>
        {hot && (
          <span className="text-[9px] font-bold tracking-[0.06em] text-amber bg-amber/10 rounded-full px-2 py-0.5">
            HOT
          </span>
        )}
      </div>
      <div className="text-[13.5px] font-semibold text-bright">{name}</div>
      <div className="mt-1 text-[12px] text-muted leading-relaxed line-clamp-2">{desc}</div>
    </button>
  )
}

/** 暖色渐变焦点卡：常用工具网格里的唯一一张彩色卡（抓包代理） */
function WarmToolCard({
  name,
  desc,
  glyph,
  onOpen,
}: {
  name: string
  desc: string
  glyph: string
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="tool-grid-card grad-warm relative overflow-hidden text-left rounded-2xl p-4 text-white shadow-[0_16px_34px_-14px_rgba(244,114,182,.5)] hover:shadow-[0_24px_48px_-16px_rgba(244,114,182,.6)]"
    >
      <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-white/15 pointer-events-none" />
      <div className="relative flex items-center justify-between mb-3">
        <span className="chip-c w-9 h-9 !rounded-xl text-[13px] bg-white/20 text-white">
          {glyph}
        </span>
        <span className="text-[9px] font-bold tracking-[0.06em] bg-white/25 rounded-full px-2 py-0.5">
          HOT
        </span>
      </div>
      <div className="relative text-[13.5px] font-bold">{name}</div>
      <div className="relative mt-1 text-[12px] text-white/85 leading-relaxed line-clamp-2">
        {desc}
      </div>
    </button>
  )
}

/* ================= Tool view ================= */

function ToolView({ tool, onBack }: { tool: ToolDef; onBack: () => void }) {
  const { catName, toolName, toolDesc, sectionName } = useI18n()
  const C = tool.component
  const sec = sectionOf(tool.category)
  // 组里只有一个分类时（AI 组就是），面包屑不再重复一遍分类名
  const showCat = (SECTIONS.find((s) => s.id === sec)?.categories.length ?? 1) > 1
  return (
    <div className="fade-in w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-4 md:py-6 pb-12 pb-safe">
      <div className="flex items-center gap-2 md:gap-2.5 text-[12.5px] text-muted mb-1">
        <button
          onClick={onBack}
          className="text-phosphor/80 hover:text-phosphor rounded-md px-1.5 py-0.5 border border-line-soft lg:border-0 !min-h-0"
        >
          ←
        </button>
        <button onClick={onBack} className="shrink-0 hidden md:inline hover:text-bright !min-h-0">
          {sectionName(sec)}
        </button>
        {showCat && (
          <>
            <span className="text-muted/50 hidden md:inline">/</span>
            <span className="shrink-0">{catName(tool.category)}</span>
          </>
        )}
        <span className="text-muted/50">/</span>
        <span className="text-bright truncate">{toolName(tool)}</span>
      </div>
      <div className="rounded-[20px] bg-panel shadow-soft-card mt-3 overflow-hidden">
        <div className="border-b border-line-soft px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold text-bright truncate">{toolName(tool)}</h1>
              <span className="hidden md:inline shrink-0 rounded bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[10.5px] font-mono text-muted">
                {tool.id}
              </span>
            </div>
            <p className="text-[12px] text-muted mt-0.5">{toolDesc(tool)}</p>
          </div>
        </div>
        <div className="p-4">
          {/* 工具组件按需懒加载：分片拉取期间显示轻量占位，避免布局跳动 */}
          <Suspense fallback={<div className="py-16 text-center text-[13px] text-muted">…</div>}>
            <C />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
