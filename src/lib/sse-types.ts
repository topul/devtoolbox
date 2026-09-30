/**
 * SSE 调试的类型契约 —— 主进程与渲染进程共用（同 http-types 模式）。
 * 事件流走单向推送（webContents.send），指令走 invoke。
 */

export interface SseSendSpec {
  /** 连接标识：渲染层生成，abort 与事件回推都靠它对齐 */
  id: string
  url: string
  method?: 'GET' | 'POST'
  headers?: [string, string][]
}

export interface SseFramePayload {
  event: string
  data: string
  id?: string
  retry?: number
}

export type SseEventFrame =
  | { id: string; kind: 'open'; status: number }
  | { id: string; kind: 'frame'; frame: SseFramePayload }
  | { id: string; kind: 'error'; error: string }
  | { id: string; kind: 'close'; reason: 'ended' | 'aborted' | 'error' }

export interface SseAPI {
  /** 发起 SSE 连接；结果不从这里返回，全部经 onEvent 推送 */
  send: (spec: SseSendSpec) => Promise<void>
  abort: (id: string) => Promise<void>
  /** 订阅事件；返回退订函数（组件卸载时务必调用） */
  onEvent: (cb: (evt: SseEventFrame) => void) => () => void
}
