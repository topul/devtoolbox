/**
 * Smoke test: server-render every tool component in both locales.
 *
 * Catches runtime failures the type-checker cannot see — invalid hooks, missing
 * context providers, bad locale lookups, components that crash on mount.
 *
 *   npx esbuild scripts/smoke-render.tsx --bundle --platform=node --format=esm \
 *     --outfile=/tmp/smoke.mjs --loader:.tsx=tsx --jsx=automatic --log-level=error
 *   node /tmp/smoke.mjs
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../src/lib/i18n'
import { TOOLS, SECTIONS, verifyNavigation, toolsInSection } from '../src/lib/registry'
import App from '../src/App'

// --- minimal browser stubs -------------------------------------------------
let currentLocale = 'zh'
const store = new Map<string, string>()
;(globalThis as any).window = {
  electronAPI: undefined,
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  scrollTo() {},
  location: { hash: '' },
}
;(globalThis as any).localStorage = {
  getItem: (k: string) => (k === 'devtoolbox-locale' ? currentLocale : store.get(k) ?? null),
  setItem: (k: string, v: string) => store.set(k, v),
}
;(globalThis as any).document = {
  documentElement: { classList: { add() {}, remove() {} }, style: {}, lang: '' },
  createElement: () => ({ value: '', innerHTML: '', select() {}, setAttribute() {} }),
  body: { appendChild() {}, removeChild() {} },
  execCommand: () => true,
}
;(globalThis as any).location = { hash: '', pathname: '/' }

// --- run -------------------------------------------------------------------
const locales = ['zh', 'en'] as const
let failures = 0

// --- 导航结构自检 ----------------------------------------------------------
// SECTIONS 与 SECTION_OF 是两处手写，这里保证它们不跑偏，且分组不重不漏
{
  const navProblems = verifyNavigation()
  if (navProblems.length) {
    failures++
    console.log(`导航结构有问题：${navProblems.join(' | ')}`)
  }
  const covered = SECTIONS.reduce((n, s) => n + toolsInSection(s.id).length, 0)
  if (covered !== TOOLS.length) {
    failures++
    console.log(`分组只覆盖了 ${covered}/${TOOLS.length} 个工具`)
  }
}

for (const locale of locales) {
  currentLocale = locale
  for (const tool of TOOLS) {
    const C = tool.component
    try {
      const html = renderToStaticMarkup(
        <I18nProvider>
          <C />
        </I18nProvider>,
      )
      const problems: string[] = []
      if (!html.trim()) problems.push('empty markup')
      if (html.includes('>undefined<')) problems.push('rendered literal "undefined"')
      // Note only: a few tools legitimately render pure ASCII on first paint
      // (e.g. the JWT tool shows "Header / Payload" placeholders).
      if (locale === 'zh' && !/[\u4e00-\u9fff]/.test(html)) {
        console.log(`[zh] ${tool.id.padEnd(14)} note: first paint is ASCII-only (labels are technical terms)`)
      }
      if (locale === 'en' && /[\u4e00-\u9fff]/.test(html)) {
        const sample = html.match(/[\u4e00-\u9fff]+/g)!.slice(0, 6).join(' ')
        problems.push(`en render still contains Chinese: ${sample}`)
      }
      if (problems.length) {
        failures++
        console.log(`[${locale}] ${tool.id.padEnd(14)} ${problems.join(' | ')}`)
      }
    } catch (err) {
      failures++
      console.log(`[${locale}] ${tool.id.padEnd(14)} THREW: ${(err as Error).message}`)
    }
  }

  // whole-app render (home view)
  try {
    const html = renderToStaticMarkup(<App />)
    // 「AI 优先」的落点：打开应用默认是对话（未配置模型时是配置引导卡）
    const onboard = locale === 'zh' ? '先连一个模型' : 'Connect a model first'
    if (!html.includes(onboard)) {
      failures++
      console.log(`[${locale}] App default view is not the chat onboarding`)
    }
    // 侧栏两个顶层入口都在：对话 + 工具箱
    if (!html.includes(locale === 'zh' ? '工具箱' : 'Toolbox')) {
      failures++
      console.log(`[${locale}] App sidebar missing toolbox entry`)
    }
    // 工具网格里分组不重不漏，且 AI 分区排最前
    const aiLabel = locale === 'zh' ? 'AI 工作台' : 'AI Workspace'
    if (!html.includes(aiLabel)) {
      failures++
      console.log(`[${locale}] App home view missing AI section label`)
    }
    const aiIdx = html.indexOf(aiLabel)
    const codecLabel = locale === 'zh' ? '编解码与格式' : 'Encoding &amp; Format'
    const codecIdx = html.indexOf(codecLabel)
    if (aiIdx < 0 || codecIdx < 0 || aiIdx > codecIdx) {
      failures++
      console.log(`[${locale}] AI section is not the first one on the home view`)
    }
  } catch (err) {
    failures++
    console.log(`[${locale}] App THREW: ${(err as Error).message}`)
  }
}

console.log(failures === 0 ? `\nOK: ${TOOLS.length * locales.length} tool renders + 2 app renders passed` : `\n${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
