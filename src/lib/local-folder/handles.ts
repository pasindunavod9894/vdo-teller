import type { DirLike } from './folder'

/** Remembers each series' folder handle in the browser (IndexedDB), so the folder survives page loads. Every call is safe to fail. */
const DB = 'vdo-teller-folders'
const STORE = 'handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => { db.close(); resolve(req.result) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export const saveHandle = (seriesId: number | string, dir: DirLike) => tx('readwrite', (s) => s.put(dir, String(seriesId))).then(() => true).catch(() => false)
export const loadHandle = (seriesId: number | string) => tx<DirLike | undefined>('readonly', (s) => s.get(String(seriesId))).catch(() => undefined)
export const forgetHandle = (seriesId: number | string) => tx('readwrite', (s) => s.delete(String(seriesId))).then(() => true).catch(() => false)
