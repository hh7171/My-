import { isGarmentDir } from './garment-name.ts'

export const LIBRARY_BLOBS = {
  account: ['avatar'],
  body: ['source', 'normalized', 'image'],
  garment: ['cutout', 'sticker', 'original'],
  look: ['image'],
} as const

export const LIBRARY_REQUIRED = {
  account: ['avatar'],
  body: ['source', 'normalized', 'image'],
  garment: ['cutout'],
  look: ['image'],
} as const

export type LibraryKind = keyof typeof LIBRARY_BLOBS

export type BlobInfo = {
  type: string
  file: string
  bytes: number
  mark: string
}

export type StoredRecord = {
  savedAt: number
  record: Record<string, unknown>
  blobs: Record<string, BlobInfo>
}

export type LibraryIndex = {
  version: 1
  account: StoredRecord | null
  body: StoredRecord | null
  garments: Record<string, StoredRecord>
  looks: Record<string, StoredRecord>
  tombstones: {
    body: number
    garments: Record<string, number>
    looks: Record<string, number>
  }
}

export type LibraryWriteResult = { ok: true; savedAt: number } | { ok: false; deleted: true; savedAt: number }

export function isLibraryId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) || isGarmentDir(id)
}

export function storageId(kind: LibraryKind, recordId?: string): string {
  if (kind === 'account') return 'account'
  if (kind === 'body') return 'body'
  if (!recordId || !isLibraryId(recordId)) throw new Error('编号不对')
  return recordId
}

export function imageType(bytes: Uint8Array, declared: string): string {
  const clean = declared.split(';')[0].trim().toLowerCase()
  if (clean === 'image/jpg' || clean === 'image/jpeg') return 'image/jpeg'
  if (clean === 'image/png' || clean === 'image/webp' || clean === 'image/gif') return clean
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  return 'application/octet-stream'
}

export function markOf(bytes: Uint8Array, type: string): string {
  const head = hexBytes(bytes.subarray(0, Math.min(16, bytes.length)))
  const tail = hexBytes(bytes.subarray(Math.max(0, bytes.length - 16)))
  return `${bytes.length}:${type}:${head}:${tail}`
}

function hexBytes(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 1) out += bytes[index].toString(16).padStart(2, '0')
  return out
}
