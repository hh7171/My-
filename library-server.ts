import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join, resolve, sep } from 'node:path'
import { isGarmentDir } from './src/garment-name.ts'
import {
  applyStickerNote,
  formatStickerNote,
  frameFitsImage,
  imageType,
  isLibraryId,
  markOf,
  parseStickerNote,
  readPngSize,
  readStickerFrame,
  stickerNoteFromRecord,
  storageId,
  LIBRARY_BLOBS,
  LIBRARY_REQUIRED,
  type BlobInfo,
  type LibraryIndex,
  type LibraryKind,
  type LibraryWriteResult,
  type PngStickerFrame,
  type StoredRecord,
} from './src/library-mark.ts'

const LIBRARY_FILE =
  /^files\/(account|body)\/[A-Za-z0-9_-]+\.(?:png|jpg|webp|gif|bin)$|^files\/looks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|jpg|webp|gif|bin|mp4)$|^files\/garments\/([A-Za-z0-9_-]+|(?:wishlist\/)?(?:spring|summer|winter|accessory)\/[A-Za-z]+\/[A-Za-z]+\d{2,})\/[A-Za-z0-9_-]+\.(?:png|jpg|webp|gif|bin)$/

function isLibraryFile(relative: string): boolean {
  const match = LIBRARY_FILE.exec(relative)
  if (!match) return false
  const garmentDir = match[2]
  if (!garmentDir) return true
  return isLibraryId(garmentDir) || isGarmentDir(garmentDir)
}

type PutInput = {
  op: 'put'
  kind: LibraryKind
  savedAt: number
  record: Record<string, unknown>
  blobs: Record<string, { type?: unknown; data?: unknown }>
}

type DeleteInput = {
  op: 'delete'
  kind: 'body' | 'garment' | 'look'
  id?: string
  savedAt: number
}

export type LibraryStore = {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export function createLibrary(root: string): LibraryStore {
  const indexPath = join(root, 'library.json')
  let queue: Promise<void> = Promise.resolve()
  let announced = false

  function gate<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function announce() {
    if (announced) return
    announced = true
    console.log(`衣橱数据在 ${root}`)
  }

  return {
    handle(req, res) {
      return gate(() => respond(req, res))
    },
  }

  async function respond(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/api/library' && req.method === 'GET') {
        const index = await loadIndex()
        if (await adoptGarmentStickers(index)) await saveIndex(index)
        sendJson(res, 200, index)
        return
      }
      if (url.pathname === '/api/library/file' && req.method === 'GET') {
        const kind = readKind(url.searchParams.get('kind'))
        const name = url.searchParams.get('name') || ''
        const id = url.searchParams.get('id') || ''
        if (!kind || !(LIBRARY_BLOBS[kind] as readonly string[]).includes(name) || !isLibraryId(id)) {
          sendText(res, 400, '找不到这张图')
          return
        }
        const index = await loadIndex()
        const stored = storedOf(index, kind, id)
        const info = stored?.blobs[name]
        if (!info) {
          sendText(res, 404, '找不到这张图')
          return
        }
        const bytes = await readFile(inside(info.file))
        res.statusCode = 200
        res.setHeader('Content-Type', info.type)
        res.setHeader('Content-Length', bytes.length)
        res.setHeader('Cache-Control', 'no-store')
        res.end(bytes)
        return
      }
      if (url.pathname === '/api/library' && req.method === 'POST') {
        const input = parseBody(await readBody(req))
        const result = input.op === 'delete' ? await removeRecord(input) : await writeRecord(input)
        sendJson(res, 200, result)
        return
      }
      if (url.pathname === '/api/source' && req.method === 'GET') {
        sendJson(res, 200, { items: await listSources(root) })
        return
      }
      if (url.pathname === '/api/source/file' && req.method === 'GET') {
        const id = url.searchParams.get('id') || ''
        const name = url.searchParams.get('name') || ''
        const found = await findSourceFile(root, id, name)
        if (!found) {
          sendText(res, 404, '找不到这个文件')
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', found.type)
        res.setHeader('Content-Length', found.bytes.length)
        res.setHeader('Cache-Control', 'no-store')
        res.end(found.bytes)
        return
      }
      if (url.pathname === '/api/source' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8')) as {
          op?: string
          id?: string
          name?: string
          type?: string
          data?: string
          page?: string
          garmentIds?: unknown
        }
        if (body.op === 'drop') {
          await dropSourceFile(root, body.id || '', body.name || '')
          sendJson(res, 200, { ok: true })
          return
        }
        if (body.op === 'keep') {
          await keepSource(root, body.id || '')
          sendJson(res, 200, { ok: true })
          return
        }
        if (body.op !== 'put' || !body.id || !body.name || typeof body.data !== 'string') {
          sendText(res, 400, '原片没有写下来')
          return
        }
        const bytes = Buffer.from(body.data, 'base64')
        const type = imageType(bytes, typeof body.type === 'string' ? body.type : '')
        await putSourceFile(root, body.id, body.name, type, bytes, {
          page: body.page === 'tryon' ? 'tryon' : 'closet',
          garmentIds: Array.isArray(body.garmentIds) ? body.garmentIds.filter((item): item is string => typeof item === 'string') : undefined,
        })
        sendJson(res, 200, { ok: true })
        return
      }
      sendText(res, 405, '不支持这个请求')
    } catch (error) {
      if (res.headersSent || res.writableEnded) return
      sendText(res, 400, publicMessage(error))
    }
  }

  async function writeRecord(input: PutInput): Promise<LibraryWriteResult> {
    const index = await loadIndex()
    const id = storageId(input.kind, typeof input.record.id === 'string' ? input.record.id : undefined)
    const savedAt = finite(input.savedAt)
    const tombAt = tombstone(index, input.kind, id)
    if (tombAt > savedAt) return { ok: false, deleted: true, savedAt: tombAt }
    const previous = storedOf(index, input.kind, id)
    const decoded: Record<string, { type: string; bytes: Buffer; mark: string }> = {}
    for (const name of LIBRARY_BLOBS[input.kind]) {
      const raw = input.blobs[name]
      if (!raw) continue
      decoded[name] = decodeBlob(raw)
    }
    for (const name of LIBRARY_REQUIRED[input.kind]) {
      if (!decoded[name]) throw new Error('缺少图片')
    }
    const archived = new Set<string>()
    const retire = async (file: string) => {
      if (archived.has(file)) return
      archived.add(file)
      await archiveReplaced(file, previous?.savedAt ?? savedAt)
    }
    const blobs: Record<string, BlobInfo> = {}
    for (const [name, blob] of Object.entries(decoded)) {
      const relative = blobRelative(input.kind, id, `${name}${extension(blob.type)}`, input.record)
      const previousBlob = previous?.blobs[name]
      if (previousBlob && previousBlob.mark !== blob.mark) await retire(previousBlob.file)
      await mkdir(dirname(inside(relative)), { recursive: true })
      await writeFile(inside(relative), blob.bytes)
      blobs[name] = { type: blob.type, file: relative, bytes: blob.bytes.length, mark: blob.mark }
    }
    for (const [name, info] of Object.entries(previous?.blobs ?? {})) {
      if (blobs[name]) {
        if (info.file !== blobs[name].file) {
          await retire(info.file)
          await rm(inside(info.file), { force: true })
        }
        continue
      }
      await retire(info.file)
      await rm(inside(info.file), { force: true })
    }
    const stored: StoredRecord = { savedAt, record: stripBlobs(input.record), blobs }
    assign(index, input.kind, id, stored)
    clearTombstone(index, input.kind, id)
    if (input.kind === 'garment') await writeStickerNote(id, stored.record, Boolean(blobs.sticker))
    await saveIndex(index)
    return { ok: true, savedAt }
  }

  async function removeRecord(input: DeleteInput): Promise<LibraryWriteResult> {
    const index = await loadIndex()
    const id = input.kind === 'body' ? 'body' : input.id || ''
    if (!isLibraryId(id)) throw new Error('编号不对')
    const savedAt = finite(input.savedAt)
    const current = storedOf(index, input.kind, id)
    if (current && current.savedAt > savedAt) return { ok: true, savedAt: current.savedAt }
    const removedDirs = new Set<string>()
    for (const info of Object.values(current?.blobs ?? {})) {
      await rm(inside(info.file), { force: true })
      removedDirs.add(dirname(inside(info.file)))
    }
    for (const dir of removedDirs) await rm(dir, { recursive: true, force: true })
    if (input.kind !== 'body') await removeEmptyParents(removedDirs, resolve(root, 'files', 'garments'))
    assign(index, input.kind, id, null)
    setTombstone(index, input.kind, id, savedAt)
    await saveIndex(index)
    return { ok: true, savedAt }
  }

  async function findStickerFile(id: string, stored: StoredRecord): Promise<{ relative: string; bytes: Buffer } | null> {
    const dir = join(root, 'files', 'garments', ...garmentStorageDir(stored.record, id).split('/'))
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return null
    }
    for (const ext of ['png', 'jpg', 'webp', 'gif']) {
      const filename = `sticker.${ext}`
      if (!names.includes(filename)) continue
      const relative = `files/garments/${garmentStorageDir(stored.record, id)}/${filename}`
      if (!isLibraryFile(relative)) continue
      const bytes = await readFile(inside(relative))
      if (bytes.length === 0) continue
      return { relative, bytes }
    }
    return null
  }

  function readRecordFrame(value: unknown): PngStickerFrame | null {
  if (!value || typeof value !== 'object') return null
  const frame = value as Partial<PngStickerFrame>
  if (typeof frame.x !== 'number' || typeof frame.y !== 'number' || typeof frame.width !== 'number' || typeof frame.height !== 'number') return null
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
}

function frameFromTwin(index: LibraryIndex, selfId: string, mark: string, size: { width: number; height: number }): PngStickerFrame | null {
  for (const [id, stored] of Object.entries(index.garments)) {
    if (id === selfId || stored.blobs.sticker?.mark !== mark) continue
    const frame = readRecordFrame(stored.record.stickerFrame)
    if (frame && frameFitsImage(frame, size.width, size.height)) return frame
  }
  return null
}

function restoreStickerFrame(index: LibraryIndex, selfId: string, bytes: Uint8Array, mark: string): boolean {
  const stored = index.garments[selfId]
  const size = readPngSize(bytes)
  if (!stored || !size) return false
  const current = readRecordFrame(stored.record.stickerFrame)
  if (current && frameFitsImage(current, size.width, size.height)) return false
  const embedded = readStickerFrame(bytes)
  const recovered = embedded && frameFitsImage(embedded, size.width, size.height) ? embedded : frameFromTwin(index, selfId, mark, size)
  if (!recovered) return false
  stored.record.stickerFrame = recovered
  return true
}

function clearStickerRecord(record: Record<string, unknown>) {
    delete record.stickerFrame
    delete record.stickerPlace
    delete record.stickerFor
    delete record.stickerVer
  }

  async function adoptGarmentStickers(index: LibraryIndex): Promise<boolean> {
    let changed = false
    const bodySize = await bodyImageSize(index)
    for (const [id, stored] of Object.entries(index.garments)) {
      const found = await findStickerFile(id, stored)
      const current = stored.blobs.sticker
      if (!found) {
        if (!current) continue
        delete stored.blobs.sticker
        clearStickerRecord(stored.record)
        stored.savedAt = Date.now()
        changed = true
        continue
      }
      const type = imageType(found.bytes, '')
      const mark = markOf(found.bytes, type)
      const unchanged = current && current.file === found.relative && current.bytes === found.bytes.length && current.mark === mark
      if (!unchanged) {
        stored.blobs.sticker = { type, file: found.relative, bytes: found.bytes.length, mark }
        clearStickerRecord(stored.record)
        const bodyUpdated = index.body?.record.updatedAt
        if (typeof bodyUpdated === 'number') stored.record.stickerFor = bodyUpdated
        stored.savedAt = Date.now()
        changed = true
      }
      const size = readPngSize(found.bytes)
      const currentFrame = readRecordFrame(stored.record.stickerFrame)
      const trusted = Boolean(size && currentFrame && frameFitsImage(currentFrame, size.width, size.height))
      const noted = trusted ? null : await readStickerNote(id, stored.record)
      if (!trusted && size && noted && frameFitsImage(noted.frame, size.width, size.height) && applyStickerNote(stored.record, noted)) {
        stored.savedAt = Date.now()
        changed = true
      } else if (!trusted && restoreStickerFrame(index, id, found.bytes, mark)) {
        stored.savedAt = Date.now()
        changed = true
      } else if (!trusted && size && bodySize && size.width === bodySize.width && size.height === bodySize.height) {
        stored.record.stickerFrame = { x: 0, y: 0, width: size.width, height: size.height }
        stored.savedAt = Date.now()
        changed = true
      }
      await writeStickerNote(id, stored.record, true)
    }
    return changed
  }

  function garmentNotePath(id: string, record: Record<string, unknown>): string {
    const dir = garmentStorageDir(record, id)
    if (!isGarmentDir(dir) && !isLibraryId(dir)) throw new Error('路径不对')
    const full = resolve(root, 'files', 'garments', dir, 'sticker.json')
    const base = resolve(root, 'files', 'garments')
    if (full !== base && !full.startsWith(base + sep)) throw new Error('路径不对')
    return full
  }

  async function bodyImageSize(index: LibraryIndex): Promise<{ width: number; height: number } | null> {
    const file = index.body?.blobs.image?.file
    if (!file) return null
    try {
      return readPngSize(await readFile(inside(file)))
    } catch {
      return null
    }
  }

  async function readStickerNote(id: string, record: Record<string, unknown>) {
    try {
      return parseStickerNote(await readFile(garmentNotePath(id, record), 'utf8'))
    } catch {
      return null
    }
  }

  async function writeStickerNote(id: string, record: Record<string, unknown>, hasSticker: boolean): Promise<boolean> {
    const path = garmentNotePath(id, record)
    const note = hasSticker ? stickerNoteFromRecord(record) : null
    if (!note) {
      await rm(path, { force: true })
      return false
    }
    const text = formatStickerNote(note)
    try {
      if ((await readFile(path, 'utf8')) === text) return false
    } catch {
      /* 目录里还没有这张位置记录 */
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
    return true
  }

  async function loadIndex(): Promise<LibraryIndex> {
    let text: string
    try {
      text = await readFile(indexPath, 'utf8')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') return emptyIndex()
      throw new Error('衣橱目录读不了')
    }
    try {
      return normalizeIndex(JSON.parse(text) as unknown)
    } catch (error) {
      if (error instanceof Error && error.message === '衣橱目录读不了') throw error
      throw new Error('衣橱目录读不了')
    }
  }

  async function saveIndex(index: LibraryIndex) {
    announce()
    await mkdir(root, { recursive: true })
    const temp = join(root, 'library.json.tmp')
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`)
    await rename(temp, indexPath)
  }

  function inside(relative: string): string {
    if (!isLibraryFile(relative)) throw new Error('路径不对')
    const full = resolve(root, relative)
    const base = resolve(root)
    if (full !== base && !full.startsWith(base + sep)) throw new Error('路径不对')
    return full
  }

  async function archiveReplaced(relative: string, savedAt: number) {
    if (!relative.startsWith('files/')) return
    const source = inside(relative)
    const slash = relative.lastIndexOf('/')
    const name = relative.slice(slash + 1)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    const dir = join(root, 'replaced', relative.slice('files/'.length, slash))
    await mkdir(dir, { recursive: true })
    const stamp = Number.isFinite(savedAt) ? String(Math.trunc(savedAt)) : String(Date.now())
    for (let n = 0; n < 100; n += 1) {
      const suffix = n === 0 ? stamp : `${stamp}-${n}`
      try {
        await copyFile(source, join(dir, `${stem}-${suffix}${ext}`), constants.COPYFILE_EXCL)
        return
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (code === 'ENOENT') return
        if (code === 'EEXIST') continue
        throw error
      }
    }
  }
}

function readKind(value: string | null): LibraryKind | null {
  if (value === 'account' || value === 'body' || value === 'garment' || value === 'look') return value
  return null
}

function parseBody(raw: Buffer): PutInput | DeleteInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('衣橱记录读不了')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('衣橱记录读不了')
  const body = parsed as Record<string, unknown>
  const kind = readKind(typeof body.kind === 'string' ? body.kind : null)
  if (!kind) throw new Error('衣橱记录读不了')
  const savedAt = body.savedAt
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) throw new Error('衣橱记录读不了')
  if (body.op === 'delete') {
    if (kind === 'account') throw new Error('衣橱记录读不了')
    const id = body.id
    return {
      op: 'delete',
      kind,
      id: typeof id === 'string' ? id : undefined,
      savedAt,
    }
  }
  if (body.op !== 'put') throw new Error('衣橱记录读不了')
  if (!body.record || typeof body.record !== 'object' || Array.isArray(body.record)) throw new Error('衣橱记录读不了')
  const blobs = body.blobs
  if (!blobs || typeof blobs !== 'object' || Array.isArray(blobs)) throw new Error('衣橱记录读不了')
  return {
    op: 'put',
    kind,
    savedAt,
    record: body.record as Record<string, unknown>,
    blobs: blobs as PutInput['blobs'],
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buf.length
      if (size > 96_000_000) {
        reject(new Error('这份数据太大了'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function decodeBlob(raw: { type?: unknown; data?: unknown }) {
  if (typeof raw.type !== 'string' || typeof raw.data !== 'string') throw new Error('图片读不了')
  if (raw.data.length > 44_000_000) throw new Error('图片太大了')
  const bytes = Buffer.from(raw.data, 'base64')
  if (bytes.length === 0 || bytes.length > 32_000_000) throw new Error('图片太大了')
  const type = imageType(bytes, raw.type)
  return { type, bytes, mark: markOf(bytes, type) }
}

function stripBlobs(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || key.endsWith('Blob')) continue
    if (value !== undefined) next[key] = value
  }
  return next
}

const SOURCE_NAMES = ['generated', 'video', 'real', 'realVideo'] as const

type SourceMeta = {
  id: string
  page: 'closet' | 'tryon'
  garmentIds: string[]
  kept: boolean
  updatedAt: number
}

function sourceDir(root: string, id: string): string {
  if (!isLibraryId(id)) throw new Error('编号不对')
  return join(root, 'files', 'sources', id)
}

function isSourceName(name: string): name is (typeof SOURCE_NAMES)[number] {
  return (SOURCE_NAMES as readonly string[]).includes(name)
}

async function readSourceMeta(root: string, id: string): Promise<SourceMeta> {
  try {
    const raw = JSON.parse(await readFile(join(sourceDir(root, id), 'meta.json'), 'utf8')) as Partial<SourceMeta>
    return {
      id,
      page: raw.page === 'tryon' ? 'tryon' : 'closet',
      garmentIds: Array.isArray(raw.garmentIds) ? raw.garmentIds.filter((item): item is string => typeof item === 'string') : [],
      kept: raw.kept === true,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    }
  } catch {
    return { id, page: 'closet', garmentIds: [], kept: false, updatedAt: 0 }
  }
}

async function writeSourceMeta(root: string, meta: SourceMeta) {
  const dir = sourceDir(root, meta.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
}

async function listSources(root: string): Promise<SourceMeta[]> {
  const dir = join(root, 'files', 'sources')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const items: SourceMeta[] = []
  for (const id of names) {
    if (!isLibraryId(id)) continue
    items.push(await readSourceMeta(root, id))
  }
  return items
}

async function findSourceFile(root: string, id: string, name: string): Promise<{ type: string; bytes: Buffer } | null> {
  if (!isLibraryId(id) || !isSourceName(name)) return null
  const dir = sourceDir(root, id)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const filename = names.find((item) => item.startsWith(`${name}.`))
  if (!filename) return null
  const bytes = await readFile(join(dir, filename))
  return { type: imageType(bytes, ''), bytes }
}

async function putSourceFile(
  root: string,
  id: string,
  name: string,
  type: string,
  bytes: Buffer,
  extra: { page: 'closet' | 'tryon'; garmentIds?: string[] },
) {
  if (!isSourceName(name)) throw new Error('没有这种原片')
  if (bytes.length === 0) throw new Error('原片是空的')
  const dir = sourceDir(root, id)
  await mkdir(dir, { recursive: true })
  const filename = `${name}${extension(type)}`
  let existing: string[] = []
  try {
    existing = await readdir(dir)
  } catch {
    existing = []
  }
  for (const item of existing) {
    if (!item.startsWith(`${name}.`) || item === filename) continue
    await rm(join(dir, item), { force: true })
  }
  if (name === 'generated') await rm(join(dir, 'generated.mp4'), { force: true })
  await writeFile(join(dir, filename), bytes)
  const meta = await readSourceMeta(root, id)
  const fresh = meta.updatedAt === 0
  if (extra.garmentIds) {
    meta.page = extra.page
    meta.garmentIds = extra.garmentIds
  } else if (fresh && (name === 'real' || name === 'realVideo')) {
    meta.kept = true
  }
  meta.updatedAt = Date.now()
  await writeSourceMeta(root, meta)
}

async function dropSourceFile(root: string, id: string, name: string) {
  if (!isLibraryId(id) || !isSourceName(name)) throw new Error('编号不对')
  const dir = sourceDir(root, id)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const item of names) {
    if (item.startsWith(`${name}.`)) await rm(join(dir, item), { force: true })
  }
}

async function keepSource(root: string, id: string) {
  if (!isLibraryId(id)) throw new Error('编号不对')
  const meta = await readSourceMeta(root, id)
  meta.kept = true
  meta.updatedAt = Date.now()
  await writeSourceMeta(root, meta)
}

function extension(type: string): string {
  if (type === 'image/jpeg') return '.jpg'
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/gif') return '.gif'
  if (type === 'video/mp4') return '.mp4'
  return '.bin'
}

function folder(kind: LibraryKind): string {
  if (kind === 'garment') return 'garments'
  if (kind === 'look') return 'looks'
  return kind
}

function garmentStorageDir(record: Record<string, unknown> | undefined, id: string): string {
  const name = record && typeof record.name === 'string' ? record.name : ''
  return isGarmentDir(name) ? name : id
}

function blobRelative(kind: LibraryKind, id: string, filename: string, record?: Record<string, unknown>): string {
  if (kind === 'account' || kind === 'body') return `files/${kind}/${filename}`
  if (kind === 'garment') return `files/garments/${garmentStorageDir(record, id)}/${filename}`
  return `files/${folder(kind)}/${id}/${filename}`
}

async function removeEmptyParents(dirs: Set<string>, stop: string) {
  for (const dir of dirs) {
    let current = dirname(dir)
    while (current.startsWith(stop + sep)) {
      const left = await readdir(current).catch(() => ['kept'])
      if (left.length > 0) break
      await rm(current, { recursive: true, force: true })
      current = dirname(current)
    }
  }
}

function finite(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('衣橱记录读不了')
  return value
}

function emptyIndex(): LibraryIndex {
  return {
    version: 1,
    account: null,
    body: null,
    garments: {},
    looks: {},
    tombstones: { body: 0, garments: {}, looks: {} },
  }
}

function normalizeIndex(value: unknown): LibraryIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('衣橱目录读不了')
  const raw = value as Partial<LibraryIndex>
  const tomb = raw.tombstones
  return {
    version: 1,
    account: readStored(raw.account),
    body: readStored(raw.body),
    garments: readStoredMap(raw.garments),
    looks: readStoredMap(raw.looks),
    tombstones: {
      body: tomb && typeof tomb.body === 'number' ? tomb.body : 0,
      garments: numberMap(tomb?.garments),
      looks: numberMap(tomb?.looks),
    },
  }
}

function readStored(value: unknown): StoredRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<StoredRecord>
  if (typeof raw.savedAt !== 'number' || !raw.record || typeof raw.record !== 'object' || Array.isArray(raw.record)) return null
  const blobs: Record<string, BlobInfo> = {}
  if (raw.blobs && typeof raw.blobs === 'object' && !Array.isArray(raw.blobs)) {
    for (const [name, info] of Object.entries(raw.blobs)) {
      if (!info || typeof info !== 'object') continue
      const blob = info as Partial<BlobInfo>
      if (typeof blob.type !== 'string' || typeof blob.file !== 'string' || typeof blob.bytes !== 'number' || typeof blob.mark !== 'string') continue
      if (!isLibraryFile(blob.file)) continue
      blobs[name] = { type: blob.type, file: blob.file, bytes: blob.bytes, mark: blob.mark }
    }
  }
  return { savedAt: raw.savedAt, record: stripBlobs(raw.record), blobs }
}

function readStoredMap(value: unknown): Record<string, StoredRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const map: Record<string, StoredRecord> = {}
  for (const [id, item] of Object.entries(value)) {
    if (!isLibraryId(id)) continue
    const stored = readStored(item)
    if (stored) map[id] = stored
  }
  return map
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const map: Record<string, number> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isLibraryId(key) && typeof item === 'number' && Number.isFinite(item)) map[key] = item
  }
  return map
}

function storedOf(index: LibraryIndex, kind: LibraryKind, id: string): StoredRecord | null {
  if (kind === 'account') return index.account
  if (kind === 'body') return index.body
  if (kind === 'garment') return index.garments[id] ?? null
  return index.looks[id] ?? null
}

function assign(index: LibraryIndex, kind: LibraryKind, id: string, stored: StoredRecord | null) {
  if (kind === 'account') index.account = stored
  else if (kind === 'body') index.body = stored
  else if (kind === 'garment') {
    if (stored) index.garments[id] = stored
    else delete index.garments[id]
  } else if (stored) index.looks[id] = stored
  else delete index.looks[id]
}

function tombstone(index: LibraryIndex, kind: LibraryKind, id: string): number {
  if (kind === 'body') return index.tombstones.body
  if (kind === 'garment') return index.tombstones.garments[id] ?? 0
  if (kind === 'look') return index.tombstones.looks[id] ?? 0
  return 0
}

function setTombstone(index: LibraryIndex, kind: LibraryKind, id: string, savedAt: number) {
  if (kind === 'body') index.tombstones.body = savedAt
  else if (kind === 'garment') index.tombstones.garments[id] = savedAt
  else if (kind === 'look') index.tombstones.looks[id] = savedAt
}

function clearTombstone(index: LibraryIndex, kind: LibraryKind, id: string) {
  if (kind === 'body') index.tombstones.body = 0
  else if (kind === 'garment') delete index.tombstones.garments[id]
  else if (kind === 'look') delete index.tombstones.looks[id]
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendText(res: ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

function publicMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message && !message.includes('/') && !message.includes('\\')) return message
  return '本机文件夹没有写上'
}
