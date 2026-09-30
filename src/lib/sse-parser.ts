/**
 * SSE 帧解析 —— W3C server-sent events 的行协议。
 *
 * 设计约束：
 * - 有状态解码器：网络 chunk 会把一条事件从中间劈开（跨 TCP 包），必须逐字节累积；
 * - 兼容 \r\n / \n / \r 三种行尾（真实服务端什么都有）；
 * - `:` 开头是注释；`data` 多行合并 \n；`event` 缺省 message；`id` 持久到下一条事件；`retry` 只取整数。
 */

export interface SseFrame {
  /** 缺省 'message' */
  event: string
  /** 多行 data 合并；可能是空串（合法：仅 event/id 的帧） */
  data: string
  /** 本帧携带的 id（若有） */
  id?: string
  /** 本帧携带的 retry 毫秒数（若有且为合法整数） */
  retry?: number
}

export class SseDecoder {
  private lines: string[] = []
  private data: string[] = []
  private event = ''
  private id: string | undefined
  private retry: number | undefined
  /** 去掉行尾 \r 后的残留（chunk 以 \r 结尾时下一包才知是否 \r\n） */
  private carry = ''

  push(chunk: string): SseFrame[] {
    const out: SseFrame[] = []
    const text = this.carry + chunk
    // 统一拆行：保留最后一段（可能是被劈开的半行）
    const segments = text.split(/\r\n|\n|\r/)
    this.carry = segments.pop() ?? ''
    for (const line of segments) {
      if (line === '') {
        const f = this.flush()
        if (f) out.push(f)
        continue
      }
      if (line.startsWith(':')) continue // 注释
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') this.data.push(value)
      else if (field === 'event') this.event = value
      else if (field === 'id') this.id = value
      else if (field === 'retry') {
        const n = parseInt(value, 10)
        if (!Number.isNaN(n)) this.retry = n
      }
      // 未知字段按规范忽略
    }
    return out
  }

  /** 流结束：把残余半行和未分发的帧吐出来 */
  end(): SseFrame[] {
    const out: SseFrame[] = []
    if (this.carry !== '') {
      this.feedLine(this.carry)
      this.carry = ''
    }
    const f = this.flush()
    if (f) out.push(f)
    return out
  }

  private feedLine(line: string): void {
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
    else if (field === 'id') this.id = value
    else if (field === 'retry') {
      const n = parseInt(value, 10)
      if (!Number.isNaN(n)) this.retry = n
    }
  }

  private flush(): SseFrame | null {
    if (this.data.length === 0 && !this.event && this.id === undefined && this.retry === undefined) return null
    const f: SseFrame = {
      event: this.event || 'message',
      data: this.data.join('\n'),
      id: this.id,
      retry: this.retry,
    }
    this.data = []
    this.event = ''
    this.retry = undefined
    // id 持久：规范要求后续事件沿用最后收到的 id
    return f
  }
}
