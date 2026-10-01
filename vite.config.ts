import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // dev:web 以浏览器形态运行（与插件版一致：隐藏 desktopOnly 工具）
  define: {
    __DTB_WEB__: JSON.stringify(true),
  },
})
