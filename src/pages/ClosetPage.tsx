import { useEffect, useRef, useState } from 'react'
import { AdjustNote, BlobImg } from '../components.tsx'
import { blobToCanvas, compositeLook, dominantColor, stickerLayer, type StickerFrame } from '../imaging.ts'
import { useWardrobe } from '../store.tsx'
import {
  ACCESSORY_ORDER,
  BODY_LABEL,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CLOTHING_ORDER,
  SEASON_LABEL,
  SEASON_ORDER,
  stickerAligned,
  stickerCurrent,
  stickerVersionFor,
  type Category,
  type Garment,
  type Season,
} from '../types.ts'
import { addedOrder, garmentLabel, nextGarmentName } from '../garment-name.ts'
import { maxGarments } from '../model-config.ts'
import { generateFlatLay, generateGarmentSticker, generateWearPhoto, wearError, type WearPiece } from '../wear.ts'

const stickerInflight = new Set<string>()
const STACK: Category[] = ['shoes', 'bottom', 'top', 'belt', 'outer', 'scarf', 'necklace', 'hat', 'watch', 'bag']

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

function stickerVisible(item: Garment, updatedAt: number): boolean {
  return stickerAligned(item, updatedAt)
}

function slotsFor(shelf: Shelf): Category[] {
  return shelf === 'accessory' ? ACCESSORY_ORDER : CLOTHING_ORDER
}

export function ClosetPage() {
  const { body, garments, addGarment, updateGarment, deleteGarment, addLook, notify, setNav } = useWardrobe()
  const [shelf, setShelf] = useState<Shelf>('summer')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [pending, setPending] = useState<{ originalBlob: Blob; flatLay: boolean } | null>(null)
  const [filing, setFiling] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [picked, setPicked] = useState<Partial<Record<Category, string>>>({})
  const [result, setResult] = useState<Blob | null>(null)
  const [sources, setSources] = useState<WearPiece[]>([])
  const [madeFrom, setMadeFrom] = useState<string[]>([])
  const [making, setMaking] = useState(false)
  const [wearProblem, setWearProblem] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<Blob | null>(null)
  const [sticking, setSticking] = useState<string | null>(null)
  const [stickerError, setStickerError] = useState('')
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
  nudgesRef.current = nudges
  bodyRef.current = body
  garmentsRef.current = garments
  const resultRef = useRef<HTMLElement>(null)

  const slots = slotsFor(shelf)
  const categoryValue = slots.includes(category) ? category : slots[0]
  const owned = garments.filter((item) => item.status === 'owned')
  const visible =
    shelf === 'accessory'
      ? owned.filter((item) => ACCESSORY_ORDER.includes(item.category))
      : owned.filter((item) => CLOTHING_ORDER.includes(item.category) && seasonOf(item.season) === shelf)
  const chosen = CATEGORY_ORDER.flatMap((slot) => {
    const item = owned.find((garment) => garment.id === picked[slot] && garment.category === slot)
    return item ? [item] : []
  })
  const top = chosen.find((item) => item.category === 'top')
  const bottom = chosen.find((item) => item.category === 'bottom')
  const currentIds = chosen.map((item) => item.id)
  const sameOutfit = currentIds.length === madeFrom.length && currentIds.every((id, index) => id === madeFrom[index])
  const canGenerate = Boolean(
    body?.person &&
      top &&
      bottom &&
      chosen.length <= maxGarments() &&
      !making &&
      chosen.every((item) => stickerAligned(item, body.updatedAt)),
  )
  const stickerKey = chosen
    .filter((item) => body?.person && stickerVisible(item, body.updatedAt) && item.stickerBlob)
    .map((item) => {
      const frame = item.stickerFrame
      const box = frame ? `${frame.x}:${frame.y}:${frame.width}:${frame.height}` : 'fit'
      return `${item.id}:${item.stickerVer ?? 0}:${item.stickerFor ?? 0}:${item.stickerBlob?.size ?? 0}:${box}`
    })
    .join('|')
  const placeKey = chosen
    .map((item) => {
      const place = item.stickerPlace
      return place ? `${item.id}:${place.dx}:${place.dy}:${place.scale}` : item.id
    })
    .join('|')

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [result])

  useEffect(() => {
    if (!body || body.person) {
      setPreview(null)
      return
    }
    const items = CATEGORY_ORDER.flatMap((slot) => {
      const item = garments.find(
        (garment) => garment.status === 'owned' && garment.id === picked[slot] && garment.category === slot,
      )
      const sticker = item && body.person && stickerCurrent(item, body.updatedAt) ? item.stickerBlob : undefined
      if (body.person) return item && sticker ? [{ category: item.category, blob: item.cutoutBlob, sticker }] : []
      return item ? [{ category: item.category, blob: item.cutoutBlob }] : []
    })
    if (items.length === 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    void compositeLook(body.imageBlob, body.marks, items, { person: Boolean(body.person) })
      .then((blob) => {
        if (!cancelled) setPreview(blob)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [body, garments, picked])

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
    const selected = chosen.filter((item) => item.stickerBlob && stickerVisible(item, body.updatedAt))
    let cancelled = false
    const created: string[] = []
    void (async () => {
      const next: StickerLayer[] = []
      for (const item of selected) {
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
          /* 这一件贴纸读不出来时，其余仍可调整 */
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
    setActiveSticker((current) => {
      if (current && layers.some((layer) => layer.id === current)) return current
      return layers.at(-1)?.id ?? null
    })
  }, [layers])

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
    const stage = stageRef.current
    if (!layer || !stage) return
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
    const rect = stage.getBoundingClientRect()
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
    const stage = stageRef.current
    if (!layer || !stage) return
    setActiveSticker(id)
    const pointer = event.currentTarget
    try {
      pointer.setPointerCapture(event.pointerId)
    } catch {
      /* 指针捕获失败时，仍由窗口上的移动事件继续跟踪 */
    }
    const start = nudgesRef.current[id] ?? { dx: 0, dy: 0, scale: 1 }
    const originX = event.clientX
    const rect = stage.getBoundingClientRect()
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

  function openShelf(next: Shelf) {
    setShelf(next)
    const nextSlots = slotsFor(next)
    setCategory((current) => (nextSlots.includes(current) ? current : nextSlots[0]))
  }

  function enqueueSticker(item: Garment, manual = false) {
    const profile = bodyRef.current
    if (!profile?.person) return
    if (stickerCurrent(item, profile.updatedAt)) return
    if (!manual && item.stickerBlob) return
    if (stickerInflight.has(item.id) || queueRef.current.some((queued) => queued.id === item.id)) return
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
        if (!profile?.person || stickerInflight.has(next.id)) continue
        const latest = garmentsRef.current.find((garment) => garment.id === next.id) ?? next
        if (stickerCurrent(latest, profile.updatedAt)) continue
        stickerInflight.add(latest.id)
        setSticking(latest.id)
        setStickerError('')
        try {
          const worn = await generateGarmentSticker({
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
            stickerBlob: worn.stickerBlob,
            stickerFrame: worn.stickerFrame,
            stickerFor: profile.updatedAt,
            stickerVer: stickerVersionFor(latest.category),
            stickerPlace: place,
          })
        } catch (cause) {
          setStickerError(wearError(cause))
        } finally {
          stickerInflight.delete(latest.id)
          setSticking(null)
        }
      }
    } finally {
      runningRef.current = false
    }
  }

  function toggle(item: Garment) {
    const selected = picked[item.category] === item.id
    if (!selected) enqueueSticker(item)
    setPicked((current) => ({
      ...current,
      [item.category]: selected ? undefined : item.id,
    }))
  }

  async function takeFile(file: File) {
    setUploadError('')
    setPending({ originalBlob: file, flatLay: false })
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
  }

  function cancel() {
    setPending(null)
    setName('')
    setUploadError('')
  }

  function stickerReady(item: Garment): boolean {
    return Boolean(body?.person && stickerCurrent(item, body.updatedAt))
  }

  useEffect(() => {
    if (!body?.person) return
    for (const slot of CATEGORY_ORDER) {
      const item = garments.find(
        (garment) => garment.status === 'owned' && garment.id === picked[slot] && garment.category === slot,
      )
      if (item) enqueueSticker(item)
    }
  }, [body, garments, picked])

  async function commit() {
    if (!pending || sticking || filing) return
    const label = name.trim() || CATEGORY_LABEL[categoryValue]
    setFiling(true)
    setUploadError('')
    let product = pending.originalBlob
    let saved: Garment
    try {
      if (!pending.flatLay) product = await generateFlatLay({ name: label, blob: pending.originalBlob })
      const color = dominantColor(await blobToCanvas(product))
      const season = shelf === 'accessory' ? undefined : shelf
      saved = await addGarment({
        name: nextGarmentName(garments, 'owned', categoryValue, season),
        category: categoryValue,
        ...(season ? { season } : {}),
        status: 'owned',
        cutoutBlob: product,
        originalBlob: pending.originalBlob,
        color,
      })
    } catch (cause) {
      setUploadError(wearError(cause))
      setFiling(false)
      return
    }
    setFiling(false)
    if (!body?.person) {
      setPending(null)
      setName('')
      notify(shelf === 'accessory' ? '已放进配饰' : `已放进${SEASON_LABEL[shelf]}`)
      return
    }
    setSticking(saved.id)
    try {
      const worn = await generateGarmentSticker({
        bodyBlob: body.imageBlob,
        productBlob: product,
        category: categoryValue,
        name: label,
        marks: body.marks,
      })
      await updateGarment(saved.id, {
        stickerBlob: worn.stickerBlob,
        stickerFrame: worn.stickerFrame,
        stickerFor: body.updatedAt,
        stickerVer: stickerVersionFor(categoryValue),
        stickerPlace: { dx: 0, dy: 0, scale: 1 },
      })
      setPending(null)
      setName('')
      notify('已放进衣橱，贴合图层按这个人的身材做好了')
    } catch (cause) {
      setPending(null)
      setName('')
      setUploadError(wearError(cause))
      notify('衣服已放进衣橱，贴合图层这次没做成')
    } finally {
      setSticking(null)
    }
  }

  async function remove(id: string, itemName: string) {
    if (!window.confirm(`从衣橱移除「${itemName}」？`)) return
    await deleteGarment(id)
    setPicked((current) => {
      const next = { ...current }
      for (const slot of CATEGORY_ORDER) {
        if (next[slot] === id) next[slot] = undefined
      }
      return next
    })
  }

  async function generate() {
    if (!body?.person || !top || !bottom || chosen.length > maxGarments()) return
    const pieces: WearPiece[] = chosen.flatMap((item) =>
      item.stickerBlob && stickerAligned(item, body.updatedAt)
        ? [{ role: item.category, name: item.name, blob: item.stickerBlob }]
        : [],
    )
    if (pieces.length !== chosen.length) {
      setWearProblem('先把这套衣服的贴合图层做完，再生成全身效果。')
      return
    }
    setMaking(true)
    setWearProblem('')
    setSources(pieces)
    try {
      const image = await generateWearPhoto({
        bodyBlob: body.imageBlob,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        bodyLabel: BODY_LABEL[body.bodyType],
        person: Boolean(body.person),
        pieces,
      })
      setResult(image)
      setMadeFrom(currentIds)
    } catch (cause) {
      setWearProblem(wearError(cause))
    } finally {
      setMaking(false)
    }
  }

  async function revise() {
    const instruction = note.trim()
    if (!body || !result || sources.length === 0 || !instruction) return
    setMaking(true)
    setWearProblem('')
    try {
      const image = await generateWearPhoto({
        bodyBlob: body.imageBlob,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        bodyLabel: BODY_LABEL[body.bodyType],
        person: Boolean(body.person),
        pieces: sources,
        adjust: instruction,
      })
      setResult(image)
    } catch (cause) {
      setWearProblem(wearError(cause))
    } finally {
      setMaking(false)
    }
  }

  async function save() {
    if (!result || madeFrom.length === 0) return
    await addLook({ mode: 'closet', garmentIds: madeFrom, imageBlob: result })
    notify('已保存这套搭配')
  }

  const placedStickers = body?.person ? chosen.filter((item) => stickerAligned(item, body.updatedAt)).length : 0
  const driftedStickers = body?.person ? chosen.filter((item) => item.stickerBlob && item.stickerFor !== body.updatedAt).length : 0
  const missingStickers = body?.person ? chosen.filter((item) => !item.stickerBlob).length : 0
  let mixHint = '这是把存好的贴合图层盖在个人模特上的预览，不再请求模型。全身效果再点搭配。'
  if (!body) mixHint = '先建立身形，衣服才能穿到个人模特上。'
  else if (!body.person) mixHint = '当前是比例参考。贴合图层和全身效果都要用带本人脸的个人模特。'
  else if (chosen.length === 0) mixHint = '点左边已经做好贴合图层的单品，会立刻贴到个人模特上。'
  else if (sticking) mixHint = '正在按这个人的肩、腰、手脚生成这一件的透明图层。这一件用一张额度。'
  else if (driftedStickers > 0) mixHint = '身材改过之后，以前的贴合图层对不齐。点「重做贴合图层」才会按现在的个人模特重做，一件用一张额度。'
  else if (missingStickers > 0) mixHint = '选中的衣服里还有没做过贴合图层的。点「做成贴合图层」才会生成，一件用一张额度。'
  else if (placedStickers === chosen.length) mixHint = '存好的贴合图层已经盖在个人模特上。可以拖动。偏了就点还原位置。'
  else if (chosen.length > maxGarments()) mixHint = `一次最多搭配 ${maxGarments()} 件，先拿下几件。`
  else if (!top || !bottom) mixHint = '上衣和下装都点上之后，就可以生成更真实的全身照。'
  else if (result && !sameOutfit) mixHint = '基准图上已经换成新的单品。再点搭配，才会生成新的全身照。'

  const stackedLayers = [...layers].sort((a, b) => STACK.indexOf(a.category) - STACK.indexOf(b.category))

  return (
    <div className="closet">
      <div className="closet-bar">
        <div>
          <p className="kicker">已有的单品</p>
          <h1>衣橱</h1>
          <p className="hint">贴纸固定叫 sticker.png，和这件单品放在同一个文件夹里。有这个文件就直接贴上身。</p>
        </div>
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
          上传单品照片
        </label>
      </div>

      <div className="season-bar">
        <div className="chips">
          {SEASON_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              className={shelf === item ? 'chip selected' : 'chip'}
              onClick={() => openShelf(item)}
            >
              {SEASON_LABEL[item]}
            </button>
          ))}
          <button
            type="button"
            className={shelf === 'accessory' ? 'chip selected' : 'chip'}
            onClick={() => openShelf('accessory')}
          >
            配饰
          </button>
        </div>
        <span className="count">{visible.length} 件</span>
      </div>

      {pending ? (
        <div className="pending closet-pending">
          <BlobImg blob={pending.originalBlob} alt="待放入的衣服" className="pending-thumb" />
          <label>
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="只给整理平铺用，保存后按 summer/top/top01 编号" />
          </label>
          <label>
            类别
            <select value={categoryValue} onChange={(event) => setCategory(event.target.value as Category)}>
              {slots.map((slot) => (
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
                ? '保存时直接用这张图，不再调用模型。'
                : '穿着拍、衣服单拍或网店上身图都会整理成白底平铺，用一张额度。'}
              {body?.person ? ' 然后按个人模特生成这一件的贴合图层，再用一张额度。' : ''}
            </p>
            {uploadError ? <p className="error">{uploadError}</p> : null}
            <div className="pending-actions">
              <button type="button" className="primary" onClick={() => void commit()} disabled={Boolean(sticking) || filing}>
                {filing ? (pending.flatLay ? '正在保存…' : '正在整理成白底平铺…') : sticking ? '正在生成贴合图层…' : '放进衣橱'}
              </button>
              <button type="button" className="ghost" onClick={cancel}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : uploadError ? (
        <p className="error">{uploadError}</p>
      ) : null}

      <div className="closet-work">
      <div className="stage-list">
        {slots.map((slot) => {
          const items = addedOrder(visible.filter((item) => item.category === slot))
          return (
            <section key={slot} className="rail">
              <h2>{CATEGORY_LABEL[slot]}</h2>
              <div className="rail-track">
                {items.length === 0 ? (
                  <p className="rail-empty">
                    {shelf === 'accessory' ? `还没有${CATEGORY_LABEL[slot]}` : `这一季还没有${CATEGORY_LABEL[slot]}`}
                  </p>
                ) : (
                  items.map((item) => {
                    const selected = picked[item.category] === item.id
                    return (
                      <article key={item.id} className={selected ? 'card rail-card picked' : 'card rail-card'}>
                        <button
                          type="button"
                          className="rail-pick"
                          aria-pressed={selected}
                          onClick={() => toggle(item)}
                        >
                          <BlobImg blob={item.cutoutBlob} alt={garmentLabel(item.name)} className="thumb" />
                          {selected ? <span className="picked-mark">已选</span> : null}
                          <span className="card-meta">
                            <span className="swatch" style={{ background: item.color }} />
                            <span>
                              <strong>{garmentLabel(item.name)}</strong>
                            </span>
                          </span>
                        </button>
                        <div className="card-actions">
                          {body?.person && !stickerReady(item) ? (
                            <button
                              type="button"
                              className="text-button"
                              disabled={sticking === item.id}
                              onClick={() => enqueueSticker(item, true)}
                            >
                              {sticking === item.id ? '正在生成…' : item.stickerBlob ? '重做贴合图层' : '做成贴合图层'}
                            </button>
                          ) : null}
                          <button type="button" className="text-button" onClick={() => void remove(item.id, garmentLabel(item.name))}>
                            移除
                          </button>
                        </div>
                      </article>
                    )
                  })
                )}
              </div>
            </section>
          )
        })}
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
                    const active = layer.id === activeSticker
                    return (
                      <div
                        key={layer.id}
                        className={active ? 'sticker-layer active' : 'sticker-layer'}
                        role="button"
                        aria-label={`拖动${CATEGORY_LABEL[layer.category]}`}
                        style={{
                          left: `${((layer.frame.x + nudge.dx) / layer.baseWidth) * 100}%`,
                          top: `${((layer.frame.y + nudge.dy) / layer.baseHeight) * 100}%`,
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
                <BlobImg blob={preview ?? body.imageBlob} alt={chosen.length ? '基准图上的搭配' : '基准图'} />
              )}
              <figcaption>
                {layers.length > 0
                  ? '拖动贴纸调整位置和大小'
                  : sticking && placedStickers === 0
                    ? '正在穿到身上'
                    : chosen.length
                      ? '基准图上的快速预览'
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
                <label className="sticker-size">
                  大小
                  <input
                    type="range"
                    min={0.35}
                    max={2.8}
                    step={0.02}
                    value={activeSticker ? nudgeOf(activeSticker).scale : 1}
                    onChange={(event) => scaleActive(Number(event.target.value))}
                  />
                </label>
                {activeSticker ? (
                  <button type="button" className="text-button" onClick={() => applyNudge(activeSticker, { dx: 0, dy: 0, scale: 1 }, true)}>
                    还原位置
                  </button>
                ) : null}
              </div>
            ) : null}
            {chosen.length > 0 ? (
              <div className="mix-picks">
                {chosen.map((item) => (
                  <button key={item.id} type="button" className="mix-chip" onClick={() => toggle(item)}>
                    <BlobImg blob={item.cutoutBlob} alt="" />
                    <span>{CATEGORY_LABEL[item.category]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="hint">{mixHint}</p>
            {stickerError ? <p className="error">{stickerError}</p> : null}
            <button type="button" className="primary" disabled={!canGenerate} onClick={() => void generate()}>
              {making ? '正在生成全身照片…' : '搭配'}
            </button>
            {wearProblem && !result ? <p className="error">{wearProblem}</p> : null}
          </>
        ) : (
          <div className="placeholder">
            <p>还没有基准图。建立身形之后，点选的单品会直接盖在上面。</p>
            <button type="button" className="primary" onClick={() => setNav('account')}>
              去我的建立身形
            </button>
          </div>
        )}
      </aside>
      </div>

      {result && body ? (
        <section className="mix-result" ref={resultRef}>
          <figure className="stage">
            <BlobImg blob={result} alt="搭配效果" />
            <figcaption>日常搭配</figcaption>
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
                ? '这是个人模特加上已经贴合的单品生成的全身照。脸和身材保持个人模特。'
                : '这张还是上一套的效果。单品已经改了，再点搭配才会换成新的。'}
            </p>
            <AdjustNote value={note} busy={making} onChange={setNote} onSubmit={() => void revise()} />
            {wearProblem ? <p className="error">{wearProblem}</p> : null}
            <button type="button" className="primary" onClick={() => void save()}>
              保存这套搭配
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
