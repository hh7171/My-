import type { Account, BodyProfile, Garment, Look } from './types.ts'

const DB_NAME = 'electronic-wardrobe'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        if (!db.objectStoreNames.contains('garments')) {
          db.createObjectStore('garments', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('looks')) {
          db.createObjectStore('looks', { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        dbPromise = null
        reject(request.error)
      }
    })
  }
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function loadAccount(): Promise<Account | null> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readonly')
  const result = await requestToPromise(tx.objectStore('meta').get('account'))
  return (result as Account | undefined) ?? null
}

export async function saveAccount(account: Account): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put(account, 'account')
  await txDone(tx)
}

export async function loadBody(): Promise<BodyProfile | null> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readonly')
  const result = await requestToPromise(tx.objectStore('meta').get('profile'))
  return (result as BodyProfile | undefined) ?? null
}

export async function saveBody(profile: BodyProfile): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put(profile, 'profile')
  await txDone(tx)
}

export async function deleteBody(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').delete('profile')
  await txDone(tx)
}

export async function loadGarments(): Promise<Garment[]> {
  const db = await openDb()
  const tx = db.transaction('garments', 'readonly')
  const result = await requestToPromise(tx.objectStore('garments').getAll())
  return (result as Garment[]).sort((a, b) => b.createdAt - a.createdAt)
}

export async function putGarment(garment: Garment): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('garments', 'readwrite')
  tx.objectStore('garments').put(garment)
  await txDone(tx)
}

export async function removeGarment(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('garments', 'readwrite')
  tx.objectStore('garments').delete(id)
  await txDone(tx)
}

export async function loadLooks(): Promise<Look[]> {
  const db = await openDb()
  const tx = db.transaction('looks', 'readonly')
  const result = await requestToPromise(tx.objectStore('looks').getAll())
  return (result as Look[]).sort((a, b) => b.createdAt - a.createdAt)
}

export async function putLook(look: Look): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('looks', 'readwrite')
  tx.objectStore('looks').put(look)
  await txDone(tx)
}

export async function removeLook(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('looks', 'readwrite')
  tx.objectStore('looks').delete(id)
  await txDone(tx)
}

export type DiskStamp = {
  account: number
  body: number
  removedBody: number
  garments: Record<string, number>
  looks: Record<string, number>
  removedGarments: Record<string, number>
  removedLooks: Record<string, number>
}

export async function loadDiskStamp(): Promise<DiskStamp> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readonly')
  const result = await requestToPromise(tx.objectStore('meta').get('diskSync'))
  return normalizeStamp(result)
}

export async function saveDiskStamp(stamp: DiskStamp): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put(stamp, 'diskSync')
  await txDone(tx)
}

function normalizeStamp(value: unknown): DiskStamp {
  const raw = value && typeof value === 'object' ? (value as Partial<DiskStamp>) : {}
  return {
    account: finite(raw.account),
    body: finite(raw.body),
    removedBody: finite(raw.removedBody),
    garments: numberMap(raw.garments),
    looks: numberMap(raw.looks),
    removedGarments: numberMap(raw.removedGarments),
    removedLooks: numberMap(raw.removedLooks),
  }
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const map: Record<string, number> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) map[key] = item
  }
  return map
}
