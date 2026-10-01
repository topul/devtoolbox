/**
 * 浏览器版对话会话存储 —— ChatStoreAPI 契约的 IndexedDB 实现。
 *
 * 桌面版用 userData/chat-sessions.json（全量写），浏览器版对应物是 IndexedDB：
 * localStorage 的 5MB 上限装不下含 20k 工具结果的 turns，注释里早有结论。
 * 数据形状与桌面版同构（同一套 ChatSessionMeta / turns 黑盒），所以 UI 层零改动。
 */
import type {
  ChatStoreListResult,
  ChatStoreLoadResult,
  ChatStoreWriteResult,
} from '../chatstore-types'
import { CHAT_STORE_MAX_BYTES } from '../chatstore-types'

const DB_NAME = 'devtoolbox'
const STORE = 'chat-sessions'
const KV = 'app'
const ACTIVE_KEY = 'chat-active-id'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('INDEXEDDB_OPEN_FAILED'))
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('INDEXEDDB_FAILED'))
        t.oncomplete = () => db.close()
      }),
  )
}

interface StoredSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turnCount: number
  turns: unknown[]
}

export function buildWebChatStore(): ElectronChatStore {
  return {
    list: async (): Promise<ChatStoreListResult> => {
      try {
        const all = await tx<StoredSession[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<StoredSession[]>)
        const sessions = all
          .map(({ turns: _turns, ...meta }) => meta)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        let activeId: string | null = null
        try {
          activeId = (await tx<string | undefined>(KV, 'readonly', (s) => s.get(ACTIVE_KEY) as IDBRequest<string | undefined>)) ?? null
        } catch {
          /* activeId 拿不到就当没有 */
        }
        return { ok: true, sessions, activeId }
      } catch (e) {
        return { ok: false, sessions: [], activeId: null, error: (e as Error).message }
      }
    },

    load: async (id: string): Promise<ChatStoreLoadResult> => {
      try {
        const hit = await tx<StoredSession | undefined>(STORE, 'readonly', (s) => s.get(id) as IDBRequest<StoredSession | undefined>)
        return hit ? { ok: true, turns: hit.turns } : { ok: false, turns: [], error: 'NOT_FOUND' }
      } catch (e) {
        return { ok: false, turns: [], error: (e as Error).message }
      }
    },

    save: async (input: { id: string; title: string; turns: unknown[] }): Promise<ChatStoreWriteResult> => {
      try {
        const prev = await tx<StoredSession | undefined>(STORE, 'readonly', (s) => s.get(input.id) as IDBRequest<StoredSession | undefined>)
        const record: StoredSession = {
          id: input.id,
          title: input.title,
          createdAt: prev?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          turnCount: input.turns.length,
          turns: input.turns,
        }
        // 与桌面版同一个闸：超限拒写，界面提示开新会话
        const bytes = new TextEncoder().encode(JSON.stringify(record)).length
        if (bytes > CHAT_STORE_MAX_BYTES) return { ok: false, tooLarge: true }
        await tx(STORE, 'readwrite', (s) => s.put(record))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },

    remove: async (id: string): Promise<ChatStoreWriteResult> => {
      try {
        await tx(STORE, 'readwrite', (s) => s.delete(id))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },

    setActive: async (id: string | null): Promise<ChatStoreWriteResult> => {
      try {
        if (id === null) await tx(KV, 'readwrite', (s) => s.delete(ACTIVE_KEY))
        else await tx(KV, 'readwrite', (s) => s.put(id, ACTIVE_KEY))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },

    file: async (): Promise<string> => {
      return '浏览器版：IndexedDB（devtoolbox / chat-sessions）'
    },
  }
}

interface ElectronChatStore {
  list: () => Promise<ChatStoreListResult>
  load: (id: string) => Promise<ChatStoreLoadResult>
  save: (input: { id: string; title: string; turns: unknown[] }) => Promise<ChatStoreWriteResult>
  remove: (id: string) => Promise<ChatStoreWriteResult>
  setActive: (id: string | null) => Promise<ChatStoreWriteResult>
  file: () => Promise<string>
}
