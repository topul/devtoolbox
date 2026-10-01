/**
 * 构建目标判定。
 *
 * `__DTB_WEB__` 由各构建配置通过 define 注入：
 *   - 桌面版（electron-vite renderer）→ false
 *   - 浏览器 / 插件版（vite.config.extension.ts 与 dev:web）→ true
 *
 * esbuild 冒烟脚本（smoke:render 等）没有 define，走 typeof 兜底为 false ——
 * 即冒烟始终按桌面形态渲染全部工具，行为与历史保持一致。
 */
declare const __DTB_WEB__: boolean | undefined

export const WEB_BUILD: boolean = typeof __DTB_WEB__ === 'undefined' ? false : __DTB_WEB__
