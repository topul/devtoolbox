/**
 * 调用链路存档（渲染层 IndexedDB）。
 *
 * 主进程的链路记录是内存态（重启即失）；这里把拉到的链路存一份 IndexedDB，
 * 让历史会话的「查看调用链路」在重启后依然可用。
 *
 * 为什么不用 localStorage：单条链路可达数百 KB（48k 请求体 × 多轮），
 * localStorage 5MB 总限额很容易撑爆，且同步写入阻塞界面。IndexedDB 异步、容量弹性。
 *
 * 分层：淘汰/校验是纯函数（node 可直接测）；IndexedDB 读写是薄封装（SSR/隐私模式下静默降级）。
 */
import type { ChatTrace } from './chat-types'

/** 存档条数上限：超出淘汰最旧 */
export const TRACE_MAX_ENTRIES = 50
/** 单条存档大小上限：超过就不存（异常巨大的链路不值得占盘） */
export const TRACE_MAX_ENTRY_BYTES = 512 * 1024

export interface TraceArchiveEntry {
  id: string
  savedAt: number
  trace: ChatTrace
}

const DB_NAME = 'devtoolbox-chat'
const STORE = 'traces'
const DB_VERSION = 1

/** UTF-8 字节数（中文一条顶三，按字符数估会漏） */
export function entryBytes(e: TraceArchiveEntry): number {
  return new TextEncoder().encode(JSON.stringify(e)).length
}

/** 按条数上限挑出该淘汰的 id：最旧的先走 */
export function pickEvictions(entries: { id: string; savedAt: number }[], cap: number): string[] {
  if (entries.length <= cap) return []
  return [...entries]
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(0, entries.length - cap)
    .map((e) => e.id)
}

/** 读回来的脏数据矫正：结构不完整的条目直接丢弃 */
export function coerceEntry(raw: unknown): TraceArchiveEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const trace = o.trace as Record<string, unknown> | undefined
  if (typeof o.id !== 'string' || !o.id) return null
  if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null
  if (!trace || typeof trace !== 'object') return null
  if (!Array.isArray(trace.rounds) || typeof trace.requestId !== 'string') return null
  return { id: o.id, savedAt: o.savedAt, trace: trace as unknown as ChatTrace }
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

/** 存一条链路。满了先淘汰最旧；单条超限直接放弃（返回 false，不影响调用方流程）。 */
export async function saveTraceArchive(trace: ChatTrace): Promise<boolean> {
  if (!idbAvailable()) return false
  const entry: TraceArchiveEntry = { id: trace.requestId, savedAt: Date.now(), trace }
  if (entryBytes(entry) > TRACE_MAX_ENTRY_BYTES) return false
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return false
  }
  try {
    // 淘汰最旧，再写入；两个事务分开，任何一个失败都只当「没存上」
    const all = await new Promise<TraceArchiveEntry[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as unknown[]).map(coerceEntry).filter((x): x is TraceArchiveEntry => !!x))
      req.onerror = () => reject(req.error)
    })
    const evict = pickEvictions(all, TRACE_MAX_ENTRIES - 1)
    if (evict.length) {
      const os = db.transaction(STORE, 'readwrite').objectStore(STORE)
      for (const id of evict) os.delete(id)
    }
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/** 读一条存档；没有或数据坏了返回 null */
export async function loadTraceArchive(id: string): Promise<ChatTrace | null> {
  if (!idbAvailable() || !id) return null
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return null
  }
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return coerceEntry(raw)?.trace ?? null
  } catch {
    return null
  } finally {
    db.close()
  }
}
