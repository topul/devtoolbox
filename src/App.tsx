import React, { useState, useMemo, useEffect, useCallback } from 'react'
import MatrixRain from './components/MatrixRain'
import { TOOLS, CATEGORIES, searchTools, ToolDef, CategoryId } from './lib/registry'
import { useTheme } from './lib/theme'
import { useUiZoom } from './lib/uiZoom'
import { useSidebarCollapsed } from './lib/sidebar'
import { useI18n, I18nProvider } from './lib/i18n'
import { getVersion } from './lib/version'
import { UpdateToast, useUpdater } from './components/Updater'

const ASCII_LOGO = `
 ▄▄▄▄·       ▄▄ • ▄• ▄▌ ▄▄· ▄ •▄ ▄▄▄▄·       ▐▄• ▄
 ▐█ ▀█▪▪     ▐█ ▀ ▪█▪██▌▐█ ▌▪█▌▄▌▪▐█ ▀█▪ ▪      █▌█▌▪
 ▐█▀▀█▄ ▄█▀▄ ▄█ ▀█▄█▌▐█▌██ ▄▄▐▀▀▄·▐█▀▀█▄  ▄█▀▄ ·▀·
 ██▄▪▐█▐█▌.▐▌▐█▄▪▐█▐█▄█▌▐███▌▐█.█▌██▄▪▐█ ▐█▌.▐▌▪▐█·█▌
 ·▀▀▀▀  ▀█▄▀▪·▀▀▀▀  ▀▀▀ ·▀▀▀ ·▀  ▀·▀▀▀▀   ▀█▄▀▪•▀▀ ▀▀
`.trim()

const CAT_ICONS: Record<string, string> = {
  encoding: '⇄', format: '≡', generators: '⚙', crypto: '⚿',
  text: '¶', datetime: '◷', network: '⌁', http: '⇅', offsec: '☠', reference: '▤',
}

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  )
}

function AppInner() {
  const { locale, setLocale, t, toolName, catName } = useI18n()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(() => location.hash.replace('#', '') || null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [version, setVersion] = useState('')
  const { theme, toggleTheme } = useTheme()
  const zoom = useUiZoom()
  const sidebar = useSidebarCollapsed()
  const updater = useUpdater()
  const searchRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    getVersion().then(setVersion)
  }, [])

  useEffect(() => {
    if (sidebarOpen) setTimeout(() => searchRef.current?.focus(), 220)
  }, [sidebarOpen])

  const openTool = useCallback((id: string | null) => {
    setActiveId(id)
    location.hash = id ?? ''
    setSidebarOpen(false)
    window.scrollTo({ top: 0 })
  }, [])

  /** 窄栏里点分类图标：回到首页并滚到对应分区（收起状态下也能快速跳转） */
  const jumpToCategory = useCallback((cat: CategoryId) => {
    openTool(null)
    setTimeout(() => {
      document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [openTool])

  /** 窄栏里点搜索：展开侧栏并把焦点给搜索框 */
  const expandAndFocusSearch = useCallback(() => {
    sidebar.setCollapsed(false)
    setTimeout(() => searchRef.current?.focus(), 220)
  }, [sidebar])

  useEffect(() => {
    const onHash = () => setActiveId(location.hash.replace('#', '') || null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const results = useMemo(() => searchTools(query), [query])
  const active = TOOLS.find(t => t.id === activeId) ?? null

  const grouped = useMemo(() => {
    const map = new Map<CategoryId, ToolDef[]>()
    for (const cat of CATEGORIES) {
      const items = results.filter(t => t.category === cat)
      if (items.length) map.set(cat, items)
    }
    return map
  }, [results])

  return (
    <div className="scanlines min-h-screen bg-terminal flex">
      {/* ============ Sidebar ============ */}
      <aside className={`
        fixed lg:sticky top-0 z-50 h-screen h-[100dvh] w-[82vw] max-w-[300px] shrink-0 flex flex-col
        border-r border-line bg-panel/95 lg:bg-panel backdrop-blur
        transition-[transform,width] duration-200 pt-safe pl-safe
        ${sidebar.collapsed ? 'lg:w-[3.25rem]' : 'lg:w-64'}
        ${sidebarOpen ? 'translate-x-0 shadow-[0_0_40px_rgba(0,244,142,0.15)]' : '-translate-x-full lg:translate-x-0 lg:shadow-none'}
      `}>
        {/* ===== 桌面端窄栏（收起态） ===== */}
        {sidebar.collapsed && (
          <div data-sb-rail className="hidden lg:flex flex-col flex-1 min-h-0">
            <button
              onClick={() => openTool(null)}
              className="py-3 text-phosphor font-bold text-[12px] tracking-wider glow hover:text-phosphor-glow !min-h-0"
              title={`${t.allTools} (${TOOLS.length})`}
              aria-label={t.allTools}
            >&gt;_</button>
            <button
              onClick={sidebar.toggle}
              className="py-2 border-y border-line-soft text-muted hover:text-phosphor text-[13px] !min-h-0"
              title={t.expandSidebar}
              aria-label={t.expandSidebar}
            >»</button>
            <button
              onClick={expandAndFocusSearch}
              className="py-2.5 border-b border-line-soft text-muted hover:text-phosphor text-[13px] !min-h-0"
              title={t.searchToolsAria}
              aria-label={t.searchToolsAria}
            >⌕</button>

            <div className="flex-1 min-h-0 overflow-y-auto py-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => jumpToCategory(cat)}
                  className="w-full py-2 text-[14px] text-dim hover:text-phosphor hover:bg-phosphor-faint/50 transition-colors !min-h-0"
                  title={`${t.jumpToCategory}: ${catName(cat)}`}
                  aria-label={catName(cat)}
                >{CAT_ICONS[cat]}</button>
              ))}
            </div>

            <div className="border-t border-line-soft py-1">
              <button
                onClick={zoom.cycle}
                className="w-full py-1.5 text-muted hover:text-phosphor text-[11px] !min-h-0"
                title={t.zoomTip}
                aria-label={t.zoomTip}
              >⇕</button>
              <button
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                className="w-full py-1.5 text-muted hover:text-phosphor text-[10px] !min-h-0"
                title={t.switchLangTip}
                aria-label={t.switchLangTip}
              >{t.langSwitch}</button>
              <button
                onClick={toggleTheme}
                className="w-full py-1.5 text-muted hover:text-phosphor text-[11px] !min-h-0"
                title={theme === 'dark' ? t.switchToLight : t.switchToDark}
                aria-label={t.toggleTheme}
              >{theme === 'dark' ? '◑' : '◐'}</button>
            </div>
          </div>
        )}

        {/* ===== 移动端抽屉 + 桌面端展开态 ===== */}
        <div className={`flex flex-col flex-1 min-h-0 ${sidebar.collapsed ? 'lg:hidden' : ''}`}>
          <div className="flex items-center border-b border-line">
            <button onClick={() => openTool(null)} className="flex-1 text-left px-4 pt-4 pb-3 group !min-h-0">
              <div className="text-phosphor font-bold text-[15px] tracking-wider glow group-hover:text-phosphor-glow">
                &gt;_ BUGBUCKET.BOX
              </div>
              <div className="text-[10px] text-muted tracking-[0.25em] mt-0.5">DEV × SEC TOOLKIT</div>
            </button>
            <button
              onClick={sidebar.toggle}
              className="hidden lg:flex items-center self-stretch px-3 text-muted hover:text-phosphor text-[14px] transition-colors"
              title={t.collapseSidebar}
              aria-label={t.collapseSidebar}
            >«</button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden px-4 self-stretch flex items-center text-muted text-xl"
              aria-label={t.closeMenu}
            >×</button>
          </div>

          <div className="p-3 border-b border-line-soft">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-[11px]">⌕</span>
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full bg-panel-2 border border-line-soft pl-7 pr-2 py-2 lg:py-1.5 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
              />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-2">
            <button
              onClick={() => openTool(null)}
              className={`w-full text-left px-4 py-2.5 lg:py-1.5 text-[13px] lg:text-[12px] transition-colors ${!active ? 'text-phosphor bg-phosphor-faint border-r-2 border-phosphor' : 'text-muted hover:text-bright'}`}
            >
              [ ~ ] {t.allTools} <span className="text-muted/50 text-[10px]">({TOOLS.length})</span>
            </button>
            {[...grouped.entries()].map(([cat, items]) => (
              <div key={cat} className="mt-3">
                <div className="px-4 pb-1 text-[10px] uppercase tracking-[0.2em] text-muted/70 select-none">
                  {CAT_ICONS[cat]} {catName(cat)}
                </div>
                {items.map(t => (
                  <button
                    key={t.id}
                    onClick={() => openTool(t.id)}
                    className={`w-full text-left px-4 py-2.5 lg:py-1.5 text-[13px] lg:text-[12px] transition-colors truncate
                      ${active?.id === t.id
                        ? 'text-phosphor bg-phosphor-faint border-r-2 border-phosphor'
                        : 'text-dim hover:text-phosphor hover:bg-phosphor-faint/50'}`}
                  >
                    <span className="text-phosphor/40 mr-1.5">{active?.id === t.id ? '[x]' : '[ ]'}</span>
                    {toolName(t)}
                    {t.hot && <span className="ml-1.5 text-[9px] text-amber">★</span>}
                  </button>
                ))}
              </div>
            ))}
            {grouped.size === 0 && (
              <div className="px-4 py-6 text-center text-muted text-[12px]">
                {t.noMatch}
              </div>
            )}
          </nav>

          {/* 底栏：声明 / 操作 / 版本 三块分离，不再挤成一行 */}
          <div data-sb-foot className="border-t border-line px-3 pt-2.5 pb-safe space-y-2">
            <div className="text-[10px] text-muted/70 leading-snug">
              <span className="text-danger/80">⚠</span> {t.disclaimer}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={zoom.cycle}
                className="border border-line-soft px-1.5 py-1.5 text-[10px] text-muted text-center truncate hover:text-phosphor hover:border-phosphor/40 transition-colors"
                aria-label={t.zoomTip}
                title={t.zoomTip}
              >
                ⇕ {zoom.percent || t.zoomAuto}
              </button>
              <button
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                className="border border-line-soft px-1.5 py-1.5 text-[10px] text-muted text-center truncate hover:text-phosphor hover:border-phosphor/40 transition-colors"
                aria-label={t.switchLangTip}
                title={t.switchLangTip}
              >
                {t.langSwitch}
              </button>
              <button
                onClick={toggleTheme}
                className="border border-line-soft px-1.5 py-1.5 text-[10px] text-muted text-center truncate hover:text-phosphor hover:border-phosphor/40 transition-colors"
                aria-label={t.toggleTheme}
                title={theme === 'dark' ? t.switchToLight : t.switchToDark}
              >
                {theme === 'dark' ? t.themeLight : t.themeDark}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted/60">
              <span className="truncate">{t.localCompute} · v{version || '...'}</span>
              {window.electronAPI && (
                <button
                  onClick={() => window.electronAPI?.checkForUpdates()}
                  className="shrink-0 text-muted/70 hover:text-phosphor border border-line-soft hover:border-phosphor/40 px-1.5 py-1 text-[9px] transition-colors"
                >
                  {t.checkUpdate}
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-terminal/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ============ Main ============ */}
      <main className="flex-1 min-w-0 content-zoom">
        {/* mobile topbar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-1 border-b border-line bg-panel/95 backdrop-blur px-2 py-1.5 pt-safe">
          <button onClick={() => setSidebarOpen(true)} className="text-phosphor text-lg px-3 py-1" aria-label={t.openMenu}>☰</button>
          <button onClick={() => openTool(null)} className="text-phosphor text-[13px] font-semibold tracking-wider px-1 py-1 !min-h-0">
            &gt;_ BUGBUCKET.BOX
          </button>
          <span className="flex-1 text-right text-[11px] text-muted truncate px-2">
            {active ? `${CAT_ICONS[active.category]} ${toolName(active)}` : ''}
          </span>
          <button
            onClick={toggleTheme}
            className="text-muted border border-line-soft px-2.5 py-1 text-[12px] hover:text-phosphor transition-colors"
            aria-label={t.toggleTheme}
            title={theme === 'dark' ? t.switchToLight : t.switchToDark}
          >{theme === 'dark' ? '◐' : '◑'}</button>
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-muted border border-line-soft px-2.5 py-1 text-[12px]"
            aria-label={t.searchToolsAria}
          >⌕</button>
        </div>

        {!active ? (
          <HomeView grouped={grouped} onOpen={openTool} query={query} />
        ) : (
          <ToolView tool={active} onBack={() => openTool(null)} />
        )}
      </main>

      <UpdateToast state={updater} />
    </div>
  )
}

/* ================= Home ================= */

function HomeView({ grouped, onOpen, query }: {
  grouped: Map<CategoryId, ToolDef[]>
  onOpen: (id: string) => void
  query: string
}) {
  const { t, catName, toolName, toolDesc } = useI18n()
  return (
    <div className="fade-in">
      {/* hero */}
      <div className="relative border-b border-line overflow-hidden">
        <MatrixRain opacity={0.16} />
        <div className="relative w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-8 md:py-14">
          <pre className="hidden md:block text-phosphor/90 text-[9px] leading-[1.15] glow select-none whitespace-pre">{ASCII_LOGO}</pre>
          <h1 className="md:hidden text-3xl font-bold text-phosphor glow">&gt;_ BUGBUCKET.BOX</h1>
          <p className="mt-4 text-[13px] text-muted max-w-xl leading-relaxed">
            <span className="text-phosphor">$</span> {t.hero(TOOLS.length)}<span className="cursor-blink text-phosphor">▌</span>
          </p>
          <div className="mt-5 flex gap-2 flex-wrap text-[11px]">
            {t.heroChips.map(k => (
              <span key={k} className="px-2 py-0.5 border border-line-soft text-muted">{k}</span>
            ))}
          </div>
        </div>
      </div>

      {/* tool grid */}
      <div className="w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-6 md:py-8 pb-12 pb-safe space-y-8">
        {[...grouped.entries()].map(([cat, items]) => (
          <section key={cat} id={`cat-${cat}`}>
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="text-[13px] text-phosphor tracking-wider">
                <span className="text-muted">##</span> {CAT_ICONS[cat]} {catName(cat)}
              </h2>
              <span className="text-[10px] text-muted/60">{t.toolsCount(items.length)}</span>
              <div className="flex-1 border-t border-line-soft" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5">
              {items.map(t => (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="tool-grid-card text-left border border-line-soft bg-panel px-4 py-3 hover:border-phosphor/50 hover:bg-phosphor-faint"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-cardtext">{toolName(t)}</span>
                    {t.hot && <span className="text-[9px] text-amber border border-amber/30 px-1">HOT</span>}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted leading-relaxed">{toolDesc(t)}</div>
                  <div className="mt-2 text-[10px] text-phosphor/40">./run --tool={t.id} →</div>
                </button>
              ))}
            </div>
          </section>
        ))}
        {grouped.size === 0 && (
          <div className="text-center py-16 text-muted">
            <div className="text-4xl text-phosphor/30 mb-3">[ 404 ]</div>
            {t.noMatchHome(query)}
          </div>
        )}

        <footer className="border border-danger/30 bg-danger/5 px-4 py-3 text-[11.5px] text-muted leading-relaxed">
          <span className="text-danger font-semibold">{t.legalTitle}</span>
          {t.legalBody}
        </footer>
      </div>
    </div>
  )
}

/* ================= Tool view ================= */

function ToolView({ tool, onBack }: { tool: ToolDef; onBack: () => void }) {
  const { catName, toolName, toolDesc } = useI18n()
  const C = tool.component
  return (
    <div className="fade-in w-full mx-auto max-w-[1720px] px-4 md:px-8 xl:px-10 py-4 md:py-6 pb-12 pb-safe">
      <div className="flex items-center gap-2 md:gap-3 text-[12px] text-muted mb-1">
        <button onClick={onBack} className="text-phosphor/70 hover:text-phosphor px-1.5 py-0.5 border border-line-soft lg:border-0 !min-h-0">← ~/</button>
        <span className="shrink-0">{catName(tool.category)}</span>
        <span className="text-muted/50">/</span>
        <span className="text-bright truncate">{toolName(tool)}</span>
      </div>
      <div className="border border-line bg-panel mt-3">
        <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[16px] text-phosphor glow font-semibold">
              $ ./{tool.id} <span className="cursor-blink">▌</span>
            </h1>
            <p className="text-[11.5px] text-muted mt-0.5">{toolDesc(tool)}</p>
          </div>
          <div className="hidden md:flex gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-danger/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-phosphor/70" />
          </div>
        </div>
        <div className="p-4">
          <C />
        </div>
      </div>
    </div>
  )
}
