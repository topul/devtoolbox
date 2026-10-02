import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react'
import { Command } from 'cmdk'
import { TOOLS, SECTIONS, sectionOf, searchTools, toolsInSection, visibleToolCount, ToolDef, CategoryId, SectionId } from './lib/registry'
import { useTheme } from './lib/theme'
import { useUiZoom } from './lib/uiZoom'
import { useSidebarCollapsed, useOpenSections } from './lib/sidebar'
import { useI18n, I18nProvider } from './lib/i18n'
import { getVersion } from './lib/version'
import { UpdateToast, useUpdater } from './components/Updater'
import { ChatTool } from './tools/chat'
import { cn } from './lib/cn'

/**
 * 导航分组的图标：侧栏窄栏、侧栏展开态、首页分区、命令面板共用一套。
 * 用 Unicode 符号而不是图标库：零依赖，且与各平台系统字体兼容。
 */
const SECTION_ICONS: Record<SectionId, string> = {
  ai: '✦', http: '⇅', codec: '⇄', security: '⚿', network: '⌁', content: '⚙', misc: '▤',
}

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
  const [activeId, setActiveId] = useState<string | null>(() => location.hash.replace('#', '') || null)
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
  const jumpToSection = useCallback((sec: SectionId) => {
    openTool(null)
    setTimeout(() => {
      document.getElementById(`sec-${sec}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [openTool])

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

  const active = TOOLS.find(t => t.id === activeId) ?? null

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
        const items = tools.filter(t => t.category === cat)
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
      <aside className={`
        fixed lg:sticky top-0 z-50 h-screen h-[100dvh] w-[82vw] max-w-[300px] shrink-0 flex flex-col
        border-r border-line bg-panel/95 lg:bg-panel backdrop-blur
        transition-[transform,width] duration-200 pt-safe pl-safe
        ${sidebar.collapsed ? 'lg:w-[3.25rem]' : 'lg:w-64'}
        ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0 lg:shadow-none'}
      `}>
        {/* ===== 桌面端窄栏（收起态） ===== */}
        {sidebar.collapsed && (
          <div data-sb-rail className="hidden lg:flex flex-col flex-1 min-h-0">
            <button
              onClick={() => openTool(null)}
              className="py-3 text-phosphor text-[15px] hover:opacity-80 !min-h-0"
              title={t.chatNav}
              aria-label={t.chatNav}
            >✦</button>
            <button
              onClick={() => openTool('home')}
              className="py-2 text-muted hover:text-bright text-[14px] !min-h-0"
              title={t.homeNav}
              aria-label={t.homeNav}
            >⌂</button>
            <button
              onClick={sidebar.toggle}
              className="py-2 border-y border-line-soft text-muted hover:text-bright text-[13px] !min-h-0"
              title={t.expandSidebar}
              aria-label={t.expandSidebar}
            >»</button>
            <button
              onClick={() => setPaletteOpen(true)}
              className="py-2.5 border-b border-line-soft text-muted hover:text-bright text-[13px] !min-h-0"
              title={`${t.searchToolsAria} (${kbdHint})`}
              aria-label={t.searchToolsAria}
            >⌕</button>

            <div className="flex-1 min-h-0 overflow-y-auto py-1">
              {SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => jumpToSection(sec.id)}
                  className={cn(
                    'w-full py-2 text-[14px] rounded-md transition-colors !min-h-0',
                    sec.id === 'ai' ? 'text-phosphor/80 hover:text-phosphor' : 'text-muted hover:text-bright hover:bg-panel-2',
                  )}
                  title={`${t.jumpToSection}: ${sectionName(sec.id)}`}
                  aria-label={sectionName(sec.id)}
                >{SECTION_ICONS[sec.id]}</button>
              ))}
            </div>

            <div className="border-t border-line-soft py-1">
              <button
                onClick={zoom.cycle}
                className="w-full py-1.5 text-muted hover:text-bright text-[11px] !min-h-0"
                title={t.zoomTip}
                aria-label={t.zoomTip}
              >⇕</button>
              <button
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                className="w-full py-1.5 text-muted hover:text-bright text-[10px] !min-h-0"
                title={t.switchLangTip}
                aria-label={t.switchLangTip}
              >{t.langSwitch}</button>
              <button
                onClick={toggleTheme}
                className="w-full py-1.5 text-muted hover:text-bright text-[11px] !min-h-0"
                title={theme === 'dark' ? t.switchToLight : t.switchToDark}
                aria-label={t.toggleTheme}
              >{theme === 'dark' ? '◑' : '◐'}</button>
            </div>
          </div>
        )}

        {/* ===== 移动端抽屉 + 桌面端展开态 ===== */}
        <div className={cn('flex flex-col flex-1 min-h-0', sidebar.collapsed ? 'lg:hidden' : '')}>
          <div className="flex items-center border-b border-line">
            <button onClick={() => openTool(null)} className="flex-1 text-left px-4 pt-4 pb-3 group !min-h-0">
              <div className="text-[15px] font-bold tracking-tight text-bright group-hover:text-phosphor transition-colors">
                BUGBUCKET<span className="text-phosphor">.BOX</span>
              </div>
              <div className="text-[10px] text-muted tracking-[0.2em] mt-0.5 uppercase">Dev × Sec Toolkit</div>
            </button>
            <button
              onClick={sidebar.toggle}
              className="hidden lg:flex items-center self-stretch px-3 text-muted hover:text-bright text-[14px] transition-colors"
              title={t.collapseSidebar}
              aria-label={t.collapseSidebar}
            >«</button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden px-4 self-stretch flex items-center text-muted text-xl"
              aria-label={t.closeMenu}
            >×</button>
          </div>

          {/* 搜索入口：直接打开命令面板（⌘K），不再做侧栏内过滤 */}
          <div className="p-3 border-b border-line-soft">
            <button
              onClick={() => setPaletteOpen(true)}
              className="w-full flex items-center gap-2 rounded-md bg-panel-2 border border-line-soft px-2.5 py-1.5 text-[12.5px] text-muted hover:border-phosphor/40 transition-colors"
            >
              <span className="text-[12px]">⌕</span>
              <span className="flex-1 text-left truncate">{t.searchPlaceholder}</span>
              <kbd className="shrink-0 rounded border border-line bg-panel px-1 py-0.5 text-[10px] text-muted">{kbdHint}</kbd>
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            <button
              onClick={() => openTool(null)}
              className={cn(
                'w-full text-left rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors',
                view === 'chat' ? 'bg-phosphor-faint text-phosphor font-medium' : 'text-muted hover:text-bright hover:bg-panel-2',
              )}
            >
              ✦ {t.chatNav}
            </button>
            <button
              onClick={() => openTool('home')}
              className={cn(
                'w-full text-left rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors',
                view === 'home' ? 'bg-phosphor-faint text-phosphor font-medium' : 'text-muted hover:text-bright hover:bg-panel-2',
              )}
            >
              ⌂ {t.homeNav} <span className="text-muted/60 text-[10.5px]">({visibleToolCount()})</span>
            </button>

            {[...grouped.entries()].map(([sec, entry]) => {
              const open = openSections.isOpen(sec)
              const multiCat = entry.cats.size > 1
              return (
                <div key={sec} className="pt-1">
                  <button
                    onClick={() => openSections.toggle(sec)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-panel-2 text-muted hover:text-bright"
                  >
                    <span className={cn('text-[9px] w-2 shrink-0 text-muted/60 transition-transform duration-200', open && 'rotate-90')}>▶</span>
                    <span className="text-[12px] font-medium truncate">
                      {SECTION_ICONS[sec]} {sectionName(sec)}
                    </span>
                    <span className="ml-auto text-[10.5px] text-muted/60 shrink-0">{entry.tools.length}</span>
                  </button>

                  <div className="collapse-grid" style={{ gridTemplateRows: open ? '1fr' : '0fr' }} aria-hidden={!open}>
                    <div>
                      <div className="pb-1 pl-3">
                        {[...entry.cats.entries()].map(([cat, items]) => (
                          <div key={cat}>
                            {multiCat && (
                              <div className="pl-3 pr-2 pt-1.5 pb-0.5 text-[10.5px] text-muted/60 select-none truncate">
                                {catName(cat)}
                              </div>
                            )}
                            {items.map(item => (
                              <button
                                key={item.id}
                                onClick={() => openTool(item.id)}
                                className={cn(
                                  'w-full text-left rounded-md pl-6 pr-2 py-1.5 text-[12.5px] transition-colors truncate',
                                  active?.id === item.id
                                    ? 'bg-phosphor-faint text-phosphor font-medium'
                                    : 'text-muted hover:text-bright hover:bg-panel-2',
                                )}
                              >
                                {toolName(item)}
                                {item.hot && <span className="ml-1.5 text-[9px] text-amber">★</span>}
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
          <div data-sb-foot className="border-t border-line px-3 pt-2 pb-safe space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={zoom.cycle}
                className="rounded-md border border-line-soft px-1.5 py-1.5 text-[10.5px] text-muted text-center truncate hover:text-bright hover:border-line transition-colors"
                aria-label={t.zoomTip}
                title={t.zoomTip}
              >
                ⇕ {zoom.percent || t.zoomAuto}
              </button>
              <button
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                className="rounded-md border border-line-soft px-1.5 py-1.5 text-[10.5px] text-muted text-center truncate hover:text-bright hover:border-line transition-colors"
                aria-label={t.switchLangTip}
                title={t.switchLangTip}
              >
                {t.langSwitch}
              </button>
              <button
                onClick={toggleTheme}
                className="rounded-md border border-line-soft px-1.5 py-1.5 text-[10.5px] text-muted text-center truncate hover:text-bright hover:border-line transition-colors"
                aria-label={t.toggleTheme}
                title={theme === 'dark' ? t.switchToLight : t.switchToDark}
              >
                {theme === 'dark' ? t.themeLight : t.themeDark}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted/80">
              <span className="truncate">
                <span className="cursor-help text-amber/90" title={t.disclaimer}>ⓘ</span> {t.localCompute} · v{version || '...'}
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
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 anim-overlay-in" style={{ background: 'var(--c-overlay)' }} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ============ 命令面板（⌘K） ============ */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenTool={openTool} />

      {/* ============ Main ============ */}
      <main className={cn('flex-1 min-w-0 content-zoom', view === 'chat' ? 'overflow-hidden' : '')}>
        {/* mobile topbar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-1 border-b border-line bg-panel/95 backdrop-blur px-2 py-1.5 pt-safe">
          <button onClick={() => setSidebarOpen(true)} className="text-bright text-lg px-3 py-1" aria-label={t.openMenu}>☰</button>
          <button onClick={() => openTool(null)} className="text-[13px] font-semibold tracking-tight text-bright px-1 py-1 !min-h-0">
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
          >{theme === 'dark' ? '◐' : '◑'}</button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="text-muted rounded-md border border-line-soft px-2.5 py-1 text-[12px]"
            aria-label={t.searchToolsAria}
          >⌕</button>
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
function CommandPalette({ open, onOpenChange, onOpenTool }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onOpenTool: (id: string | null) => void
}) {
  const { t, toolName, toolDesc, sectionName } = useI18n()
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

  const run = useCallback((id: string | null) => {
    onOpenTool(id)
    onOpenChange(false)
  }, [onOpenTool, onOpenChange])

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
        <Command.Group heading={t.quickNav}>
          <Command.Item value="nav-chat" onSelect={() => run(null)}>✦ {t.chatNav}</Command.Item>
          <Command.Item value="nav-home" onSelect={() => run('home')}>⌂ {t.homeNav} <span className="cmdk-count">({visibleToolCount()})</span></Command.Item>
        </Command.Group>
        {groups.map(([sec, tools]) => (
          <Command.Group key={sec} heading={`${SECTION_ICONS[sec]} ${sectionName(sec)}`}>
            {tools.map(tool => (
              <Command.Item
                key={tool.id}
                value={tool.id}
                onSelect={() => run(tool.id)}
              >
                <span className="cmdk-name">{toolName(tool)}</span>
                <span className="cmdk-desc">{toolDesc(tool)}</span>
                {tool.hot && <span className="text-[9px] text-amber">★</span>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
      <div className="cmdk-foot">
        <span><kbd>↑↓</kbd> {t.cmdkSelect}</span>
        <span><kbd>↵</kbd> {t.cmdkOpen}</span>
        <span><kbd>esc</kbd> {t.closeMenu}</span>
      </div>
    </Command.Dialog>
  )
}

/* ================= Home ================= */

function HomeView({ grouped, onOpen }: {
  grouped: Map<SectionId, SectionGroup>
  onOpen: (id: string) => void
}) {
  const { t, catName, toolName, toolDesc, sectionName, sectionDesc } = useI18n()
  return (
    <div className="fade-in">
      {/* hero */}
      <div className="border-b border-line bg-gradient-to-b from-phosphor-faint/60 to-transparent">
        <div className="w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-10 md:py-14">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-bright">
            BUGBUCKET<span className="text-phosphor">.BOX</span>
          </h1>
          <p className="mt-3 text-[13.5px] text-muted max-w-2xl leading-relaxed">{t.hero(visibleToolCount())}</p>
          <div className="mt-5 flex gap-2 flex-wrap text-[11.5px]">
            {t.heroChips.map(k => (
              <span key={k} className="px-2.5 py-0.5 rounded-full border border-line text-muted bg-panel">{k}</span>
            ))}
          </div>
        </div>
      </div>

      {/* tool grid */}
      <div className="w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-6 md:py-8 pb-12 pb-safe space-y-8">
        {[...grouped.entries()].map(([sec, entry]) => (
          <section key={sec} id={`sec-${sec}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
              <h2 className="text-[15px] font-semibold tracking-tight text-bright">
                <span className="text-phosphor">{SECTION_ICONS[sec]}</span> {sectionName(sec)}
              </h2>
              <span className="text-[11px] text-muted/70">{t.toolsCount(entry.tools.length)}</span>
              <span className="hidden md:inline text-[12px] text-muted/70">{sectionDesc(sec)}</span>
              <div className="flex-1 border-t border-line-soft min-w-8" />
            </div>

            {/* 组内再按分类分小节；只有一个分类时（如 AI 组）不重复标题 */}
            {[...entry.cats.entries()].map(([cat, items]) => (
              <div key={cat} className={entry.cats.size > 1 ? 'mb-5 last:mb-0' : ''}>
                {entry.cats.size > 1 && (
                  <div className="text-[11.5px] text-muted/70 mb-2 select-none">
                    {catName(cat)}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                  {items.map(tool => (
                    <button
                      key={tool.id}
                      onClick={() => onOpen(tool.id)}
                      className="tool-grid-card text-left rounded-xl border border-line bg-panel px-4 py-3.5 hover:border-phosphor/40 hover:shadow-md"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-bright">{toolName(tool)}</span>
                        {tool.hot && <span className="text-[9.5px] text-amber border border-amber/30 rounded px-1 py-px">HOT</span>}
                      </div>
                      <div className="mt-1 text-[12px] text-muted leading-relaxed">{toolDesc(tool)}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
        <footer className="rounded-lg border border-line bg-panel px-4 py-3 text-[12px] text-muted leading-relaxed">
          <span className="text-amber font-semibold">{t.legalTitle}</span>
          {t.legalBody}
        </footer>
      </div>
    </div>
  )
}

/* ================= Tool view ================= */

function ToolView({ tool, onBack }: { tool: ToolDef; onBack: () => void }) {
  const { catName, toolName, toolDesc, sectionName } = useI18n()
  const C = tool.component
  const sec = sectionOf(tool.category)
  // 组里只有一个分类时（AI 组就是），面包屑不再重复一遍分类名
  const showCat = (SECTIONS.find(s => s.id === sec)?.categories.length ?? 1) > 1
  return (
    <div className="fade-in w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-4 md:py-6 pb-12 pb-safe">
      <div className="flex items-center gap-2 md:gap-2.5 text-[12.5px] text-muted mb-1">
        <button onClick={onBack} className="text-phosphor/80 hover:text-phosphor rounded-md px-1.5 py-0.5 border border-line-soft lg:border-0 !min-h-0">←</button>
        <button onClick={onBack} className="shrink-0 hidden md:inline hover:text-bright !min-h-0">{sectionName(sec)}</button>
        {showCat && (
          <>
            <span className="text-muted/50 hidden md:inline">/</span>
            <span className="shrink-0">{catName(tool.category)}</span>
          </>
        )}
        <span className="text-muted/50">/</span>
        <span className="text-bright truncate">{toolName(tool)}</span>
      </div>
      <div className="rounded-xl border border-line bg-panel mt-3 overflow-hidden">
        <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold text-bright truncate">{toolName(tool)}</h1>
              <span className="hidden md:inline shrink-0 rounded bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[10.5px] font-mono text-muted">{tool.id}</span>
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
