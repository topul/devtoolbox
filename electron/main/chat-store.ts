/**
 * 对话会话的本地持久化（单文件 + 内存缓存 + 全量落盘）。
 *
 * 设计取舍：
 *   - 单文件而不是每个会话一个文件：省掉索引同步问题，几十个会话也就几 MB，
 *     `JSON.parse` 一次几十毫秒；换来的是逻辑简单、不可能出现「索引说有一个、文件却没了」。
 *   - `turns` 当黑盒存取，本模块不理解消息内部结构 —— 界面渲染模型怎么改都不用动这里。
 *   - **损坏不当成空**：解析失败时把原文件旁置为 `.corrupt-<时间戳>.json` 再从头开始，
 *     并在返回值里带 `recovered`，让界面明确告诉用户「备份在哪」，而不是无声清空几年的记录。
 *
 * 不 import electron，`dir` 由调用方给 —— 冒烟脚本可以直接拿临时目录驱动它。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  CHAT_STORE_FILENAME,
  CHAT_STORE_MAX_BYTES,
  isSafeSessionId,
  type ChatSessionMeta,
  type ChatStoreListResult,
  type ChatStoreLoadResult,
  type ChatStoreWriteResult,
} from '../../src/lib/chatstore-types'

const VERSION = 1

interface StoredSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: unknown[]
}

interface StoreFile {
  version: number
  activeId: string | null
  sessions: StoredSession[]
}

export interface SessionWriteInput {
  id: string
  title: string
  turns: unknown[]
}

export interface ChatStore {
  list: () => ChatStoreListResult
  load: (id: string) => ChatStoreLoadResult
  save: (input: SessionWriteInput) => ChatStoreWriteResult
  remove: (id: string) => ChatStoreWriteResult
  setActive: (id: string | null) => ChatStoreWriteResult
  /** 数据文件路径（界面「在文件夹中显示」、冒烟断言用） */
  filePath: () => string
}

const empty = (): StoreFile => ({ version: VERSION, activeId: null, sessions: [] })

/** 形状校验：只信自己写出来的东西，外部改动一律按损坏处理 */
function coerce(raw: unknown): StoreFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.sessions)) return null

  const sessions: StoredSession[] = []
  for (const item of obj.sessions) {
    if (typeof item !== 'object' || item === null) continue
    const s = item as Record<string, unknown>
    if (!isSafeSessionId(s.id)) continue
    if (!Array.isArray(s.turns)) continue
    sessions.push({
      id: s.id,
      title: typeof s.title === 'string' ? s.title : '',
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      turns: s.turns,
    })
  }

  const activeId = isSafeSessionId(obj.activeId) ? obj.activeId : null
  return { version: VERSION, activeId, sessions }
}

export function createChatStore(dir: string): ChatStore {
  const file = path.join(dir, CHAT_STORE_FILENAME)

  let cache: StoreFile | null = null
  let recovered = false

  function read(): StoreFile {
    if (cache) return cache
    let text: string | null = null
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      cache = empty()
      return cache
    }
    try {
      const parsed = coerce(JSON.parse(text))
      if (parsed) {
        cache = parsed
        return cache
      }
      throw new Error('shape invalid')
    } catch {
      // 解析不了就把原件挪到一边，绝不覆盖 —— 用户可能还想手工抢救
      const backup = `${file}.corrupt-${Date.now()}.json`
      try {
        fs.renameSync(file, backup)
        recovered = true
      } catch {
        /* 连改名都失败，那就继续用空数据，至少别再弄坏东西 */
      }
      cache = empty()
      return cache
    }
  }

  function write(next: StoreFile): ChatStoreWriteResult {
    const body = JSON.stringify({ ...next, version: VERSION })
    if (Buffer.byteLength(body, 'utf8') > CHAT_STORE_MAX_BYTES) {
      return { ok: false, tooLarge: true, error: 'SIZE_LIMIT' }
    }
    try {
      fs.mkdirSync(dir, { recursive: true })
      // 先写临时文件再改名：中途崩溃也不会留下半个 JSON
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, body, 'utf8')
      fs.renameSync(tmp, file)
      cache = next
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  return {
    filePath: () => file,

    list: () => {
      const data = read()
      const sessions: ChatSessionMeta[] = data.sessions
        .map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          turnCount: s.turns.length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      return {
        ok: true,
        sessions,
        activeId: data.activeId,
        ...(recovered ? { recovered: true } : {}),
      }
    },

    load: (id) => {
      if (!isSafeSessionId(id)) return { ok: false, turns: [], error: 'BAD_ID' }
      const hit = read().sessions.find((s) => s.id === id)
      if (!hit) return { ok: false, turns: [], error: 'NOT_FOUND' }
      return { ok: true, turns: hit.turns }
    },

    save: (input) => {
      if (!isSafeSessionId(input.id)) return { ok: false, error: 'BAD_ID' }
      if (!Array.isArray(input.turns)) return { ok: false, error: 'BAD_TURNS' }
      const data = read()
      const now = Date.now()
      const title = input.title.trim()
      const idx = data.sessions.findIndex((s) => s.id === input.id)

      const next: StoreFile = { ...data, sessions: [...data.sessions] }
      if (idx >= 0) {
        next.sessions[idx] = {
          ...next.sessions[idx],
          title: title || next.sessions[idx].title,
          turns: input.turns,
          updatedAt: now,
        }
      } else {
        next.sessions.push({
          id: input.id,
          title,
          createdAt: now,
          updatedAt: now,
          turns: input.turns,
        })
      }
      // 首次写入的会话自然成为「当前会话」
      if (!next.activeId) next.activeId = input.id
      return write(next)
    },

    remove: (id) => {
      if (!isSafeSessionId(id)) return { ok: false, error: 'BAD_ID' }
      const data = read()
      const next: StoreFile = {
        ...data,
        sessions: data.sessions.filter((s) => s.id !== id),
        activeId: data.activeId === id ? null : data.activeId,
      }
      return write(next)
    },

    setActive: (id) => {
      if (id !== null && !isSafeSessionId(id)) return { ok: false, error: 'BAD_ID' }
      const data = read()
      return write({ ...data, activeId: id })
    },
  }
}
