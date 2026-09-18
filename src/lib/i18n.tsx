import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { TOOLS_L, CATEGORY_L, SECTION_L, SECTION_DESC_L, type ToolId } from './locales/registry'
import { UI, COMMON, type UIStrings, type Locale } from './locales/ui'
import type { CategoryId, SectionId } from './registry'

export type { Locale } from './locales/ui'

const STORAGE_KEY = 'devtoolbox-locale'

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh' || stored === 'en') return stored
  return 'zh' // Chinese is the default locale
}

/* ================= Context ================= */

interface I18nCtx {
  locale: Locale
  setLocale: (l: Locale) => void
  t: UIStrings
  /** Display name of a tool, resolved from the locale catalog by tool id */
  toolName: (tool: { id: ToolId }) => string
  /** Display description of a tool */
  toolDesc: (tool: { id: ToolId }) => string
  /** Display name of a category, resolved from the language-neutral category id */
  catName: (cat: CategoryId) => string
  /** 导航分组名（侧栏/首页顶层） */
  sectionName: (id: SectionId) => string
  /** 分组的一句话说明 */
  sectionDesc: (id: SectionId) => string
}

const Ctx = createContext<I18nCtx | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLocaleState(l)
  }, [])

  const toolName = useCallback((tool: { id: ToolId }) =>
    TOOLS_L[locale][tool.id]?.name ?? tool.id, [locale])

  const toolDesc = useCallback((tool: { id: ToolId }) =>
    TOOLS_L[locale][tool.id]?.desc ?? '', [locale])

  const catName = useCallback((cat: CategoryId) =>
    CATEGORY_L[locale][cat] ?? cat, [locale])

  const sectionName = useCallback((id: SectionId) => SECTION_L[locale][id], [locale])
  const sectionDesc = useCallback((id: SectionId) => SECTION_DESC_L[locale][id], [locale])

  const value: I18nCtx = { locale, setLocale, t: UI[locale], toolName, toolDesc, catName, sectionName, sectionDesc }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

/**
 * Picks the current locale's branch of a `{ zh, en }` dictionary. Used by every
 * tool component for its internal strings; both branches must expose the same
 * keys or TypeScript will complain at the call site.
 *
 *   const L = { zh: { title: '<zh text>' }, en: { title: '<en text>' } }
 *   const l = useLocalized(L)   // l.title
 */
export function useLocalized<T>(set: { zh: T; en: T }): T {
  const { locale } = useI18n()
  return set[locale]
}

/** Re-exported so shared components can pull copy labels from one place. */
export { COMMON } from './locales/ui'
