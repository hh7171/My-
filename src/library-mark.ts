import { isGarmentDir } from './garment-name.ts'

export const LIBRARY_BLOBS = {
  account: ['avatar'],
  body: ['source', 'normalized', 'image'],
  garment: ['cutout', 'sticker', 'original'],
  look: ['image', 'real', 'video', 'realVideo'],
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
  if (clean === 'video/mp4' || clean === 'video/quicktime') return 'video/mp4'
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
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'video/mp4'
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

export type PngStickerFrame = { x: number; y: number; width: number; height: number }

export type StickerNote = {
  frame: PngStickerFrame
  place: { dx: number; dy: number; scale: number }
  for?: number
  ver?: number
}

export function stickerNoteFromRecord(record: Record<string, unknown>): StickerNote | null {
  const frame = readNoteFrame(record.stickerFrame)
  if (!frame) return null
  const place = readNotePlace(record.stickerPlace) ?? { dx: 0, dy: 0, scale: 1 }
  const note: StickerNote = { frame, place }
  if (typeof record.stickerFor === 'number' && Number.isFinite(record.stickerFor)) note.for = record.stickerFor
  if (typeof record.stickerVer === 'number' && Number.isFinite(record.stickerVer)) note.ver = record.stickerVer
  return note
}

export function parseStickerNote(text: string): StickerNote | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return stickerNoteFromRecord(parsed as Record<string, unknown>)
}

export function formatStickerNote(note: StickerNote): string {
  const body: Record<string, unknown> = {
    stickerFrame: note.frame,
    stickerPlace: note.place,
  }
  if (note.for != null) body.stickerFor = note.for
  if (note.ver != null) body.stickerVer = note.ver
  return `${JSON.stringify(body, null, 2)}\n`
}

export function applyStickerNote(record: Record<string, unknown>, note: StickerNote): boolean {
  const current = stickerNoteFromRecord(record)
  if (current && formatStickerNote(current) === formatStickerNote(note)) return false
  record.stickerFrame = note.frame
  record.stickerPlace = note.place
  if (note.for != null) record.stickerFor = note.for
  if (note.ver != null) record.stickerVer = note.ver
  return true
}

function readNoteFrame(value: unknown): PngStickerFrame | null {
  if (!value || typeof value !== 'object') return null
  const frame = value as Partial<PngStickerFrame>
  if (typeof frame.x !== 'number' || typeof frame.y !== 'number' || typeof frame.width !== 'number' || typeof frame.height !== 'number') return null
  if (![frame.x, frame.y, frame.width, frame.height].every((item) => Number.isFinite(item)) || frame.width <= 8 || frame.height <= 8) return null
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
}

function readNotePlace(value: unknown): StickerNote['place'] | null {
  if (!value || typeof value !== 'object') return null
  const place = value as Partial<StickerNote['place']>
  if (typeof place.dx !== 'number' || typeof place.dy !== 'number' || typeof place.scale !== 'number') return null
  if (![place.dx, place.dy, place.scale].every((item) => Number.isFinite(item)) || place.scale <= 0) return null
  return { dx: place.dx, dy: place.dy, scale: place.scale }
}

const STICKER_FRAME_KEY = 'sticker-frame'

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  return { width: uint32(bytes, 16), height: uint32(bytes, 20) }
}

export function frameFitsImage(frame: PngStickerFrame, width: number, height: number): boolean {
  return Math.abs(frame.width - width) <= 2 && Math.abs(frame.height - height) <= 2
}

export function readStickerFrame(bytes: Uint8Array): PngStickerFrame | null {
  if (!readPngSize(bytes)) return null
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const dataStart = offset + 8
    const next = dataStart + length + 4
    if (next > bytes.length) return null
    if (type === 'tEXt' && length < 200) {
      const data = bytes.subarray(dataStart, dataStart + length)
      const split = data.indexOf(0)
      const key = split >= 0 ? new TextDecoder().decode(data.subarray(0, split)) : ''
      if (key === STICKER_FRAME_KEY && split >= 0) {
        const text = new TextDecoder().decode(data.subarray(split + 1))
        const [x, y, width, height] = text.split(',').map(Number)
        if ([x, y, width, height].every((value) => Number.isFinite(value)) && width > 8 && height > 8) return { x, y, width, height }
      }
    }
    if (type === 'IEND') break
    offset = next
  }
  return null
}

export function writeStickerFrame(bytes: Uint8Array, frame: PngStickerFrame): Uint8Array {
  if (!readPngSize(bytes)) return bytes
  const text = `${Math.round(frame.x)},${Math.round(frame.y)},${Math.round(frame.width)},${Math.round(frame.height)}`
  const keyword = new TextEncoder().encode(STICKER_FRAME_KEY)
  const payload = new Uint8Array(keyword.length + 1 + text.length)
  payload.set(keyword, 0)
  payload[keyword.length] = 0
  for (let index = 0; index < text.length; index += 1) payload[keyword.length + 1 + index] = text.charCodeAt(index)
  const type = new TextEncoder().encode('tEXt')
  const chunk = new Uint8Array(12 + payload.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length)
  chunk.set(type, 4)
  chunk.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)))
  let end = bytes.length
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset)
    const kind = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (kind === 'IEND') {
      end = offset
      break
    }
    offset += 12 + length
  }
  const next = new Uint8Array(end + chunk.length + (bytes.length - end))
  next.set(bytes.subarray(0, end), 0)
  next.set(chunk, end)
  next.set(bytes.subarray(end), end + chunk.length)
  return next
}
