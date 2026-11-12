import { useEffect, useRef, useState } from 'react'
import { garmentLabel } from '../garment-name.ts'
import { formatWhen, useObjectUrl } from '../hooks.ts'
import { clampPlacement, minCoverScale, paintRealPoster, readPosterSlot, type PosterSlot, type RealPlacement } from '../look-board.tsx'
import { dropSource, writeSource } from '../source-files.ts'
import { useWardrobe } from '../store.tsx'
import { TagPicker } from '../tag-picker.tsx'
import { normalizeTag, uniqueTags } from '../tags.ts'
import type { Look, LookMode } from '../types.ts'

type MenuState = { x: number; y: number; lookId: string }
type Draft = { lookId: string; photo: Blob; slot: PosterSlot; photoW: number; photoH: number; kind: 'still' | 'pair' }

export function LooksPage() {
  const { looks, garments, savedTags, deleteLook, updateLook, notify, rememberTag } = useWardrobe()
  const [mode, setMode] = useState<'all' | LookMode>('all')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [taggingId, setTaggingId] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState<string[]>([])
  const tagInput = useRef('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const pendingId = useRef<string | null>(null)
  const pendingKind = useRef<'still' | 'pair'>('still')
  const pendingReal = useRef<Blob | null>(null)
  const pendingOriginal = useRef<Blob | null>(null)
  const tagChoices = uniqueTags(looks.flatMap((look) => look.tags ?? []), 80)
  const visible = looks.filter((look) => {
    if (mode !== 'all' && look.mode !== mode) return false
    if (tagFilter.length === 0) return true
    return (look.tags ?? []).some((tag) => tagFilter.includes(tag))
  })
  const menuLook = menu ? looks.find((item) => item.id === menu.lookId) : undefined
  const taggingLook = taggingId ? looks.find((item) => item.id === taggingId) : undefined
  const draftLook = draft ? looks.find((item) => item.id === draft.lookId) : undefined

  useEffect(() => {
    setTagFilter((current) => {
      const next = current.filter((tag) => tagChoices.includes(tag))
      return next.length === current.length ? current : next
    })
  }, [tagChoices.join('\0')])

  useEffect(() => {
    if (!filterOpen) return
    const close = (event: Event) => {
      if (event.target instanceof Node && filterRef.current?.contains(event.target)) return
      setFilterOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [filterOpen])

  useEffect(() => {
    if (!menu) return
    const close = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  async function remove(id: string) {
    if (!window.confirm('删除这张穿搭记录？')) return
    await deleteLook(id)
  }

  function askReal(lookId: string, kind: 'still' | 'pair') {
    pendingId.current = lookId
    pendingKind.current = kind
    pendingReal.current = null
    pendingOriginal.current = null
    setMenu(null)
    fileRef.current?.click()
  }

  async function takeFile(file: File) {
    const lookId = pendingId.current
    const look = looks.find((item) => item.id === lookId)
    pendingId.current = null
    if (!look) return
    try {
      const slot = await readPosterSlot(look.imageBlob)
      const bitmap = await createImageBitmap(file)
      const photoW = bitmap.width
      const photoH = bitmap.height
      bitmap.close()
      setDraft({ lookId: look.id, photo: file, slot, photoW, photoH, kind: pendingKind.current })
    } catch (error) {
      notify(error instanceof Error ? error.message : '这张实拍读不出来')
    }
  }

  async function takeVideo(file: File) {
    const lookId = pendingId.current
    const realBlob = pendingReal.current
    const original = pendingOriginal.current
    pendingId.current = null
    pendingReal.current = null
    pendingOriginal.current = null
    if (!lookId || !realBlob || !original) return
    await writeSource(lookId, 'real', original)
    await writeSource(lookId, 'realVideo', file)
    await updateLook(lookId, { realBlob, realVideoBlob: file, showReal: true })
    notify('中间已换成实拍，并配上了视频')
  }

  async function showGenerated(look: Look) {
    setMenu(null)
    await updateLook(look.id, { showReal: false })
  }

  async function showShot(look: Look) {
    setMenu(null)
    await updateLook(look.id, { showReal: true })
  }

  function closeTags() {
    setTaggingId(null)
    setTagDraft([])
    tagInput.current = ''
  }

  async function commitTags() {
    if (!taggingLook) return
    const typed = normalizeTag(tagInput.current)
    const tags = uniqueTags(typed ? [...tagDraft, typed] : tagDraft)
    await updateLook(taggingLook.id, { tags })
    for (const tag of tags) await rememberTag(tag)
    closeTags()
  }

  return (
    <div>
      <p className="kicker">存下来的</p>
      <h1>穿搭</h1>
      <p className="lede">日常搭配和试穿记录分开。试穿记录里可能还有当时没买的衣服。有展示视频的卡片，点一下照片会淡出，视频逐渐播出来。右击可以换成实拍，也可以改标签。</p>
      <div className="look-filter-row">
        <div className="chips">
          <button type="button" className={mode === 'all' ? 'chip selected' : 'chip'} onClick={() => setMode('all')}>
            全部
          </button>
          <button type="button" className={mode === 'closet' ? 'chip selected' : 'chip'} onClick={() => setMode('closet')}>
            日常搭配
          </button>
          <button type="button" className={mode === 'tryon' ? 'chip selected' : 'chip'} onClick={() => setMode('tryon')}>
            试穿
          </button>
        </div>
        <div className="look-filters" ref={filterRef}>
          <button
            type="button"
            className={tagFilter.length > 0 ? 'text-button look-filter-btn on' : 'text-button look-filter-btn'}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            筛选
          </button>
          {filterOpen ? (
            <div className="look-filter-menu" role="listbox" aria-label="已有标签" aria-multiselectable="true">
              {tagChoices.length === 0 ? (
                <p>还没有用过的标签。</p>
              ) : (
                tagChoices.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    role="option"
                    aria-selected={tagFilter.includes(tag)}
                    className={tagFilter.includes(tag) ? 'selected' : ''}
                    onClick={() => setTagFilter((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
                  >
                    {tag}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void takeFile(file)
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/mp4,video/quicktime"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void takeVideo(file)
        }}
      />
      {visible.length === 0 ? (
        <div className="placeholder">
          <p>{tagFilter.length > 0 ? '没有带这些标签的穿搭。' : '还没有保存的穿搭。'}</p>
        </div>
      ) : (
        <div className="look-grid">
          {visible.map((look) => {
            const names = look.garmentIds
              .map((id) => {
                const item = garments.find((garment) => garment.id === id)
                return item ? garmentLabel(item.name, item.title) : undefined
              })
              .filter((name): name is string => Boolean(name))
            const showingReal = Boolean(look.showReal && look.realBlob)
            const shown = showingReal && look.realBlob ? look.realBlob : look.imageBlob
            const clip = showingReal ? look.realVideoBlob : look.videoBlob
            return (
              <article
                key={look.id}
                className="look-card"
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ x: event.clientX, y: event.clientY, lookId: look.id })
                }}
              >
                <LookMotion poster={shown} video={clip} />
                <div className="card-meta">
                  <div>
                    <p className="look-name">
                      <strong>{look.mode === 'closet' ? '日常搭配' : '试穿'}</strong>
                      {look.tags && look.tags.length > 0 ? <span>{look.tags.join(' · ')}</span> : null}
                    </p>
                    <small>{formatWhen(look.createdAt)}</small>
                    {names.length > 0 ? <small>{names.join(' + ')}</small> : null}
                  </div>
                  <button type="button" className="text-button" onClick={() => void remove(look.id)}>
                    删除
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {menu && menuLook ? (
        <div
          ref={menuRef}
          className="look-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 248) }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setTaggingId(menuLook.id)
              setTagDraft(menuLook.tags ?? [])
              tagInput.current = ''
              setMenu(null)
            }}
          >
            改标签
          </button>
          <button type="button" role="menuitem" onClick={() => askReal(menuLook.id, 'still')}>
            用实拍替换中间
          </button>
          <button type="button" role="menuitem" onClick={() => askReal(menuLook.id, 'pair')}>
            用实拍照片和视频替换
          </button>
          {menuLook.showReal && menuLook.realBlob ? (
            <button type="button" role="menuitem" onClick={() => void showGenerated(menuLook)}>
              换回生成图
            </button>
          ) : null}
          {menuLook.realBlob && !menuLook.showReal ? (
            <button type="button" role="menuitem" onClick={() => void showShot(menuLook)}>
              显示实拍
            </button>
          ) : null}
        </div>
      ) : null}
      {taggingLook ? (
        <div className="look-tag-panel" role="dialog" aria-label="改标签">
          <TagPicker
            key={taggingLook.id}
            selected={tagDraft}
            history={savedTags}
            onChange={setTagDraft}
            onInputChange={(value) => {
              tagInput.current = value
            }}
          />
          <div className="look-tag-actions">
            <button type="button" className="ghost" onClick={closeTags}>
              取消
            </button>
            <button type="button" className="primary" onClick={() => void commitTags()}>
              完成
            </button>
          </div>
        </div>
      ) : null}
      {draft && draftLook ? (
        <RealEditor
          poster={draftLook.imageBlob}
          photo={draft.photo}
          slot={draft.slot}
          photoW={draft.photoW}
          photoH={draft.photoH}
          hint={draft.kind === 'pair' ? '定好中间之后，再选一段实拍视频。两侧单品保持不动。' : undefined}
          onCancel={() => setDraft(null)}
          onSave={async (placement) => {
            const realBlob = await paintRealPoster(draftLook.imageBlob, draft.photo, draft.slot, placement)
            if (draft.kind === 'pair') {
              pendingId.current = draftLook.id
              pendingReal.current = realBlob
              pendingOriginal.current = draft.photo
              setDraft(null)
              videoRef.current?.click()
              return
            }
            await writeSource(draftLook.id, 'real', draft.photo)
            await dropSource(draftLook.id, 'realVideo')
            await updateLook(draftLook.id, { realBlob, showReal: true, realVideoBlob: undefined })
            setDraft(null)
            notify('中间已换成实拍，生成图还留着')
          }}
        />
      ) : null}
    </div>
  )
}

function LookMotion({ poster, video }: { poster: Blob; video?: Blob }) {
  const posterUrl = useObjectUrl(poster)
  const videoUrl = useObjectUrl(video)
  const videoNode = useRef<HTMLVideoElement>(null)
  const phase = useRef<'idle' | 'playing' | 'closing'>('idle')
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing) return
    const node = videoNode.current
    if (!node) return
    node.currentTime = 0
    void node.play().catch(() => {
      phase.current = 'idle'
      setPlaying(false)
    })
  }, [playing])

  function play() {
    if (!video || phase.current !== 'idle') return
    phase.current = 'playing'
    setPlaying(true)
  }

  return (
    <div className={video ? 'look-stage can-play' : 'look-stage'} onClick={play}>
      <img src={posterUrl} alt="穿搭效果" className={playing ? 'away' : ''} />
      {videoUrl ? (
        <video
          ref={videoNode}
          src={videoUrl}
          muted
          playsInline
          className={playing ? 'on' : ''}
          onEnded={() => {
            phase.current = 'closing'
            setPlaying(false)
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== 'opacity' || phase.current !== 'closing') return
            phase.current = 'idle'
          }}
        />
      ) : null}
    </div>
  )
}

function RealEditor({
  poster,
  photo,
  slot,
  photoW,
  photoH,
  hint,
  onCancel,
  onSave,
}: {
  poster: Blob
  photo: Blob
  slot: PosterSlot
  photoW: number
  photoH: number
  hint?: string
  onCancel: () => void
  onSave: (placement: RealPlacement) => Promise<void>
}) {
  const posterUrl = useObjectUrl(poster)
  const photoUrl = useObjectUrl(photo)
  const stageRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const placementRef = useRef<RealPlacement>({ scale: 1, panX: 0, panY: 0, rotation: 0 })
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const [placement, setPlacement] = useState<RealPlacement>(() => {
    const scale = minCoverScale(photoW, photoH, slot.w, slot.h, 0)
    return { scale, panX: 0, panY: 0, rotation: 0 }
  })
  const [viewScale, setViewScale] = useState(1)
  const [saving, setSaving] = useState(false)
  placementRef.current = placement
  const minScale = minCoverScale(photoW, photoH, slot.w, slot.h, placement.rotation)
  const maxScale = minScale * 4

  function apply(next: RealPlacement) {
    setPlacement(clampPlacement(next, photoW, photoH, slot.w, slot.h))
  }

  useEffect(() => {
    const root = stageRef.current
    const image = root?.querySelector('img.real-poster')
    if (!root || !(image instanceof HTMLImageElement)) return
    const measure = () => {
      if (image.clientWidth > 0) setViewScale(image.clientWidth / slot.width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(image)
    return () => observer.disconnect()
  }, [posterUrl, slot.width])

  useEffect(() => {
    const node = windowRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = placementRef.current
      const floor = minCoverScale(photoW, photoH, slot.w, slot.h, current.rotation)
      const scale = Math.min(floor * 4, Math.max(floor, current.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08)))
      setPlacement(clampPlacement({ ...current, scale }, photoW, photoH, slot.w, slot.h))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [photoH, photoW, slot.h, slot.w])

  return (
    <div className="real-editor" role="dialog" aria-label="用实拍替换中间">
      <div className="real-editor-panel">
        <p className="kicker">实拍</p>
        <h2>替换中间的全身照</h2>
        <p className="hint">{hint ?? '拖动实拍，选择中间要留下的部分。两侧单品保持不动。'}</p>
        <div className="real-stage" ref={stageRef}>
          <img className="real-poster" src={posterUrl} alt="" />
          <div
            ref={windowRef}
            className="real-window"
            style={{ left: `${(slot.x / slot.width) * 100}%`, width: `${(slot.w / slot.width) * 100}%` }}
            onPointerDown={(event) => {
              dragRef.current = { x: event.clientX, y: event.clientY, panX: placementRef.current.panX, panY: placementRef.current.panY }
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // 拖动仍按指针移动计算
              }
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag || viewScale <= 0) return
              const current = placementRef.current
              apply({
                ...current,
                panX: drag.panX + (event.clientX - drag.x) / viewScale,
                panY: drag.panY + (event.clientY - drag.y) / viewScale,
              })
            }}
            onPointerUp={() => {
              dragRef.current = null
            }}
          >
            <img
              src={photoUrl}
              alt=""
              draggable={false}
              style={{
                width: photoW * placement.scale * viewScale,
                height: photoH * placement.scale * viewScale,
                transform: `translate(-50%, -50%) translate(${placement.panX * viewScale}px, ${placement.panY * viewScale}px) rotate(${placement.rotation}deg)`,
              }}
            />
          </div>
        </div>
        <label className="real-slider">
          <span>缩放</span>
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={(maxScale - minScale) / 100 || 0.01}
            value={Math.min(maxScale, placement.scale)}
            onChange={(event) => apply({ ...placement, scale: Number(event.target.value) })}
          />
        </label>
        <label className="real-slider">
          <span>旋转</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={placement.rotation}
            onChange={(event) => apply({ ...placement, rotation: Number(event.target.value) })}
          />
        </label>
        <div className="real-actions">
          <button type="button" className="ghost" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={() => {
              setSaving(true)
              void onSave(placement).catch((error: unknown) => {
                setSaving(false)
                window.alert(error instanceof Error ? error.message : '没有换成实拍')
              })
            }}
          >
            {saving ? '正在替换…' : '用这块替换'}
          </button>
        </div>
      </div>
    </div>
  )
}
