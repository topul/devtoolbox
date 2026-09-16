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
import { TOOLS } from '../src/lib/registry'
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
    if (!html.includes(locale === 'zh' ? '全部工具' : 'All Tools')) {
      failures++
      console.log(`[${locale}] App home view missing sidebar label`)
    }
  } catch (err) {
    failures++
    console.log(`[${locale}] App THREW: ${(err as Error).message}`)
  }
}

console.log(failures === 0 ? `\nOK: ${TOOLS.length * locales.length} tool renders + 2 app renders passed` : `\n${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
