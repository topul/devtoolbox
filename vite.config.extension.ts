import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 浏览器 / 插件版构建（MV3）。
 *
 * 与桌面版共用同一份渲染层源码（src/、index.html），差别只有三点：
 *   1. `__DTB_WEB__=true`：registry 隐藏 desktopOnly 工具（抓包/stdio MCP）；
 *   2. 没有 CSP meta 注入 —— MV3 的页面 CSP 由平台给出（script-src 'self'），
 *      fetch 目标不受 connect-src 约束，由 host_permissions 授权；
 *   3. 产物落到 dist-extension/app/，manifest 与 SW 由 scripts/build-extension.mjs 拷进去。
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __DTB_WEB__: JSON.stringify(true),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist-extension/app',
    emptyOutDir: true,
    target: 'chrome112',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
})
