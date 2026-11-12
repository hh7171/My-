import { loadAccount, loadBody, loadDiskStamp, loadGarments, loadLooks, removeGarment, removeLook, saveAccount, saveBody, saveDiskStamp, deleteBody, putGarment, putLook, type DiskStamp } from './db.ts'
import { imageType, isLibraryId, LIBRARY_BLOBS, LIBRARY_REQUIRED, markOf, type LibraryIndex, type LibraryKind, type LibraryWriteResult, type StoredRecord } from './library-mark.ts'
import { uniqueTags } from './tags.ts'
import { acceptGarmentTitle } from './garment-name.ts'
import type { Account, Adjustments, BodyMarks, BodyProfile, BodyType, Category, Garment, Look, Season, StickerFrame, StickerPlace } from './types.ts'
import { CATEGORY_LABEL, CATEGORY_ORDER } from './types.ts'

export type OpenSnapshot = {
  account: Account | null
  body: BodyProfile | null
  garments: Garment[]
  looks: Look[]
  note: 'restored' | 'copied' | 'ready'
}

type Packed = { record: Record<string, unknown>; blobs: Record<string, Blob | undefined> }
type Flags = { pushed: boolean; pulled: boolean }

const MARK_KEYS: (keyof BodyMarks)[] = [
  'nose',
  'neck',
  'lShoulder',
  'rShoulder',
  'lElbow',
  'rElbow',
  'lWrist',
  'rWrist',
  'lHip',
  'rHip',
  'lKnee',
  'rKnee',
  'lAnkle',
  'rAnkle',
]

let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function openLibrary(onProgress?: (text: string) => void): Promise<OpenSnapshot> {
  return enqueue(() => openUnlocked(onProgress ?? (() => undefined)))
}

export function rememberAccount(account: Account): Promise<void> {
  return enqueue(async () => {
    await writeKind('account', 'account', splitEntity('account', account))
  })
}

export function rememberBody(profile: BodyProfile): Promise<void> {
  return enqueue(async () => {
    await writeKind('body', 'body', splitEntity('body', profile))
  })
}

export function rememberGarment(garment: Garment): Promise<'saved' | 'deleted'> {
  return enqueue(async () => {
    const removed = await writeKind('garment', garment.id, splitEntity('garment', garment))
    return removed ? 'deleted' : 'saved'
  })
}

export function rememberLook(look: Look): Promise<void> {
  return enqueue(() => writeKind('look', look.id, splitEntity('look', look)).then(() => undefined))
}

export function forgetBody(): Promise<void> {
  return enqueue(() => forgetKind('body', 'body'))
}

export function forgetGarment(id: string): Promise<void> {
  return enqueue(() => forgetKind('garment', id))
}

export function forgetLook(id: string): Promise<void> {
  return enqueue(() => forgetKind('look', id))
}

async function openUnlocked(onProgress: (text: string) => void): Promise<OpenSnapshot> {
  const [account, body, garments, looks, stamp] = await Promise.all([loadAccount(), loadBody(), loadGarments(), loadLooks(), loadDiskStamp()])
  let index: LibraryIndex
  try {
    index = normalizeIndex(await fetchIndex())
  } catch {
    console.error('本机文件夹没有打开，先用浏览器里的衣橱')
    return { account, body, garments, looks, note: 'ready' }
  }
  const remoteCount = (index.account ? 1 : 0) + (index.body ? 1 : 0) + Object.keys(index.garments).length + Object.keys(index.looks).length
  const localCount = (account ? 1 : 0) + (body ? 1 : 0) + garments.length + looks.length
  if (localCount > 0 && remoteCount === 0) onProgress('正在把衣橱写入本机文件夹')
  else if (localCount === 0 && remoteCount > 0) onProgress('正在从本机文件夹装回衣橱')
  const flags: Flags = { pushed: false, pulled: false }
  const nextAccount = await reconcileAccount(account, index, stamp, flags, onProgress)
  const nextBody = await reconcileBody(body, index, stamp, flags, onProgress)
  const nextGarments = await reconcileGarments(garments, index, stamp, flags, onProgress)
  const nextLooks = await reconcileLooks(looks, index, stamp, flags, onProgress)
  const note = flags.pulled ? 'restored' : flags.pushed && remoteCount === 0 ? 'copied' : 'ready'
  if (note !== 'ready') sessionStorage.setItem('wardrobe-disk-note', note)
  return { account: nextAccount, body: nextBody, garments: nextGarments, looks: nextLooks, note }
}

async function reconcileAccount(local: Account | null, index: LibraryIndex, stamp: DiskStamp, flags: Flags, onProgress: (text: string) => void) {
  return reconcileOne({
    kind: 'account',
    id: 'account',
    local,
    localAt: stamp.account,
    removedAt: 0,
    remote: index.account,
    tombAt: 0,
    flags,
    stamp,
    onProgress,
    pack: (item) => splitEntity('account', item),
    persist: saveAccount,
    discard: async () => undefined,
    materialize: async (stored) => {
      const blobs = await loadBlobs('account', 'account', stored)
      return asAccount(stored.record, requiredBlob(blobs, 'avatar'))
    },
  })
}

async function reconcileBody(local: BodyProfile | null, index: LibraryIndex, stamp: DiskStamp, flags: Flags, onProgress: (text: string) => void) {
  return reconcileOne({
    kind: 'body',
    id: 'body',
    local,
    localAt: stamp.body,
    removedAt: stamp.removedBody,
    remote: index.body,
    tombAt: index.tombstones.body,
    flags,
    stamp,
    onProgress,
    pack: (item) => splitEntity('body', item),
    persist: saveBody,
    discard: deleteBody,
    materialize: async (stored) => {
      const blobs = await loadBlobs('body', 'body', stored)
      return asBody(stored.record, requiredBlob(blobs, 'source'), requiredBlob(blobs, 'normalized'), requiredBlob(blobs, 'image'))
    },
  })
}

function normalizeGarment(item: Garment): Garment {
  if ((item as { category: string }).category === 'outer') return { ...item, category: 'top' }
  return item
}

async function reconcileGarments(local: Garment[], index: LibraryIndex, stamp: DiskStamp, flags: Flags, onProgress: (text: string) => void) {
  const normalized = await Promise.all(
    local.map(async (item) => {
      const next = normalizeGarment(item)
      if (next !== item) await putGarment(next)
      return next
    }),
  )
  const localMap = new Map(normalized.map((item) => [item.id, item]))
  const ids = new Set<string>([
    ...localMap.keys(),
    ...Object.keys(index.garments),
    ...Object.keys(stamp.removedGarments),
    ...Object.keys(index.tombstones.garments),
  ])
  const next: Garment[] = []
  for (const id of ids) {
    const item = await reconcileOne({
      kind: 'garment',
      id,
      local: localMap.get(id) ?? null,
      localAt: stamp.garments[id] ?? 0,
      removedAt: stamp.removedGarments[id] ?? 0,
      remote: index.garments[id] ?? null,
      tombAt: index.tombstones.garments[id] ?? 0,
      flags,
      stamp,
      onProgress,
      pack: (garment) => splitEntity('garment', garment),
      persist: putGarment,
      discard: () => removeGarment(id),
      materialize: async (stored) => {
        const blobs = await loadBlobs('garment', id, stored)
        return asGarment(stored.record, requiredBlob(blobs, 'cutout'), blobs.sticker, blobs.original)
      },
    })
    if (item) next.push(item)
  }
  return next.sort((a, b) => b.createdAt - a.createdAt)
}

async function reconcileLooks(local: Look[], index: LibraryIndex, stamp: DiskStamp, flags: Flags, onProgress: (text: string) => void) {
  const localMap = new Map(local.map((item) => [item.id, item]))
  const ids = new Set<string>([...localMap.keys(), ...Object.keys(index.looks), ...Object.keys(stamp.removedLooks), ...Object.keys(index.tombstones.looks)])
  const next: Look[] = []
  for (const id of ids) {
    const item = await reconcileOne({
      kind: 'look',
      id,
      local: localMap.get(id) ?? null,
      localAt: stamp.looks[id] ?? 0,
      removedAt: stamp.removedLooks[id] ?? 0,
      remote: index.looks[id] ?? null,
      tombAt: index.tombstones.looks[id] ?? 0,
      flags,
      stamp,
      onProgress,
      pack: (look) => splitEntity('look', look),
      persist: putLook,
      discard: () => removeLook(id),
      materialize: async (stored) => {
        const blobs = await loadBlobs('look', id, stored)
        return asLook(stored.record, requiredBlob(blobs, 'image'), blobs.real, blobs.video, blobs.realVideo)
      },
    })
    if (item) next.push(item)
  }
  return next.sort((a, b) => b.createdAt - a.createdAt)
}

type Side<T> = {
  kind: LibraryKind
  id: string
  local: T | null
  localAt: number
  removedAt: number
  remote: StoredRecord | null
  tombAt: number
  flags: Flags
  stamp: DiskStamp
  onProgress: (text: string) => void
  pack: (item: T) => Packed
  persist: (item: T) => Promise<void>
  discard: () => Promise<void>
  materialize: (stored: StoredRecord) => Promise<T>
}

async function reconcileOne<T>(side: Side<T>): Promise<T | null> {
  const remote = side.remote
  if (side.local && remote) {
    if (side.localAt > remote.savedAt) return pushSide(side, side.local)
    if (remote.savedAt > side.localAt) return pullSide(side, remote)
    const packed = side.pack(side.local)
    const same = (await signature(side.kind, packed.record, packed.blobs)) === remoteSignature(side.kind, remote)
    if (same) return side.local
    return pushSide(side, side.local)
  }
  if (side.local && !remote) {
    if (side.tombAt > side.localAt) return dropLocal(side)
    return pushSide(side, side.local)
  }
  if (!side.local && remote) {
    if (side.removedAt >= remote.savedAt && side.removedAt > 0) {
      await deleteRemote(side)
      return null
    }
    return pullSide(side, remote)
  }
  return null
}

async function pushSide<T>(side: Side<T>, item: T): Promise<T | null> {
  side.onProgress('正在把衣橱写入本机文件夹')
  try {
    const removed = await writePacked(side.kind, side.id, side.pack(item), side.stamp)
    if (removed) {
      await side.discard()
      side.flags.pulled = true
      return null
    }
    side.flags.pushed = true
    return item
  } catch (error) {
    console.error('本机文件夹没有写上', diskMessage(error))
    return side.local
  }
}

async function pullSide<T>(side: Side<T>, remote: StoredRecord): Promise<T | null> {
  side.onProgress('正在从本机文件夹装回衣橱')
  try {
    const next = await side.materialize(remote)
    await side.persist(next)
    markSaved(side.stamp, side.kind, side.id, remote.savedAt)
    await saveDiskStamp(side.stamp)
    side.flags.pulled = true
    return next
  } catch {
    console.error('本机文件夹里有一件没有读出来')
    return side.local
  }
}

async function dropLocal<T>(side: Side<T>): Promise<null> {
  await side.discard()
  markRemoved(side.stamp, side.kind, side.id, side.tombAt)
  await saveDiskStamp(side.stamp)
  side.flags.pulled = true
  return null
}

async function deleteRemote<T>(side: Side<T>) {
  try {
    await postLibrary({ op: 'delete', kind: side.kind, id: side.id, savedAt: side.removedAt })
  } catch {
    console.error('本机文件夹没有删掉')
  }
}

async function writeKind(kind: LibraryKind, id: string, packed: Packed): Promise<boolean> {
  try {
    const stamp = await loadDiskStamp()
    return await writePacked(kind, id, packed, stamp)
  } catch (error) {
    console.error('本机文件夹没有写上', diskMessage(error))
    return false
  }
}

async function writePacked(kind: LibraryKind, id: string, packed: Packed, stamp: DiskStamp): Promise<boolean> {
  for (const name of LIBRARY_REQUIRED[kind]) {
    if (!packed.blobs[name]) throw new Error('缺少图片')
  }
  const result = await saveToDisk(kind, packed)
  if (!result.ok) {
    markRemoved(stamp, kind, id, result.savedAt)
    await saveDiskStamp(stamp)
    return true
  }
  markSaved(stamp, kind, id, result.savedAt)
  await saveDiskStamp(stamp)
  return false
}

async function forgetKind(kind: 'body' | 'garment' | 'look', id: string) {
  const savedAt = Date.now()
  const stamp = await loadDiskStamp()
  markRemoved(stamp, kind, id, savedAt)
  await saveDiskStamp(stamp)
  try {
    await postLibrary({ op: 'delete', kind, id, savedAt })
  } catch {
    console.error('本机文件夹没有删掉')
  }
}

async function saveToDisk(kind: LibraryKind, packed: Packed): Promise<LibraryWriteResult> {
  const blobs: Record<string, { type: string; data: string }> = {}
  for (const name of LIBRARY_BLOBS[kind]) {
    const blob = packed.blobs[name]
    if (!blob) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    blobs[name] = { type: imageType(bytes, blob.type || ''), data: bytesToBase64(bytes) }
  }
  return postLibrary({ op: 'put', kind, savedAt: Date.now(), record: packed.record, blobs })
}

async function fetchIndex(): Promise<LibraryIndex> {
  const response = await fetch('/api/library', { cache: 'no-store' })
  if (!response.ok) throw new Error('本机文件夹没有打开')
  return (await response.json()) as LibraryIndex
}

async function postLibrary(body: unknown): Promise<LibraryWriteResult> {
  const response = await fetch('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error((await response.text()) || '本机文件夹没有写上')
  return (await response.json()) as LibraryWriteResult
}

async function loadBlobs(kind: LibraryKind, id: string, stored: StoredRecord): Promise<Record<string, Blob>> {
  const blobs: Record<string, Blob> = {}
  for (const name of LIBRARY_BLOBS[kind]) {
    const info = stored.blobs[name]
    if (!info) continue
    const response = await fetch(`/api/library/file?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('图片读不出来')
    blobs[name] = new Blob([await response.arrayBuffer()], { type: info.type || 'application/octet-stream' })
  }
  return blobs
}

function requiredBlob(blobs: Record<string, Blob>, name: string): Blob {
  const blob = blobs[name]
  if (!blob) throw new Error('缺少图片')
  return blob
}

async function signature(kind: LibraryKind, record: Record<string, unknown>, blobs: Record<string, Blob | undefined>): Promise<string> {
  const marks: string[] = []
  for (const name of LIBRARY_BLOBS[kind]) {
    const blob = blobs[name]
    marks.push(blob ? await blobMark(blob) : '')
  }
  return `${canonical(record)}|${marks.join('|')}`
}

function remoteSignature(kind: LibraryKind, stored: StoredRecord): string {
  const marks = LIBRARY_BLOBS[kind].map((name) => stored.blobs[name]?.mark ?? '')
  return `${canonical(stored.record)}|${marks.join('|')}`
}

async function blobMark(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return markOf(bytes, imageType(bytes, blob.type || ''))
}

function splitEntity(kind: LibraryKind, source: object): Packed {
  const names = new Set<string>(LIBRARY_BLOBS[kind])
  const record: Record<string, unknown> = {}
  const blobs: Record<string, Blob | undefined> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key.endsWith('Blob')) {
      const name = key.slice(0, -4)
      if (names.has(name) && value instanceof Blob) blobs[name] = value
      continue
    }
    if (value !== undefined) record[key] = value
  }
  return { record, blobs }
}

function markSaved(stamp: DiskStamp, kind: LibraryKind, id: string, savedAt: number) {
  if (kind === 'account') {
    stamp.account = savedAt
    return
  }
  if (kind === 'body') {
    stamp.body = savedAt
    stamp.removedBody = 0
    return
  }
  if (kind === 'garment') {
    stamp.garments[id] = savedAt
    delete stamp.removedGarments[id]
    return
  }
  stamp.looks[id] = savedAt
  delete stamp.removedLooks[id]
}

function markRemoved(stamp: DiskStamp, kind: LibraryKind, id: string, savedAt: number) {
  if (kind === 'account') return
  if (kind === 'body') {
    stamp.body = 0
    stamp.removedBody = savedAt
    return
  }
  if (kind === 'garment') {
    delete stamp.garments[id]
    stamp.removedGarments[id] = savedAt
    return
  }
  delete stamp.looks[id]
  stamp.removedLooks[id] = savedAt
}

function normalizeIndex(index: LibraryIndex): LibraryIndex {
  return {
    version: 1,
    account: index?.account ?? null,
    body: index?.body ?? null,
    garments: index?.garments ?? {},
    looks: index?.looks ?? {},
    tombstones: {
      body: index?.tombstones?.body ?? 0,
      garments: index?.tombstones?.garments ?? {},
      looks: index?.tombstones?.looks ?? {},
    },
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null) ?? 'null'
}

function diskMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (!message || message.includes('data:') || message.length > 180) return ''
  return message
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

function asAccount(record: Record<string, unknown>, avatarBlob: Blob): Account {
  if (typeof record.id !== 'string' || !isLibraryId(record.id) || typeof record.name !== 'string' || typeof record.phone !== 'string' || typeof record.createdAt !== 'number') {
    throw new Error('用户资料读不出来')
  }
  const account: Account = { id: record.id, name: record.name, phone: record.phone, createdAt: record.createdAt, avatarBlob }
  const savedTags = readTags(record.savedTags, 80)
  if (savedTags.length > 0) account.savedTags = savedTags
  return account
}

function asBody(record: Record<string, unknown>, sourceBlob: Blob, normalizedBlob: Blob, imageBlob: Blob): BodyProfile {
  if (typeof record.heightCm !== 'number' || typeof record.weightKg !== 'number' || typeof record.updatedAt !== 'number') throw new Error('身形读不出来')
  if (!isBodyType(record.bodyType)) throw new Error('身形读不出来')
  if (typeof record.demo !== 'boolean' || typeof record.segmented !== 'boolean' || typeof record.posed !== 'boolean') throw new Error('身形读不出来')
  const profile: BodyProfile = {
    heightCm: record.heightCm,
    weightKg: record.weightKg,
    bodyType: record.bodyType,
    adjustments: readAdjustments(record.adjustments),
    sourceBlob,
    normalizedBlob,
    normalizedMarks: readMarks(record.normalizedMarks),
    imageBlob,
    marks: readMarks(record.marks),
    demo: record.demo,
    segmented: record.segmented,
    posed: record.posed,
    updatedAt: record.updatedAt,
  }
  if (typeof record.person === 'boolean') profile.person = record.person
  return profile
}

function asGarment(record: Record<string, unknown>, cutoutBlob: Blob, stickerBlob?: Blob, originalBlob?: Blob): Garment {
  if (typeof record.id !== 'string' || !isLibraryId(record.id) || typeof record.name !== 'string' || typeof record.color !== 'string' || typeof record.createdAt !== 'number') {
    throw new Error('衣服读不出来')
  }
  const category = readCategory(record.category)
  if (!category || (record.status !== 'owned' && record.status !== 'wishlist')) throw new Error('衣服读不出来')
  const garment: Garment = {
    id: record.id,
    name: record.name,
    category,
    status: record.status,
    color: record.color,
    cutoutBlob,
    createdAt: record.createdAt,
  }
  if (originalBlob) garment.originalBlob = originalBlob
  if (typeof record.userId === 'string') garment.userId = record.userId
  if (typeof record.title === 'string') {
    const title = acceptGarmentTitle(record.title, CATEGORY_LABEL[category])
    if (title) garment.title = title
  }
  if (record.season != null) {
    if (!isSeason(record.season)) throw new Error('衣服读不出来')
    garment.season = record.season
  }
  if (stickerBlob) garment.stickerBlob = stickerBlob
  if (typeof record.stickerFor === 'number') garment.stickerFor = record.stickerFor
  if (typeof record.stickerVer === 'number') garment.stickerVer = record.stickerVer
  const place = readPlace(record.stickerPlace)
  if (place) garment.stickerPlace = place
  const frame = readFrame(record.stickerFrame)
  if (frame) garment.stickerFrame = frame
  return garment
}

function asLook(record: Record<string, unknown>, imageBlob: Blob, realBlob?: Blob, videoBlob?: Blob, realVideoBlob?: Blob): Look {
  if (typeof record.id !== 'string' || !isLibraryId(record.id) || typeof record.createdAt !== 'number') throw new Error('穿搭读不出来')
  if (record.mode !== 'closet' && record.mode !== 'tryon') throw new Error('穿搭读不出来')
  if (!Array.isArray(record.garmentIds) || record.garmentIds.some((item) => typeof item !== 'string')) throw new Error('穿搭读不出来')
  const look: Look = { id: record.id, mode: record.mode, garmentIds: record.garmentIds, imageBlob, createdAt: record.createdAt }
  if (typeof record.userId === 'string') look.userId = record.userId
  if (videoBlob) look.videoBlob = videoBlob
  if (realBlob) look.realBlob = realBlob
  if (realVideoBlob) look.realVideoBlob = realVideoBlob
  if (record.showReal === true && realBlob) look.showReal = true
  const tags = readTags(record.tags)
  if (tags.length > 0) look.tags = tags
  return look
}

function readTags(value: unknown, limit?: number): string[] {
  if (!Array.isArray(value)) return []
  return uniqueTags(value.filter((item) => typeof item === 'string'), limit)
}

function readAdjustments(value: unknown): Adjustments {
  if (!value || typeof value !== 'object') throw new Error('身形比例读不出来')
  const record = value as Record<string, unknown>
  if (typeof record.shoulder !== 'number' || typeof record.waist !== 'number' || typeof record.hip !== 'number' || typeof record.leg !== 'number') {
    throw new Error('身形比例读不出来')
  }
  return { shoulder: record.shoulder, waist: record.waist, hip: record.hip, leg: record.leg }
}

function readMarks(value: unknown): BodyMarks {
  if (!value || typeof value !== 'object') throw new Error('身形位置读不出来')
  const record = value as Record<string, unknown>
  const marks = {} as BodyMarks
  for (const key of MARK_KEYS) {
    const point = record[key]
    if (!point || typeof point !== 'object') throw new Error('身形位置读不出来')
    const pair = point as Record<string, unknown>
    if (typeof pair.x !== 'number' || typeof pair.y !== 'number') throw new Error('身形位置读不出来')
    marks[key] = { x: pair.x, y: pair.y }
  }
  for (const key of ['lEar', 'rEar', 'neckLeft', 'neckRight'] as const) {
    const point = readPoint(record[key])
    if (point) marks[key] = point
  }
  return marks
}

function readPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null
  const pair = value as Record<string, unknown>
  if (typeof pair.x !== 'number' || typeof pair.y !== 'number') return null
  return { x: pair.x, y: pair.y }
}

function readPlace(value: unknown): StickerPlace | undefined {
  if (value == null) return undefined
  if (!value || typeof value !== 'object') throw new Error('贴纸位置读不出来')
  const record = value as Record<string, unknown>
  if (typeof record.dx !== 'number' || typeof record.dy !== 'number' || typeof record.scale !== 'number') throw new Error('贴纸位置读不出来')
  return { dx: record.dx, dy: record.dy, scale: record.scale }
}

function readFrame(value: unknown): StickerFrame | undefined {
  if (value == null) return undefined
  if (!value || typeof value !== 'object') throw new Error('贴纸位置读不出来')
  const record = value as Record<string, unknown>
  if (typeof record.x !== 'number' || typeof record.y !== 'number' || typeof record.width !== 'number' || typeof record.height !== 'number') {
    throw new Error('贴纸位置读不出来')
  }
  return { x: record.x, y: record.y, width: record.width, height: record.height }
}

function readCategory(value: unknown): Category | null {
  if (value === 'outer') return 'top'
  if (typeof value === 'string' && (CATEGORY_ORDER as readonly string[]).includes(value)) return value as Category
  return null
}

function isSeason(value: unknown): value is Season {
  return value === 'spring' || value === 'summer' || value === 'winter'
}

function isBodyType(value: unknown): value is BodyType {
  return value === 'straight' || value === 'pear' || value === 'hourglass' || value === 'apple'
}
