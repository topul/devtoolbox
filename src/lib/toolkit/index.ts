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
export * from './codecs'
export * from './dns'
export * from './env'
export * from './formats'
export * from './graphql'
export * from './har'
export * from './hash'
export * from './headers-audit'
export * from './ids'
export * from './json'
export * from './regex-replace'
export * from './jwt'
export * from './jwtcrack'
export * from './net'
export * from './schema'
export * from './sql-lint'
export * from './text'
export * from './time'
export * from './timezone'
export * from './tokens'
export * from './x509'
export * from './yaml'
/* 新增：JWT 签发、TOTP（零依赖纯实现，渲染进程与 MCP 共用同一份） */
export * from './jwt-sign'
export * from './totp'
/* 新增：MCP 侧补充绑定的纯函数模块 */
export * from './glob'
export * from './jsondiff'
export * from './units'
export * from './floatbits'
export * from './sri'
export * from './docker2compose'
export * from './bcrypt'
