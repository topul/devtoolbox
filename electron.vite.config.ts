import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 生产环境的 CSP。
 *
 * 不加的话，Electron 会在控制台警告「no Content-Security-Policy set」——
 * 对一个自称安全工具的应用来说，这个警告不该存在。
 *
 * 只在 build 阶段注入：dev server 的 HMR 需要 unsafe-eval 和内联脚本，
 * 一刀切会把开发体验弄坏，而且 dev 模式本来就不是交付形态。
 *
 * `style-src` 保留 'unsafe-inline'：React 的 style 属性与 Tailwind 会用到内联样式；
 * 关键在于 script-src 收紧到 'self' —— 真要紧的是别让脚本从别处加载执行。
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // 注意：frame-ancestors 只能通过 HTTP 头传递，写进 meta 会被忽略并产生控制台告警
].join('; ')

function injectCsp() {
  return {
    name: 'inject-prod-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string): string {
      if (html.includes('Content-Security-Policy')) return html
      return html.replace(
        /<head>/i,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
        // 必须产出 CJS：webPreferences.sandbox 为 true 时，Electron 把 preload 当经典脚本加载，
        // ESM 的 import 语句会直接 `SyntaxError: Cannot use import statement outside a module`，
        // 结果是 window.electronAPI 静默变成 undefined（typecheck/build 都发现不了）。
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    base: './',
    plugins: [react(), injectCsp()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    }
  }
})
