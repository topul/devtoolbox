/**
 * WebSocket 调试的类型契约 —— 主进程与渲染进程共用（同 sse-types 模式）。
 */

export interface WsSendSpec {
  /** 连接标识：渲染层生成，send/close 与事件回推都靠它对齐 */
  id: string
  /** ws:// 或 wss:// */
  url: string
  headers?: [string, string][]
}

export type WsEventFrame =
  | { id: string; kind: 'open'; protocol?: string }
  | { id: string; kind: 'message'; dir: 'in' | 'out'; data: string }
  | { id: string; kind: 'error'; error: string }
  | { id: string; kind: 'close'; code: number; reason: string }

export interface WsAPI {
  connect: (spec: WsSendSpec) => Promise<void>
  /** 文本帧发送；二进制帧 v1 不支持。失败时 ok=false + 稳定错误码（NOT_CONNECTED / NOT_OPEN） */
  send: (id: string, data: string) => Promise<{ ok: boolean; error?: string }>
  close: (id: string, code?: number, reason?: string) => Promise<void>
  /** 订阅事件；返回退订函数（组件卸载时务必调用） */
  onEvent: (cb: (evt: WsEventFrame) => void) => () => void
}
