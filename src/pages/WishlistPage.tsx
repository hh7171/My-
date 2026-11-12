import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AdjustNote, BlobImg } from '../components.tsx'
import { blobToCanvas, compositeLook, dominantColor, isolateProductCutout, raiseSecondWrist, secondWristShift, stickerLayer, type StickerFrame } from '../imaging.ts'
import { addedOrder, garmentLabel, isClothingCategory, nextGarmentName, relocatedGarmentName } from '../garment-name.ts'
import { composeLookPoster } from '../look-board.tsx'
import { TagPicker } from '../tag-picker.tsx'
import { normalizeTag, uniqueTags } from '../tags.ts'
import { keepSource, latestOpenSource, readSource, writeSource } from '../source-files.ts'
import { maxGarments } from '../model-config.ts'
import { useWardrobe } from '../store.tsx'
import {
  ACCESSORY_ORDER,
  BODY_LABEL,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CLOTHING_ORDER,
  canMakeOutfit,
  dressConflicts,
  withoutDressConflict,
  SEASON_LABEL,
  SEASON_ORDER,
  stickerAligned,
  stickerCurrent,
  placedJewelry,
  stickerVersionFor,
  wristWearOrder,
  type Category,
  type Garment,
  type Season,
} from '../types.ts'
import { buildGarmentSticker, claimStickerJob, generateFlatLay, generateOutfitVideo, generateWearPhoto, nameGarment, releaseStickerJob, stickerJobBusy, wearError, type WearPiece } from '../wear.ts'

const stickerInflight = new Set<string>()
const STACK: Category[] = ['shoes', 'pants', 'skirt', 'dress', 'top', 'belt', 'scarf', 'necklace', 'earrings', 'jewelry', 'bracelet', 'watch', 'hat', 'glasses', 'bag']

type Shelf = Season | 'accessory'
type Nudge = { dx: number; dy: number; scale: number }
type StickerLayer = {
  id: string
  category: Category
  url: string
  frame: StickerFrame
  baseWidth: number
  baseHeight: number
  refit: boolean
}

function seasonOf(season: Season | undefined): Season {
  return season ?? 'summer'
}

function slotsFor(shelf: Shelf): Category[] {
  return shelf === 'accessory' ? ACCESSORY_ORDER : CLOTHING_ORDER
}

export function WishlistPage() {
  const { body, garments, looks, savedTags, addGarment, updateGarment, deleteGarment, addLook, updateLook, notify, setNav, rememberTag } = useWardrobe()
  const [picked, setPicked] = useState<Partial<Record<Category, string>>>({})
  const [pickOrder, setPickOrder] = useState<string[]>([])
  const [wristSaved, setWristSaved] = useState<Array<'watch' | 'bracelet'>>([])
  const [tryOn, setTryOn] = useState<Partial<Record<Category, string>>>({})
  const [covered, setCovered] = useState<Partial<Record<Category, string>>>({})
  const [stage, setStage] = useState(false)
  const [shelf, setShelf] = useState<Shelf>('summer')
  const [dragging, setDragging] = useState(false)
  const [dropSeason, setDropSeason] = useState<Season | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [pending, setPending] = useState<{ originalBlob: Blob; flatLay: boolean } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [result, setResult] = useState<Blob | null>(null)
  const [resultVideo, setResultVideo] = useState<Blob | null>(null)
  const [heldStill, setHeldStill] = useState<Blob | null>(null)
  const [filmStep, setFilmStep] = useState<'still' | 'video' | null>(null)
  const [sources, setSources] = useState<WearPiece[]>([])
  const [madeFrom, setMadeFrom] = useState<string[]>([])
  const [making, setMaking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wearProblem, setWearProblem] = useState('')
  const [note, setNote] = useState('')
  const [lookTags, setLookTags] = useState<string[]>([])
  const [tagEpoch, setTagEpoch] = useState(0)
  const tagInput = useRef('')
  const [preview, setPreview] = useState<Blob | null>(null)
  const [sticking, setSticking] = useState<string | null>(null)
  const [stickerError, setStickerError] = useState<{ id: string; text: string } | null>(null)
  const [layers, setLayers] = useState<StickerLayer[]>([])
  const [nudges, setNudges] = useState<Record<string, Nudge>>({})
  const [activeSticker, setActiveSticker] = useState<string | null>(null)
  const bodyRef = useRef(body)
  const garmentsRef = useRef(garments)
  const queueRef = useRef<Garment[]>([])
  const runningRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const layerUrls = useRef<string[]>([])
  const nudgesRef = useRef(nudges)
  const saveTimer = useRef(0)
  const cardDragged = useRef(false)
  const draftId = useRef<string | null>(null)
  const chipDropped = useRef(false)
  const resultRef = useRef<HTMLElement>(null)
  nudgesRef.current = nudges
  bodyRef.current = body
  garmentsRef.current = garments

  const wished = garments.filter((item) => item.status === 'wishlist')
  const wishedVisible =
    shelf === 'accessory'
      ? wished.filter((item) => ACCESSORY_ORDER.includes(item.category))
      : wished.filter((item) => CLOTHING_ORDER.includes(item.category) && seasonOf(item.season) === shelf)
  const owned = garments.filter((item) => item.status === 'owned')
  const selected = CATEGORY_ORDER.flatMap((slot) => {
    const item = wished.find((garment) => garment.id === picked[slot] && garment.category === slot)
    return item ? [item] : []
  })
  const worn = stage
    ? CATEGORY_ORDER.flatMap((slot) => {
        const coverId = covered[slot]
        const pool = coverId ? owned : wished
        const id = coverId ?? tryOn[slot]
        const item = pool.find((garment) => garment.id === id && garment.category === slot)
        return item ? [item] : []
      })
    : []
  useEffect(() => {
    let cancel = false
    void (async () => {
      const draft = await latestOpenSource('tryon')
      if (!draft || cancel) return
      const still = await readSource(draft.id, 'generated')
      if (!still || cancel) return
      draftId.current = draft.id
      setMadeFrom(draft.garmentIds)
      const pieces = draft.garmentIds.flatMap((id) => {
        const item = garmentsRef.current.find((garment) => garment.id === id)
        return item ? [{ role: item.category, name: item.name, blob: item.cutoutBlob }] : []
      })
      setSources(pieces)
      const video = await readSource(draft.id, 'video')
      if (cancel) return
      setResult(still)
      setResultVideo(video)
      setHeldStill(video ? null : still)
      setStage(true)
    })()
    return () => {
      cancel = true
    }
  }, [])

  const currentIds = worn.map((item) => item.id)
  const sameOutfit = currentIds.length === madeFrom.length && currentIds.every((id, index) => id === madeFrom[index])
  const outfitReady = canMakeOutfit(worn.map((item) => item.category))
  const canGenerate = Boolean(
    stage &&
      body?.person &&
      outfitReady &&
      worn.length <= maxGarments() &&
      !making &&
      worn.every((item) => stickerAligned(item, body.updatedAt)),
  )
  const slots = slotsFor(shelf)
  const visible =
    shelf === 'accessory'
      ? owned.filter((item) => ACCESSORY_ORDER.includes(item.category))
      : owned.filter((item) => CLOTHING_ORDER.includes(item.category) && seasonOf(item.season) === shelf)
  const onBody = stage ? worn : selected
  const stickerKey = onBody
    .filter((item) => body?.person && stickerAligned(item, body.updatedAt) && item.stickerBlob)
    .map((item) => {
      const frame = item.stickerFrame
      const box = frame ? `${frame.x}:${frame.y}:${frame.width}:${frame.height}` : 'fit'
      return `${item.id}:${item.stickerVer ?? 0}:${item.stickerBlob?.size ?? 0}:${box}`
    })
    .join('|')
  const placeKey = onBody
    .map((item) => {
      const place = item.stickerPlace
      return place ? `${item.id}:${place.dx}:${place.dy}:${place.scale}` : item.id
    })
    .join('|')
  const pendingStickers = body?.person
    ? onBody.filter((item) => !stickerAligned(item, body.updatedAt)).length
    : 0
  const stickerErrorText =
    stickerError && !(body?.person && garments.some((item) => item.id === stickerError.id && stickerCurrent(item, body.updatedAt)))
      ? stickerError.text
      : ''
  const onBodyKey = onBody.map((item) => item.id).join('|')

  useEffect(() => {
    const ids = onBodyKey ? onBodyKey.split('|') : []
    setPickOrder((current) => {
      const kept = current.filter((id) => ids.includes(id))
      const added = ids.filter((id) => !kept.includes(id))
      const next = [...kept, ...added]
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current
      return next
    })
  }, [onBodyKey])

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [result])

  useEffect(() => {
    if (!body || body.person) {
      setPreview(null)
      return
    }
    const items = onBody.map((item) => ({ category: item.category, blob: item.cutoutBlob }))
    if (items.length === 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    void compositeLook(body.imageBlob, body.marks, items, { person: false })
      .then((blob) => {
        if (!cancelled) setPreview(blob)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [body, onBodyKey])

  useEffect(() => {
    setNudges((current) => {
      let changed = false
      const next = { ...current }
      for (const item of garmentsRef.current) {
        if (next[item.id] || !item.stickerPlace) continue
        next[item.id] = item.stickerPlace
        changed = true
      }
      if (!changed) return current
      nudgesRef.current = next
      return next
    })
  }, [placeKey])

  useEffect(() => {
    if (!body?.person) {
      setLayers([])
      return
    }
    const showing = onBody.filter((item) => stickerAligned(item, body.updatedAt))
    let cancelled = false
    const created: string[] = []
    void (async () => {
      const next: StickerLayer[] = []
      for (const item of showing) {
        try {
          const laid = await stickerLayer(body.imageBlob, body.marks, item.stickerBlob!, item.category, item.stickerFrame, item.cutoutBlob)
          const url = URL.createObjectURL(laid.png)
          created.push(url)
          if (laid.refit) {
            const place = { dx: 0, dy: 0, scale: 1 }
            nudgesRef.current = { ...nudgesRef.current, [item.id]: place }
            setNudges(nudgesRef.current)
            if (laid.store) {
              void updateGarment(item.id, {
                stickerBlob: laid.png,
                stickerFrame: laid.frame,
                stickerPlace: place,
                ...(item.stickerFor == null ? { stickerFor: body.updatedAt } : {}),
              })
            }
          }
          next.push({
            id: item.id,
            category: item.category,
            url,
            frame: laid.frame,
            baseWidth: laid.baseWidth,
            baseHeight: laid.baseHeight,
            refit: laid.refit,
          })
        } catch {
          /* 这一件贴纸读不出来时，其余仍贴在身上 */
        }
      }
      next.sort((a, b) => STACK.indexOf(a.category) - STACK.indexOf(b.category))
      if (cancelled) {
        created.forEach((url) => URL.revokeObjectURL(url))
        return
      }
      layerUrls.current.forEach((url) => URL.revokeObjectURL(url))
      layerUrls.current = created
      setLayers(next)
    })()
    return () => {
      cancelled = true
    }
  }, [stickerKey, body])

  useEffect(() => {
    setActiveSticker((current) => (current && layers.some((layer) => layer.id === current) ? current : null))
  }, [layers])

  useEffect(() => {
    if (!activeSticker) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.sticker-layer, .sticker-tools, .sticker-handle')) return
      setActiveSticker(null)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [activeSticker])

  useEffect(
    () => () => {
      layerUrls.current.forEach((url) => URL.revokeObjectURL(url))
      layerUrls.current = []
      window.clearTimeout(saveTimer.current)
    },
    [],
  )

  function applyNudge(id: string, place: Nudge, persist: boolean) {
    const next = { ...nudgesRef.current, [id]: place }
    nudgesRef.current = next
    setNudges(next)
    if (!persist) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void updateGarment(id, { stickerPlace: place })
    }, 160)
  }

  function nudgeOf(id: string): Nudge {
    return nudges[id] ?? { dx: 0, dy: 0, scale: 1 }
  }

  function startMove(event: React.PointerEvent<HTMLDivElement>, id: string) {
    if ((event.target as HTMLElement).closest('.sticker-handle')) return
    event.preventDefault()
    const layer = layers.find((item) => item.id === id)
    const board = stageRef.current
    if (!layer || !board) return
    setActiveSticker(id)
    const pointer = event.currentTarget
    try {
      pointer.setPointerCapture(event.pointerId)
    } catch {
      /* 指针捕获失败时，仍由窗口上的移动事件继续跟踪 */
    }
    const start = nudgesRef.current[id] ?? { dx: 0, dy: 0, scale: 1 }
    const originX = event.clientX
    const originY = event.clientY
    const rect = board.getBoundingClientRect()
    const pxX = layer.baseWidth / rect.width
    const pxY = layer.baseHeight / rect.height
    const onMove = (ev: PointerEvent) => {
      applyNudge(
        id,
        {
          dx: start.dx + (ev.clientX - originX) * pxX,
          dy: start.dy + (ev.clientY - originY) * pxY,
          scale: start.scale,
        },
        false,
      )
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const place = nudgesRef.current[id]
      if (place) applyNudge(id, place, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function startScale(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault()
    event.stopPropagation()
    const layer = layers.find((item) => item.id === id)
    const board = stageRef.current
    if (!layer || !board) return
    setActiveSticker(id)
    const pointer = event.currentTarget
    try {
      pointer.setPointerCapture(event.pointerId)
    } catch {
      /* 指针捕获失败时，仍由窗口上的移动事件继续跟踪 */
    }
    const start = nudgesRef.current[id] ?? { dx: 0, dy: 0, scale: 1 }
    const originX = event.clientX
    const rect = board.getBoundingClientRect()
    const pxX = layer.baseWidth / rect.width
    const startW = layer.frame.width * start.scale
    const onMove = (ev: PointerEvent) => {
      const nextW = Math.max(24, startW + (ev.clientX - originX) * pxX)
      const scale = Math.min(2.8, Math.max(0.35, nextW / layer.frame.width))
      applyNudge(id, { dx: start.dx, dy: start.dy, scale }, false)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const place = nudgesRef.current[id]
      if (place) applyNudge(id, place, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function scaleActive(scale: number) {
    if (!activeSticker) return
    const layer = layers.find((item) => item.id === activeSticker)
    const current = nudgesRef.current[activeSticker] ?? { dx: 0, dy: 0, scale: 1 }
    if (!layer) {
      applyNudge(activeSticker, { ...current, scale }, true)
      return
    }
    const cx = layer.frame.x + current.dx + (layer.frame.width * current.scale) / 2
    const cy = layer.frame.y + current.dy + (layer.frame.height * current.scale) / 2
    applyNudge(
      activeSticker,
      {
        dx: cx - (layer.frame.width * scale) / 2 - layer.frame.x,
        dy: cy - (layer.frame.height * scale) / 2 - layer.frame.y,
        scale,
      },
      true,
    )
  }

  function enqueueSticker(item: Garment, manual = false) {
    const profile = bodyRef.current
    if (item.category === 'jewelry') return
    if (!profile?.person) return
    if (stickerCurrent(item, profile.updatedAt)) return
    if (!manual && item.stickerBlob && !placedJewelry(item.category)) return
    if (stickerJobBusy(item.id) || stickerInflight.has(item.id) || queueRef.current.some((queued) => queued.id === item.id)) return
    queueRef.current.push(item)
    void drainStickers()
  }

  async function drainStickers() {
    if (runningRef.current) return
    runningRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift()
        if (!next) break
        const profile = bodyRef.current
        if (!profile?.person || stickerInflight.has(next.id) || !claimStickerJob(next.id)) continue
        const latest = garmentsRef.current.find((garment) => garment.id === next.id) ?? next
        if (stickerCurrent(latest, profile.updatedAt)) {
          releaseStickerJob(next.id)
          continue
        }
        stickerInflight.add(latest.id)
        setSticking(latest.id)
        setStickerError((current) => (current?.id === latest.id ? null : current))
        try {
          const wornSticker = await buildGarmentSticker({
            bodyBlob: profile.imageBlob,
            productBlob: latest.cutoutBlob,
            category: latest.category,
            name: latest.name,
            marks: profile.marks,
          })
          const place = { dx: 0, dy: 0, scale: 1 }
          nudgesRef.current = { ...nudgesRef.current, [latest.id]: place }
          setNudges(nudgesRef.current)
          await updateGarment(latest.id, {
            stickerBlob: wornSticker.stickerBlob,
            stickerFrame: wornSticker.stickerFrame,
            stickerFor: profile.updatedAt,
            stickerVer: stickerVersionFor(latest.category),
            stickerPlace: place,
          })
          setStickerError((current) => (current?.id === latest.id ? null : current))
        } catch (cause) {
          const saved = garmentsRef.current.find((garment) => garment.id === latest.id)
          const profileNow = bodyRef.current
          if (saved && profileNow?.person && stickerCurrent(saved, profileNow.updatedAt)) {
            setStickerError((current) => (current?.id === latest.id ? null : current))
          } else {
            setStickerError({ id: latest.id, text: `${garmentLabel(latest.name, latest.title)}：${wearError(cause)}` })
          }
        } finally {
          releaseStickerJob(latest.id)
          stickerInflight.delete(latest.id)
          setSticking(null)
        }
      }
    } finally {
      runningRef.current = false
    }
  }

  function stickerReady(item: Garment): boolean {
    return Boolean(body?.person && stickerCurrent(item, body.updatedAt))
  }

  function toggleWish(item: Garment) {
    if (cardDragged.current) return
    const on = picked[item.category] === item.id
    if (!on) enqueueSticker(item)
    setPicked((current) => {
      const base = on ? current : withoutDressConflict(current, item.category)
      return { ...base, [item.category]: on ? undefined : item.id }
    })
  }

  function toggleOwned(item: Garment) {
    const selectedCover = covered[item.category] === item.id
    if (!selectedCover) enqueueSticker(item)
    const clashes = dressConflicts(item.category)
    if (!selectedCover && clashes.length > 0) {
      setTryOn((current) => {
        const next = { ...current }
        for (const slot of clashes) next[slot] = undefined
        return next
      })
    }
    setCovered((current) => {
      const base = selectedCover ? current : withoutDressConflict(current, item.category)
      return { ...base, [item.category]: selectedCover ? undefined : item.id }
    })
  }

  function beginDrag(event: DragEvent, item: Garment) {
    if (!isClothingCategory(item.category) || shelf === 'accessory') return
    cardDragged.current = true
    setDragging(true)
    event.dataTransfer.setData('text/plain', item.id)
    event.dataTransfer.effectAllowed = 'move'
  }

  function endDrag() {
    setDragging(false)
    setDropSeason(null)
    window.setTimeout(() => {
      cardDragged.current = false
    }, 80)
  }

  async function moveToSeason(id: string, season: Season) {
    const item = garmentsRef.current.find((garment) => garment.id === id && garment.status === 'wishlist')
    if (!item) return
    const name = relocatedGarmentName(garmentsRef.current, item, season)
    if (!name) return
    const moved = await updateGarment(item.id, { name, season })
    if (!moved) return
    setPicked((current) => (current[item.category] === item.id ? { ...current, [item.category]: undefined } : current))
    setTryOn((current) => (current[item.category] === item.id ? { ...current, [item.category]: undefined } : current))
    const sameNumber = garmentLabel(item.name, item.title) === garmentLabel(moved.name, moved.title)
    notify(sameNumber ? `已放到${SEASON_LABEL[season]}` : `已放到${SEASON_LABEL[season]}，编号改为 ${garmentLabel(moved.name, moved.title)}`)
  }

  function begin() {
    if (!body || selected.length === 0) return
    setTryOn({ ...picked })
    setCovered({})
    setResult(null)
    setResultVideo(null)
    setHeldStill(null)
    setSources([])
    setMadeFrom([])
    setWearProblem('')
    setStickerError(null)
    setStage(true)
    for (const item of selected) enqueueSticker(item)
  }

  function leave() {
    setStage(false)
    setCovered({})
    setResult(null)
    setResultVideo(null)
    setHeldStill(null)
    setSources([])
    setMadeFrom([])
    setWearProblem('')
    setNote('')
  }

  function takeFile(file: File) {
    setUploadError('')
    setPending({ originalBlob: file, flatLay: false })
  }

  function cancelUpload() {
    setPending(null)
    setName('')
    setUploadError('')
  }

  async function commit() {
    if (!pending || preparing) return
    const label = name.trim() || CATEGORY_LABEL[category]
    setPreparing(true)
    setUploadError('')
    const titlePromise = nameGarment({ category, blob: pending.originalBlob })
    try {
      const flat = pending.flatLay ? pending.originalBlob : await generateFlatLay({ category, name: label, blob: pending.originalBlob })
      const product = await isolateProductCutout(flat, category)
      const color = dominantColor(await blobToCanvas(product))
      const clothing = isClothingCategory(category)
      const season = clothing ? (shelf === 'accessory' ? 'summer' : shelf) : undefined
      const title = await titlePromise
      await addGarment({
        name: nextGarmentName(garments, 'wishlist', category, season),
        ...(title ? { title } : {}),
        category,
        ...(season ? { season } : {}),
        status: 'wishlist',
        cutoutBlob: product,
        originalBlob: pending.originalBlob,
        color,
      })
      setPending(null)
      setName('')
      notify('已放进想买')
    } catch (cause) {
      setUploadError(wearError(cause))
    } finally {
      setPreparing(false)
    }
  }

  async function own(item: Garment) {
    const clothing = isClothingCategory(item.category)
    const season = clothing ? (item.season ?? 'summer') : undefined
    const moved = await updateGarment(item.id, {
      status: 'owned',
      name: nextGarmentName(garments, 'owned', item.category, season),
      ...(clothing && !item.season ? { season: 'summer' } : {}),
    })
    const nextId = moved?.id ?? item.id
    setPicked((current) => ({ ...current, [item.category]: current[item.category] === item.id ? undefined : current[item.category] }))
    if (stage && tryOn[item.category] === item.id) {
      setTryOn((current) => {
        const next = withoutDressConflict(current, item.category)
        next[item.category] = undefined
        return next
      })
      setCovered((current) => ({ ...withoutDressConflict(current, item.category), [item.category]: nextId }))
    }
    const ownedIds = new Set(garments.filter((garment) => garment.status === 'owned' && garment.id !== item.id).map((garment) => garment.id))
    ownedIds.add(nextId)
    const finished = looks.filter(
      (look) => look.mode === 'tryon' && look.garmentIds.length > 0 && look.garmentIds.every((id) => ownedIds.has(id)),
    )
    for (const look of finished) await updateLook(look.id, { mode: 'closet' })
    if (finished.length === 0) {
      notify('已转入衣橱')
      return
    }
    const lines = finished.map((look) => {
      const names = look.garmentIds
        .map((id) => {
          if (id === item.id && moved) return garmentLabel(moved.name, moved.title)
          const found = garments.find((garment) => garment.id === id)
          return found ? garmentLabel(found.name, found.title) : ''
        })
        .filter((name) => name.length > 0)
      return names.length > 0 ? names.join('、') : '这套'
    })
    notify(`${lines.join('；')}已经全部拥有，试穿穿搭归入日常穿搭`)
  }

  async function remove(id: string, itemName: string) {
    if (!window.confirm(`从想买里移除「${itemName}」？`)) return
    await deleteGarment(id)
    setPicked((current) => {
      const next = { ...current }
      for (const slot of CATEGORY_ORDER) {
        if (next[slot] === id) next[slot] = undefined
      }
      return next
    })
    setTryOn((current) => {
      const next = { ...current }
      for (const slot of CATEGORY_ORDER) {
        if (next[slot] === id) next[slot] = undefined
      }
      return next
    })
  }

  async function generate() {
    if (!body?.person || !outfitReady || worn.length > maxGarments()) return
    const pieces: WearPiece[] = worn.flatMap((item) =>
      item.stickerBlob && stickerAligned(item, body.updatedAt)
        ? [{ role: item.category, name: item.name, blob: item.cutoutBlob }]
        : [],
    )
    if (pieces.length !== worn.length) {
      setWearProblem('先把这套衣服的贴合图层做完，再生成全身效果。')
      return
    }
    const wristOrder = wristWearOrder(worn, pickOrder)
    setWristSaved(wristOrder)
    setMaking(true)
    setWearProblem('')
    setHeldStill(null)
    setLookTags([])
    tagInput.current = ''
    setTagEpoch((epoch) => epoch + 1)
    setSources(pieces)
    setFilmStep('still')
    try {
      const image = await generateWearPhoto({
        bodyBlob: body.imageBlob,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        bodyLabel: BODY_LABEL[body.bodyType],
        person: Boolean(body.person),
        pieces,
        ...(wristOrder.length === 2 ? { wristOrder } : {}),
      })
      setMadeFrom(currentIds)
      const id = draftId.current ?? crypto.randomUUID()
      draftId.current = id
      try {
        await writeSource(id, 'generated', image, { page: 'tryon', garmentIds: currentIds })
      } catch (cause) {
        setResult(image)
        setResultVideo(null)
        setHeldStill(image)
        setWearProblem(`${wearError(cause)} 全身照可以先看、先保存，也可以再试一次视频。`)
        return
      }
      setFilmStep('video')
      try {
        const video = await generateOutfitVideo(image)
        await writeSource(id, 'video', video)
        setResult(image)
        setResultVideo(video)
        setHeldStill(null)
      } catch (cause) {
        setResult(image)
        setResultVideo(null)
        setHeldStill(image)
        setWearProblem(`${wearError(cause)} 全身照可以先看、先保存，也可以再试一次视频。`)
      }
    } catch (cause) {
      setWearProblem(wearError(cause))
    } finally {
      setMaking(false)
      setFilmStep(null)
    }
  }

  async function retryVideo() {
    if (!heldStill || making) return
    setMaking(true)
    setWearProblem('')
    setFilmStep('video')
    try {
      const id = draftId.current ?? crypto.randomUUID()
      draftId.current = id
      await writeSource(id, 'generated', heldStill, { page: 'tryon', garmentIds: madeFrom })
      const video = await generateOutfitVideo(heldStill)
      await writeSource(id, 'video', video)
      setResult(heldStill)
      setResultVideo(video)
      setHeldStill(null)
    } catch (cause) {
      setResult(heldStill)
      setResultVideo(null)
      setWearProblem(`${wearError(cause)} 全身照可以先看、先保存，也可以再试一次视频。`)
    } finally {
      setMaking(false)
      setFilmStep(null)
    }
  }

  async function revise() {
    const instruction = note.trim()
    if (!body || !result || sources.length === 0 || !instruction) return
    setMaking(true)
    setWearProblem('')
    setFilmStep('still')
    try {
      const image = await generateWearPhoto({
        bodyBlob: body.imageBlob,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        bodyLabel: BODY_LABEL[body.bodyType],
        person: Boolean(body.person),
        pieces: sources,
        adjust: instruction,
        ...(wristSaved.length === 2 ? { wristOrder: wristSaved } : {}),
      })
      const id = draftId.current ?? crypto.randomUUID()
      draftId.current = id
      await writeSource(id, 'generated', image, { page: 'tryon', garmentIds: madeFrom })
      setFilmStep('video')
      try {
        const video = await generateOutfitVideo(image)
        await writeSource(id, 'video', video)
        setResult(image)
        setResultVideo(video)
        setHeldStill(null)
      } catch (cause) {
        setResult(image)
        setResultVideo(null)
        setHeldStill(image)
        setWearProblem(`${wearError(cause)} 新的全身照可以先看、先保存，也可以再试一次视频。`)
      }
    } catch (cause) {
      setWearProblem(wearError(cause))
    } finally {
      setMaking(false)
      setFilmStep(null)
    }
  }

  async function save() {
    if (!result || madeFrom.length === 0 || saving) return
    setSaving(true)
    try {
      const pieces = sources.map((piece) => ({ key: `${piece.role}-${piece.name}`, blob: piece.blob }))
      const poster = pieces.length > 0 ? await composeLookPoster({ photo: result, pieces }) : result
      const id = draftId.current ?? crypto.randomUUID()
      const typed = normalizeTag(tagInput.current)
      const tags = uniqueTags(typed ? [...lookTags, typed] : lookTags)
      for (const tag of tags) await rememberTag(tag)
      await addLook({ id, mode: 'tryon', garmentIds: madeFrom, imageBlob: poster, ...(resultVideo ? { videoBlob: resultVideo } : {}), ...(tags.length > 0 ? { tags } : {}) })
      setLookTags([])
      tagInput.current = ''
      await keepSource(id)
      draftId.current = null
      notify('已保存这次试穿')
    } catch {
      notify('这次试穿这次没存下来')
    } finally {
      setSaving(false)
    }
  }

  const stackedLayers = raiseSecondWrist(
    [...layers].sort((a, b) => STACK.indexOf(a.category) - STACK.indexOf(b.category)),
    pickOrder,
  )
  const wristShift =
    body && layers.length > 0
      ? secondWristShift(
          layers,
          pickOrder,
          (id) => {
            const layer = layers.find((item) => item.id === id)
            if (!layer || layer.refit) return 1
            return (nudges[id] ?? { dx: 0, dy: 0, scale: 1 }).scale
          },
          body.marks,
          layers[0].baseWidth,
          layers[0].baseHeight,
        )
      : null
  let mixHint = '点左边衣橱里的衣服，会用已经做好的贴合图层盖到个人模特上。同一类再点一次，就露出试穿的那件。'
  if (!body) mixHint = '先建立身形，衣服才能穿到个人模特上。'
  else if (!body.person) mixHint = '当前是比例参考。贴合图层和全身效果都要用带本人脸的个人模特。'
  else if (sticking) {
    const working = garments.find((item) => item.id === sticking)
    mixHint = working && placedJewelry(working.category) ? '正在按这个模特记好的佩戴位置生成贴纸，不调用模型。' : '正在按这个人的肩、腰、手脚生成这一件的透明图层。这一件用一张额度。'
  }
  else if (worn.length > maxGarments()) mixHint = `一次最多搭配 ${maxGarments()} 件，先拿下几件。`
  else if (!outfitReady) mixHint = '点上一件上衣，再点裤子或裙子，就可以生成全身照。裤子和裙子只能选一个。连衣裙相当于上衣加裤子，不能和上衣、裤子或裙子一起选。缺的可以从左边衣橱点上。'
  else if (result && !sameOutfit) mixHint = '身上的单品已经换了。再点搭配，才会生成新的全身照。'
  else mixHint = '这是贴合图层盖在个人模特上的预览。全身效果再点搭配。'

  let pickHint = '点左边还没买的单品。有贴合图层的会直接盖到个人模特上。'
  if (!body) pickHint = '还没有基准图。可以先把衣服放进想买，建立身形之后再试穿。'
  else if (!body.person) pickHint = '当前是比例参考。点选会盖到基准图上。贴合图层要等带本人脸的个人模特。'
  else if (selected.length === 0) pickHint = '点左边还没买的单品。有贴合图层的会直接盖到个人模特上。每一类只留一件。'
  else if (sticking) {
    const working = garments.find((item) => item.id === sticking)
    pickHint = working && placedJewelry(working.category) ? '正在按这个模特记好的佩戴位置生成贴纸，不调用模型。' : '正在按这个人的肩、腰、手脚生成这一件的透明图层。这一件用一张额度。'
  } else if (pendingStickers > 0) {
    const paid = onBody.some((item) => body && !stickerAligned(item, body.updatedAt) && !placedJewelry(item.category))
    pickHint = paid
      ? `选中的衣服里还有 ${pendingStickers} 件没有贴合图层。点「做成贴合图层」才会生成，一件用一张额度。已经做好的直接贴上。`
      : '选中的首饰还没摆到身上。点「摆到身上」，不调用模型。已经摆好的直接贴上。'
  }
  else pickHint = '贴合图层已经盖在个人模特上。可以拖动。点试穿后可以换成衣橱里的衣服，再生成全身照。'

  return (
    <div className="closet">
      <div className="closet-bar">
        <div>
          <p className="kicker">还没买</p>
          <h1>想买</h1>
        </div>
        {stage ? (
          <button type="button" className="ghost" onClick={leave}>
            返回选衣服
          </button>
        ) : (
          <label className="upload-mini">
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void takeFile(file)
              }}
            />
            {preparing ? '正在整理…' : '上传单品照片'}
          </label>
        )}
      </div>

      {stage ? (
        <div className="season-bar">
          <div className="chips">
            {SEASON_ORDER.map((item) => (
              <button
                key={item}
                type="button"
                className={shelf === item ? 'chip selected' : 'chip'}
                onClick={() => setShelf(item)}
              >
                {SEASON_LABEL[item]}
              </button>
            ))}
            <button type="button" className={shelf === 'accessory' ? 'chip selected' : 'chip'} onClick={() => setShelf('accessory')}>
              配饰
            </button>
          </div>
          <span className="count">{visible.length} 件</span>
        </div>
      ) : (
        <>
          <p className="lede">这些衣服还不是你的，不会出现在衣橱的日常搭配里。买回来之后再转入衣橱。</p>
          <div className="season-bar">
            <div className="chips">
              {SEASON_ORDER.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={['chip', shelf === item ? 'selected' : '', dragging && shelf !== item ? 'drop-target' : '', dropSeason === item ? 'drop-over' : ''].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (chipDropped.current) return
                    setShelf(item)
                  }}
                  onDragOver={(event) => {
                    if (!dragging || shelf === item) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropSeason(item)
                  }}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget
                    if (next instanceof Node && event.currentTarget.contains(next)) return
                    setDropSeason((current) => (current === item ? null : current))
                  }}
                  onDrop={(event) => {
                    if (!dragging || shelf === item) return
                    event.preventDefault()
                    chipDropped.current = true
                    const id = event.dataTransfer.getData('text/plain')
                    setDropSeason(null)
                    setDragging(false)
                    window.setTimeout(() => {
                      chipDropped.current = false
                    }, 80)
                    void moveToSeason(id, item)
                  }}
                >
                  {SEASON_LABEL[item]}
                </button>
              ))}
              <button type="button" className={shelf === 'accessory' ? 'chip selected' : 'chip'} onClick={() => setShelf('accessory')}>
                配饰
              </button>
            </div>
            <span className="count">{wishedVisible.length} 件</span>
          </div>
        </>
      )}
      <p className="hint">贴纸固定叫 sticker.png，和这件单品放在同一个文件夹里。有这个文件就直接贴上身。</p>

      {!stage && pending ? (
        <div className="pending closet-pending">
          <BlobImg blob={pending.originalBlob} alt="待放入的衣服" className="pending-thumb" />
          <label>
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="可不填。只用来提醒白底图留哪一件，卡片上的名字会看着照片另起" />
          </label>
          <label>
            类别
            <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
              {CATEGORY_ORDER.filter((slot) => slot !== 'jewelry').map((slot) => (
                <option key={slot} value={slot}>
                  {CATEGORY_LABEL[slot]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <label className="flat-check">
              <input
                type="checkbox"
                checked={pending.flatLay}
                onChange={(event) => setPending({ ...pending, flatLay: event.target.checked })}
              />
              这张已经是白底平铺
            </label>
            <p className="hint">
              {pending.flatLay
                ? placedJewelry(category)
                  ? '保存时直接用这张图，不再调用模型。点选后按脖子、耳朵或手腕摆上去，也不调用上身模型。'
                  : '保存时直接用这张图，不再调用模型。点选后可以按个人模特生成贴合图层。'
                : placedJewelry(category)
                  ? '穿着拍或商品图会整理成白底平铺，用一张额度。点选后直接摆到身上，不再调用上身模型。'
                  : '穿着拍、衣服单拍或网店上身图都会整理成白底平铺，用一张额度。贴合图层在点选或点「做成贴合图层」时再生成。'}
            </p>
            {uploadError ? <p className="error">{uploadError}</p> : null}
            <div className="pending-actions">
              <button type="button" className="primary" onClick={() => void commit()} disabled={preparing}>
                {preparing ? (pending.flatLay ? '正在起名并保存…' : '正在整理成白底平铺并起名…') : '放进想买'}
              </button>
              <button type="button" className="ghost" onClick={cancelUpload}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : !stage && uploadError ? (
        <p className="error">{uploadError}</p>
      ) : null}

      <div className="closet-work">
        <div className="stage-list">
          {stage
            ? visible.length === 0 ? (
                <p className="rail-empty">{shelf === 'accessory' ? '还没有配饰' : '这一季还没有衣服'}</p>
              ) : slots.map((slot) => {
                const items = addedOrder(visible.filter((item) => item.category === slot))
                if (items.length === 0) return null
                return (
                  <section key={slot} className="rail">
                    <h2>{CATEGORY_LABEL[slot]}</h2>
                    <div className="rail-track">
                        {items.map((item) => {
                          const on = covered[item.category] === item.id
                          return (
                            <article key={item.id} className={on ? 'card rail-card picked' : 'card rail-card'}>
                              <button type="button" className="rail-pick" aria-pressed={on} onClick={() => toggleOwned(item)}>
                                <BlobImg blob={item.cutoutBlob} alt={garmentLabel(item.name, item.title)} className="thumb" />
                                {on ? <span className="picked-mark">已盖上</span> : null}
                                <span className="card-meta">
                                  <span className="swatch" style={{ background: item.color }} />
                                  <span>
                                    <strong>{garmentLabel(item.name, item.title)}</strong>
                                  </span>
                                </span>
                              </button>
                            </article>
                          )
                        })}
                    </div>
                  </section>
                )
              })
            : wished.length === 0 ? (
                <div className="placeholder">
                  <p>还没有想买的衣服。</p>
                  <p className="hint">上传一件还没买的单品，选中后再试穿。</p>
                </div>
              ) : wishedVisible.length === 0 ? (
                <p className="rail-empty">{shelf === 'accessory' ? '还没有配饰' : '这一季还没有衣服'}</p>
              ) : (
                slots.map((slot) => {
                  const items = addedOrder(wishedVisible.filter((item) => item.category === slot))
                  if (items.length === 0) return null
                  return (
                    <section key={slot} className="rail">
                      <h2>{CATEGORY_LABEL[slot]}</h2>
                      <div className="rail-track">
                          {items.map((item) => {
                            const on = picked[item.category] === item.id
                            const clothing = shelf !== 'accessory' && isClothingCategory(item.category)
                            return (
                              <article key={item.id} className={on ? 'card rail-card picked' : 'card rail-card'}>
                                <button
                                  type="button"
                                  className="rail-pick"
                                  aria-pressed={on}
                                  draggable={clothing}
                                  title={clothing ? `拖到其他季节，仍是${CATEGORY_LABEL[item.category]}` : undefined}
                                  onDragStart={(event) => beginDrag(event, item)}
                                  onDragEnd={endDrag}
                                  onClick={() => toggleWish(item)}
                                >
                                  <BlobImg blob={item.cutoutBlob} alt={garmentLabel(item.name, item.title)} className="thumb" />
                                  {on ? <span className="picked-mark">已选</span> : null}
                                  <span className="card-meta">
                                    <span className="swatch" style={{ background: item.color }} />
                                    <span>
                                      <strong>{garmentLabel(item.name, item.title)}</strong>
                                    </span>
                                  </span>
                                </button>
                                <div className="card-actions">
                                  {body?.person && item.category !== 'jewelry' && !stickerReady(item) ? (
                                    <button
                                      type="button"
                                      className="text-button"
                                      disabled={sticking === item.id}
                                      onClick={() => enqueueSticker(item, true)}
                                    >
                                      {sticking === item.id
                                        ? placedJewelry(item.category)
                                          ? '正在摆放…'
                                          : '正在生成…'
                                        : placedJewelry(item.category)
                                          ? item.stickerBlob
                                            ? '重新摆放'
                                            : '摆到身上'
                                          : item.stickerBlob
                                            ? '重做贴合图层'
                                            : '做成贴合图层'}
                                    </button>
                                  ) : null}
                                  <button type="button" className="text-button" onClick={() => void own(item)}>
                                    我买了
                                  </button>
                                  <button type="button" className="text-button" onClick={() => void remove(item.id, garmentLabel(item.name, item.title))}>
                                    移除
                                  </button>
                                </div>
                              </article>
                            )
                          })}
                      </div>
                    </section>
                  )
                })
              )}
        </div>

        <aside className="doll-panel">
          {body ? (
            <>
              <figure className="doll-figure">
                {layers.length > 0 ? (
                  <div className="doll-stage" ref={stageRef}>
                    <BlobImg blob={body.imageBlob} alt="基准图" className="base-photo" />
                    {stackedLayers.map((layer, index) => {
                      const nudge = layer.refit ? { dx: 0, dy: 0, scale: 1 } : nudgeOf(layer.id)
                      const lift = wristShift?.id === layer.id ? wristShift : null
                      const active = layer.id === activeSticker
                      return (
                        <div
                          key={layer.id}
                          className={active ? 'sticker-layer active' : 'sticker-layer'}
                          role="button"
                          aria-label={`拖动${CATEGORY_LABEL[layer.category]}`}
                          style={{
                            left: `${((layer.frame.x + nudge.dx + (lift?.dx ?? 0)) / layer.baseWidth) * 100}%`,
                            top: `${((layer.frame.y + nudge.dy + (lift?.dy ?? 0)) / layer.baseHeight) * 100}%`,
                            width: `${((layer.frame.width * nudge.scale) / layer.baseWidth) * 100}%`,
                            height: `${((layer.frame.height * nudge.scale) / layer.baseHeight) * 100}%`,
                            zIndex: index + 1,
                          }}
                          onPointerDown={(event) => startMove(event, layer.id)}
                        >
                          <img src={layer.url} alt="" draggable={false} />
                          {active ? (
                            <button
                              type="button"
                              className="sticker-handle"
                              aria-label="调整大小"
                              onPointerDown={(event) => startScale(event, layer.id)}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <BlobImg blob={preview ?? body.imageBlob} alt="基准图" />
                )}
                <figcaption>
                  {layers.length > 0
                    ? activeSticker
                      ? '拖动贴纸调整位置和大小'
                      : '点一下贴纸，再调整位置和大小'
                    : sticking
                      ? '正在穿到身上'
                      : stage
                        ? '试穿'
                        : '基准图'}
                </figcaption>
              </figure>
              {layers.length > 0 ? (
                <div className="sticker-tools">
                  {layers.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      className={layer.id === activeSticker ? 'text-button on' : 'text-button'}
                      onClick={() => setActiveSticker(layer.id)}
                    >
                      {CATEGORY_LABEL[layer.category]}
                    </button>
                  ))}
                  {activeSticker ? (
                    <>
                      <label className="sticker-size">
                        大小
                        <input
                          type="range"
                          min={0.35}
                          max={2.8}
                          step={0.02}
                          value={nudgeOf(activeSticker).scale}
                          onChange={(event) => scaleActive(Number(event.target.value))}
                        />
                      </label>
                      <button type="button" className="text-button" onClick={() => applyNudge(activeSticker, { dx: 0, dy: 0, scale: 1 }, true)}>
                        还原位置
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {stage && worn.length > 0 ? (
                <div className="mix-picks">
                  {worn.map((item) => {
                    const fromCloset = covered[item.category] === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="mix-chip"
                        onClick={() => {
                          if (fromCloset) toggleOwned(item)
                        }}
                      >
                        <BlobImg blob={item.cutoutBlob} alt="" />
                        <span>{fromCloset ? CATEGORY_LABEL[item.category] : `想买 · ${CATEGORY_LABEL[item.category]}`}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
              {!stage && selected.length > 0 ? (
                <div className="mix-picks">
                  {selected.map((item) => (
                    <button key={item.id} type="button" className="mix-chip" onClick={() => toggleWish(item)}>
                      <BlobImg blob={item.cutoutBlob} alt="" />
                      <span>{CATEGORY_LABEL[item.category]}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="hint">{stage ? mixHint : pickHint}</p>
              {stickerErrorText ? <p className="error">{stickerErrorText}</p> : null}
              {stage ? (
                <>
                  <button type="button" className="primary" disabled={!canGenerate} onClick={() => void generate()}>
                    {making ? (filmStep === 'video' ? '正在做成展示视频…' : '正在生成全身照片…') : '搭配'}
                  </button>
                  {heldStill ? (
                    <button type="button" className="ghost" disabled={making} onClick={() => void retryVideo()}>
                      再试一次视频
                    </button>
                  ) : null}
                </>
              ) : (
                <button type="button" className="primary" disabled={selected.length === 0} onClick={begin}>
                  试穿
                </button>
              )}
              {wearProblem && !result ? <p className="error">{wearProblem}</p> : null}
            </>
          ) : (
            <div className="placeholder">
              <p>还没有基准图。建立身形之后，试穿会穿到这个人身上。</p>
              <button type="button" className="primary" onClick={() => setNav('account')}>
                去我的建立身形
              </button>
            </div>
          )}
        </aside>
      </div>

      {stage && result && body ? (
        <section className="mix-result" ref={resultRef}>
          <figure className="stage">
            <BlobImg blob={result} alt="试穿效果" />
            <figcaption>试穿</figcaption>
          </figure>
          <div>
            <div className="ref-strip">
              <figure>
                <BlobImg blob={body.imageBlob} alt="身形" />
                <figcaption>身形</figcaption>
              </figure>
              {sources.map((piece) => (
                <figure key={`${piece.role}-${piece.name}`}>
                  <BlobImg blob={piece.blob} alt={garmentLabel(piece.name)} />
                  <figcaption>{garmentLabel(piece.name)}</figcaption>
                </figure>
              ))}
            </div>
            <p className="recipe">{sources.map((piece) => garmentLabel(piece.name)).join('  +  ')}</p>
            <p className="hint">
              {sameOutfit
                ? '这是按个人模特的脸和身材生成的全身照。保存之后，穿搭页会放一张中间是这套全身照、两侧是单品的图。'
                : '这张还是上一套的效果。单品已经改了，再点搭配才会换成新的。'}
            </p>
            <AdjustNote value={note} busy={making} onChange={setNote} onSubmit={() => void revise()} />
            {!resultVideo ? <p className="hint">这次没有展示视频。保存之后，穿搭页只放这张照片，点一下不会播放。</p> : null}
            {wearProblem ? <p className="error">{wearProblem}</p> : null}
            {heldStill ? (
              <button type="button" className="ghost" disabled={making} onClick={() => void retryVideo()}>
                再试一次视频
              </button>
            ) : null}
            <TagPicker
              key={tagEpoch}
              selected={lookTags}
              history={savedTags}
              onChange={setLookTags}
              onInputChange={(value) => {
                tagInput.current = value
              }}
            />
            <button type="button" className="primary" disabled={saving || making || !result} onClick={() => void save()}>
              {saving ? '正在做成穿搭页的图片…' : '保存这次试穿'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
