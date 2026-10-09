import { defineConfig } from 'vitest/config'

/**
 * 单元测试只覆盖 src/lib/toolkit —— 与 MCP 服务端、渲染层三方共用的
 * 框架无关纯函数库。进程级验证（IPC / MCP stdio / 全工具 SSR）继续走
 * scripts/ 下的 smoke（npm run smoke），两层互补。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
