import React, { useState, useMemo, useEffect, useCallback } from 'react'
import MatrixRain from './components/MatrixRain'
import { TOOLS, CATEGORIES, searchTools, ToolDef } from './lib/registry'
import { useTheme } from './lib/theme'
import { getVersion } from './lib/version'

const ASCII_LOGO = `
 ▄▄▄▄·       ▄▄ • ▄• ▄▌ ▄▄· ▄ •▄ ▄▄▄▄·       ▐▄• ▄
 ▐█ ▀█▪▪     ▐█ ▀ ▪█▪██▌▐█ ▌▪█▌▄▌▪▐█ ▀█▪ ▪      █▌█▌▪
 ▐█▀▀█▄ ▄█▀▄ ▄█ ▀█▄█▌▐█▌██ ▄▄▐▀▀▄·▐█▀▀█▄  ▄█▀▄ ·▀·
 ██▄▪▐█▐█▌.▐▌▐█▄▪▐█▐█▄█▌▐███▌▐█.█▌██▄▪▐█ ▐█▌.▐▌▪▐█·█▌
 ·▀▀▀▀  ▀█▄▀▪·▀▀▀▀  ▀▀▀ ·▀▀▀ ·▀  ▀·▀▀▀▀   ▀█▄▀▪•▀▀ ▀▀
`.trim()

const CAT_ICONS: Record<string, string> = {
  '编码转换': '⇄', '格式化': '≡', '生成器': '⚙', '加密与哈希': '⚿',
  '文本处理': '¶', '时间与日期': '◷', '网络解析': '⌁', '渗透测试': '☠', '参考速查': '▤',
}

export default function App() {
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(() => location.hash.replace('#', '') || null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [version, setVersion] = useState('')
  const { theme, toggleTheme } = useTheme()
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

  useEffect(() => {
    const onHash = () => setActiveId(location.hash.replace('#', '') || null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const results = useMemo(() => searchTools(query), [query])
  const active = TOOLS.find(t => t.id === activeId) ?? null

  const grouped = useMemo(() => {
    const map = new Map<string, ToolDef[]>()
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
        fixed lg:sticky top-0 z-50 h-screen h-[100dvh] w-[82vw] max-w-[300px] lg:w-64 shrink-0 flex flex-col
        border-r border-line bg-panel/95 lg:bg-panel backdrop-blur
        transition-transform duration-200 pt-safe pl-safe
        ${sidebarOpen ? 'translate-x-0 shadow-[0_0_40px_rgba(0,244,142,0.15)]' : '-translate-x-full lg:translate-x-0 lg:shadow-none'}
      `}>
        <div className="flex items-center border-b border-line">
          <button onClick={() => openTool(null)} className="flex-1 text-left px-4 pt-4 pb-3 group !min-h-0">
            <div className="text-phosphor font-bold text-[15px] tracking-wider glow group-hover:text-phosphor-glow">
              &gt;_ BUGBUCKET.BOX
            </div>
            <div className="text-[10px] text-muted tracking-[0.25em] mt-0.5">DEV × SEC TOOLKIT</div>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden px-4 self-stretch flex items-center text-muted text-xl"
            aria-label="关闭菜单"
          >×</button>
        </div>

        <div className="p-3 border-b border-line-soft">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-[11px]">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索工具 / payload / 端口..."
              className="w-full bg-panel-2 border border-line-soft pl-7 pr-2 py-2 lg:py-1.5 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          <button
            onClick={() => openTool(null)}
            className={`w-full text-left px-4 py-2.5 lg:py-1.5 text-[13px] lg:text-[12px] transition-colors ${!active ? 'text-phosphor bg-phosphor-faint border-r-2 border-phosphor' : 'text-muted hover:text-bright'}`}
          >
            [ ~ ] 全部工具 <span className="text-muted/50 text-[10px]">({TOOLS.length})</span>
          </button>
          {[...grouped.entries()].map(([cat, items]) => (
            <div key={cat} className="mt-3">
              <div className="px-4 pb-1 text-[10px] uppercase tracking-[0.2em] text-muted/70 select-none">
                {CAT_ICONS[cat]} {cat}
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
                  {t.name}
                  {t.hot && <span className="ml-1.5 text-[9px] text-amber">★</span>}
                </button>
              ))}
            </div>
          ))}
          {grouped.size === 0 && (
            <div className="px-4 py-6 text-center text-muted text-[12px]">
              [404] 没有匹配的工具
            </div>
          )}
        </nav>

        <div className="border-t border-line px-4 py-2.5 pb-safe text-[10px] text-muted/70 leading-relaxed">
          <div className="flex items-center justify-between mb-1">
            <span><span className="text-danger/80">⚠</span> 仅供授权测试与学习研究</span>
            <button
              onClick={toggleTheme}
              className="text-muted hover:text-phosphor border border-line-soft hover:border-phosphor/40 px-2 py-0.5 text-[10px] transition-colors"
              aria-label="切换主题"
              title={theme === 'dark' ? '切换到亮色模式' : '切换到暗黑模式'}
            >
              {theme === 'dark' ? '◐ 亮' : '◑ 暗'}
            </button>
          </div>
          <span>所有计算均在本地完成 · v{version || '...'}</span>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-terminal/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ============ Main ============ */}
      <main className="flex-1 min-w-0">
        {/* mobile topbar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-1 border-b border-line bg-panel/95 backdrop-blur px-2 py-1.5 pt-safe">
          <button onClick={() => setSidebarOpen(true)} className="text-phosphor text-lg px-3 py-1" aria-label="打开菜单">☰</button>
          <button onClick={() => openTool(null)} className="text-phosphor text-[13px] font-semibold tracking-wider px-1 py-1 !min-h-0">
            &gt;_ BUGBUCKET.BOX
          </button>
          <span className="flex-1 text-right text-[11px] text-muted truncate px-2">
            {active ? `${CAT_ICONS[active.category]} ${active.name}` : ''}
          </span>
          <button
            onClick={toggleTheme}
            className="text-muted border border-line-soft px-2.5 py-1 text-[12px] hover:text-phosphor transition-colors"
            aria-label="切换主题"
          >{theme === 'dark' ? '◐' : '◑'}</button>
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-muted border border-line-soft px-2.5 py-1 text-[12px]"
            aria-label="搜索工具"
          >⌕</button>
        </div>

        {!active ? (
          <HomeView grouped={grouped} onOpen={openTool} query={query} />
        ) : (
          <ToolView tool={active} onBack={() => openTool(null)} />
        )}
      </main>
    </div>
  )
}

/* ================= Home ================= */

function HomeView({ grouped, onOpen, query }: {
  grouped: Map<string, ToolDef[]>
  onOpen: (id: string) => void
  query: string
}) {
  return (
    <div className="fade-in">
      {/* hero */}
      <div className="relative border-b border-line overflow-hidden">
        <MatrixRain opacity={0.16} />
        <div className="relative px-4 md:px-10 py-8 md:py-14 max-w-5xl">
          <pre className="hidden md:block text-phosphor/90 text-[9px] leading-[1.15] glow select-none whitespace-pre">{ASCII_LOGO}</pre>
          <h1 className="md:hidden text-3xl font-bold text-phosphor glow">&gt;_ BUGBUCKET.BOX</h1>
          <p className="mt-4 text-[13px] text-muted max-w-xl leading-relaxed">
            <span className="text-phosphor">$</span> 一个站点装下程序员与安全研究员的日常弹药库 —
            <span className="text-bright"> {TOOLS.length} 个工具</span>，从 JSON 格式化到反弹 Shell 生成。
            全部本地运算，数据不出浏览器。<span className="cursor-blink text-phosphor">▌</span>
          </p>
          <div className="mt-5 flex gap-2 flex-wrap text-[11px]">
            {['JSON', 'JWT', '反弹Shell', 'Payload', '哈希', '子网'].map(k => (
              <span key={k} className="px-2 py-0.5 border border-line-soft text-muted">{k}</span>
            ))}
          </div>
        </div>
      </div>

      {/* tool grid */}
      <div className="px-4 md:px-10 py-6 md:py-8 pb-12 pb-safe max-w-6xl space-y-8">
        {[...grouped.entries()].map(([cat, items]) => (
          <section key={cat}>
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="text-[13px] text-phosphor tracking-wider">
                <span className="text-muted">##</span> {CAT_ICONS[cat]} {cat}
              </h2>
              <span className="text-[10px] text-muted/60">{items.length} tools</span>
              <div className="flex-1 border-t border-line-soft" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {items.map(t => (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="tool-grid-card text-left border border-line-soft bg-panel px-4 py-3 hover:border-phosphor/50 hover:bg-phosphor-faint"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-cardtext">{t.name}</span>
                    {t.hot && <span className="text-[9px] text-amber border border-amber/30 px-1">HOT</span>}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted leading-relaxed">{t.desc}</div>
                  <div className="mt-2 text-[10px] text-phosphor/40">./run --tool={t.id} →</div>
                </button>
              ))}
            </div>
          </section>
        ))}
        {grouped.size === 0 && (
          <div className="text-center py-16 text-muted">
            <div className="text-4xl text-phosphor/30 mb-3">[ 404 ]</div>
            没有找到匹配「{query}」的工具
          </div>
        )}

        <footer className="border border-danger/30 bg-danger/5 px-4 py-3 text-[11.5px] text-muted leading-relaxed">
          <span className="text-danger font-semibold">[!] 法律与道德声明：</span>
          本站渗透测试类工具（反弹 Shell、Payload 速查等）仅供安全研究、CTF 竞赛、授权渗透测试与防御学习使用。
          未经授权对他人系统发起测试属违法行为。所有运算均在本地浏览器完成，本站不收集任何输入数据。
        </footer>
      </div>
    </div>
  )
}

/* ================= Tool view ================= */

function ToolView({ tool, onBack }: { tool: ToolDef; onBack: () => void }) {
  const C = tool.component
  return (
    <div className="fade-in px-4 md:px-10 py-4 md:py-6 pb-12 pb-safe max-w-6xl">
      <div className="flex items-center gap-2 md:gap-3 text-[12px] text-muted mb-1">
        <button onClick={onBack} className="text-phosphor/70 hover:text-phosphor px-1.5 py-0.5 border border-line-soft lg:border-0 !min-h-0">← ~/</button>
        <span className="shrink-0">{tool.category}</span>
        <span className="text-muted/50">/</span>
        <span className="text-bright truncate">{tool.name}</span>
      </div>
      <div className="border border-line bg-panel mt-3">
        <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[16px] text-phosphor glow font-semibold">
              $ ./{tool.id} <span className="cursor-blink">▌</span>
            </h1>
            <p className="text-[11.5px] text-muted mt-0.5">{tool.desc}</p>
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
