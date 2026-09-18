/**
 * 共享纯函数层入口。
 *
 * 这里放的是「不含任何界面、也不含任何 Node 专属能力」的纯逻辑，
 * 因此可以被三方同时引用：
 *   1. 渲染进程的 `src/tools/*.tsx`（界面）
 *   2. MCP 服务端 `src/mcp/*`（给 AI Agent 用）
 *   3. 校验脚本 `scripts/*`
 *
 * 新增工具时，逻辑放这里、界面放 `src/tools`，别把实现写回组件里。
 */
export * from './codec'
export * from './hash'
export * from './ids'
export * from './json'
export * from './jwt'
export * from './net'
export * from './schema'
export * from './text'
export * from './time'
export * from './tokens'
export * from './yaml'
