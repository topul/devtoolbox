/**
 * 「发送到 →」交接菜单 + 接收 hook —— HTTP 工具间的内存传送带入口。
 *
 * 菜单只做两件事：把载荷 push 进 handoffBus、然后改 location.hash 跳到目标工具；
 * 目标工具挂载时用 useDrainHandoff 取走并填入自己的输入区。
 * 菜单用 fixed 定位：抓包详情在 overflow-auto 容器里，absolute 下拉会被裁掉。
 */
import { useEffect, useRef, useState } from 'react'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import {
  handoffBus,
  type HandoffEnvelope,
  type HandoffPayload,
  type HandoffTarget,
} from '../lib/handoff'

interface TargetDef {
  id: HandoffTarget
  /** hash 跳转用的工具 id（reqdiff 的 A/B 槽都落在 reqdiff 页） */
  tool: string
  /** 没有响应头时禁用（CORS/CSP 只能基于响应分析） */
  needsResponse?: boolean
}

const GROUPS: { zh: string; en: string; items: TargetDef[] }[] = [
  {
    zh: '请求 / 重放',
    en: 'Request / replay',
    items: [
      { id: 'http-client', tool: 'http-client' },
      { id: 'httpreq', tool: 'httpreq' },
      { id: 'reqdiff-a', tool: 'reqdiff' },
      { id: 'reqdiff-b', tool: 'reqdiff' },
      { id: 'smuggling', tool: 'smuggling' },
    ],
  },
  {
    zh: '响应分析',
    en: 'Response analysis',
    items: [
      { id: 'corsaudit', tool: 'corsaudit', needsResponse: true },
      { id: 'cspaudit', tool: 'cspaudit', needsResponse: true },
      { id: 'header-audit', tool: 'header-audit' },
    ],
  },
]

const LABELS: Record<HandoffTarget, { zh: string; en: string }> = {
  'http-client': { zh: 'HTTP 客户端（重放）', en: 'HTTP client (replay)' },
  httpreq: { zh: '原始请求结构分析', en: 'Raw request analyzer' },
  'reqdiff-a': { zh: '请求对比 · 槽 A', en: 'Request diff · slot A' },
  'reqdiff-b': { zh: '请求对比 · 槽 B', en: 'Request diff · slot B' },
  smuggling: { zh: '请求走私实验台', en: 'Smuggling lab' },
  corsaudit: { zh: 'CORS 配置分析', en: 'CORS audit' },
  cspaudit: { zh: 'CSP 策略分析', en: 'CSP audit' },
  'header-audit': { zh: '安全响应头审计', en: 'Security header audit' },
}

const L = {
  zh: {
    send: '发送到',
    needResponse: '（需要响应数据）',
    loaded: '已从交接载入',
    clear: '清除',
  },
  en: {
    send: 'Send to',
    needResponse: ' (needs a response)',
    loaded: 'Loaded via handoff',
    clear: 'Clear',
  },
}

/** 接收方：工具挂载时取走属于自己的一条交接载荷 */
export function useDrainHandoff(
  target: HandoffTarget,
  onArrive: (env: HandoffEnvelope) => void,
): void {
  const cb = useRef(onArrive)
  cb.current = onArrive
  useEffect(() => {
    const env = handoffBus.take(target)
    if (env) cb.current(env)
  }, [target])
}

/** 「来自抓包 #12 …」的载入提示条，可清除 */
export function HandoffBadge({
  label,
  onClear,
}: {
  label: string
  onClear: () => void
}): React.ReactElement {
  const l = useLocalized(L)
  return (
    <div className="flex items-center gap-2 rounded-md border border-phosphor/30 bg-phosphor/5 px-2.5 py-1.5 text-[11.5px]">
      <span className="text-phosphor">↦ {l.loaded}</span>
      <code className="text-muted break-all">{label}</code>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto shrink-0 text-muted hover:text-danger"
        aria-label={l.clear}
      >
        ✕
      </button>
    </div>
  )
}

export function SendToMenu({
  payload,
  className,
  disabled,
}: {
  payload: HandoffPayload
  className?: string
  disabled?: boolean
}): React.ReactElement {
  const l = useLocalized(L)
  const lang = useLocalized({ zh: 'zh' as const, en: 'en' as const })
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const hasResponse = !!payload.resHeaders?.length

  const openMenu = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) {
      setOpen(true)
      return
    }
    const MENU_W = 240
    const MENU_H = 380
    const x = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8))
    // 下方空间不够就向上展开（响应面板的按钮常贴着视口右下）
    const up = window.innerHeight - r.bottom < MENU_H && r.top > MENU_H
    const y = up ? r.top - 4 : r.bottom + 4
    setPos({ x, y, up })
    setOpen(true)
  }

  const choose = (def: TargetDef): void => {
    handoffBus.push(def.id, payload)
    setOpen(false)
    if (typeof window !== 'undefined' && window.location.hash !== `#${def.tool}`) {
      window.location.hash = def.tool
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          'px-2 py-1 text-[11.5px] rounded-md border border-line text-muted hover:text-bright hover:border-line transition-colors disabled:opacity-40',
          className,
        )}
      >
        {l.send} ▾
      </button>
      {open && pos && (
        <>
          {/* 透明背板负责点外部关闭 */}
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[91] w-60 rounded-md border border-line bg-panel p-1 shadow-xl"
            style={{
              left: pos.x,
              ...(pos.up ? { bottom: window.innerHeight - pos.y } : { top: pos.y }),
            }}
          >
            {GROUPS.map((g, gi) => (
              <div key={gi}>
                <div className="px-1.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted">
                  {g[lang]}
                </div>
                {g.items.map((def) => {
                  const off = !!def.needsResponse && !hasResponse
                  return (
                    <button
                      key={def.id}
                      type="button"
                      disabled={off}
                      title={off ? l.send + l.needResponse : undefined}
                      onClick={() => choose(def)}
                      className="block w-full rounded px-1.5 py-1 text-left text-[12px] text-bright hover:bg-panel-2 disabled:opacity-35 disabled:hover:bg-transparent"
                    >
                      {LABELS[def.id][lang]}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
