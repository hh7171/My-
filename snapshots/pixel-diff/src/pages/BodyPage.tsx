import { useEffect, useState } from 'react'
import { BlobImg, Slider } from '../components.tsx'
import { blobToCanvas, canvasToPng, prepareFromFile, presetFor, renderAdjusted } from '../imaging.ts'
import { REFERENCE_FIT, fitFromMarks, renderFashionBody, type BodyFit } from '../mannequin3d.ts'
import { useWardrobe } from '../store.tsx'
import { detectMarks } from '../vision.ts'
import { generateBasePhoto, wearError } from '../wear.ts'
import {
  BODY_LABEL,
  ZERO_ADJUSTMENTS,
  type Adjustments,
  type BodyMarks,
  type BodyProfile,
  type BodyType,
} from '../types.ts'

const BODY_OPTIONS: { id: BodyType; text: string }[] = [
  { id: 'straight', text: '肩、腰、胯接近' },
  { id: 'pear', text: '胯比肩宽' },
  { id: 'hourglass', text: '腰更细' },
  { id: 'apple', text: '腰腹更满' },
]

function explain(demo: boolean, posed: boolean): string {
  if (demo) return '这是比例参考。上传全身照后，才能生成带本人脸和皮肤的基准图。'
  if (posed) return '已按这张全身照读出肩、腰、胯和腿。定好比例后，生成穿着运动背心和紧身裤的基准图。'
  return '这张照片没认出全身关节，已按画面里的身材估了比例。可以用滑块再改，然后生成基准图。'
}

function proportionKey(heightCm: number, weightKg: number, bodyType: BodyType, adjustments: Adjustments) {
  return JSON.stringify({ heightCm, weightKg, bodyType, adjustments })
}

function storedFit(body: BodyProfile | null): BodyFit | null {
  if (!body) return null
  if (body.demo) return { ...REFERENCE_FIT }
  return fitFromMarks(body.normalizedMarks, body.posed)
}

export function BodyPage() {
  const { body, saveBody, clearBody, notify, setNav } = useWardrobe()
  const [heightCm, setHeightCm] = useState(body?.heightCm ?? 165)
  const [weightKg, setWeightKg] = useState(body?.weightKg ?? 52)
  const [bodyType, setBodyType] = useState<BodyType>(body?.bodyType ?? 'straight')
  const [adjustments, setAdjustments] = useState<Adjustments>(body?.adjustments ?? ZERO_ADJUSTMENTS)
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(body?.sourceBlob ?? null)
  const [normalizedBlob, setNormalizedBlob] = useState<Blob | null>(body?.normalizedBlob ?? null)
  const [normalizedMarks, setNormalizedMarks] = useState<BodyMarks | null>(body?.normalizedMarks ?? null)
  const [shapeBlob, setShapeBlob] = useState<Blob | null>(body?.person ? null : (body?.imageBlob ?? null))
  const [shapeMarks, setShapeMarks] = useState<BodyMarks | null>(body?.marks ?? null)
  const [baseBlob, setBaseBlob] = useState<Blob | null>(body?.person ? body.imageBlob : null)
  const [baseMarks, setBaseMarks] = useState<BodyMarks | null>(body?.person ? body.marks : null)
  const [baseKey, setBaseKey] = useState<string | null>(
    body?.person ? proportionKey(body.heightCm, body.weightKg, body.bodyType, body.adjustments) : null,
  )
  const [demo, setDemo] = useState(body?.demo ?? false)
  const [segmented, setSegmented] = useState(body?.segmented ?? false)
  const [posed, setPosed] = useState(body?.posed ?? false)
  const [fit, setFit] = useState<BodyFit | null>(storedFit(body))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(body ? explain(body.demo, body.posed) : '')

  useEffect(() => {
    if (fit) {
      let cancelled = false
      const timer = window.setTimeout(() => {
        try {
          const result = renderFashionBody(fit, adjustments, { heightCm, weightKg, thickness: demo ? 1 : undefined })
          void canvasToPng(result.canvas).then((blob) => {
            if (cancelled) return
            setShapeBlob(blob)
            setShapeMarks(result.marks)
          })
        } catch {
          if (!cancelled) setError('比例图生成失败了，请再试一次。')
        }
      }, 40)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
      }
    }
    if (!normalizedBlob || !normalizedMarks) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void renderAdjusted(normalizedBlob, normalizedMarks, adjustments)
        .then((result) => {
          if (cancelled) return
          setShapeBlob(result.imageBlob)
          setShapeMarks(result.marks)
        })
        .catch(() => {
          if (!cancelled) setError('调整身形时出错了，请再试一次。')
        })
    }, 50)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [adjustments, demo, fit, heightCm, normalizedBlob, normalizedMarks, weightKg])

  async function takePhoto(file: File) {
    setBusy(true)
    setError('')
    setStatus('正在读全身照的比例。首次识别关节需要联网。')
    try {
      const prepared = await prepareFromFile(file)
      setSourceBlob(prepared.sourceBlob)
      setNormalizedBlob(prepared.normalizedBlob)
      setNormalizedMarks(prepared.normalizedMarks)
      setFit(fitFromMarks(prepared.normalizedMarks, prepared.posed))
      setDemo(false)
      setSegmented(prepared.segmented)
      setPosed(prepared.posed)
      setAdjustments(presetFor(bodyType))
      setBaseBlob(null)
      setBaseMarks(null)
      setBaseKey(null)
      setStatus(explain(false, prepared.posed))
    } catch {
      setError('这张照片读不了，请换成 JPG 或 PNG。')
    } finally {
      setBusy(false)
    }
  }

  async function showDemo() {
    setBusy(true)
    setError('')
    try {
      const mannequin = renderFashionBody(REFERENCE_FIT, ZERO_ADJUSTMENTS, { heightCm, weightKg, thickness: 1 })
      const blob = await canvasToPng(mannequin.canvas)
      setSourceBlob(blob)
      setNormalizedBlob(blob)
      setNormalizedMarks(mannequin.marks)
      setFit({ ...REFERENCE_FIT })
      setDemo(true)
      setSegmented(true)
      setPosed(true)
      setAdjustments(presetFor(bodyType))
      setBaseBlob(null)
      setBaseMarks(null)
      setBaseKey(null)
      setStatus(explain(true, true))
    } catch {
      setError('比例图没有载入，请再试一次。')
    } finally {
      setBusy(false)
    }
  }

  const currentKey = proportionKey(heightCm, weightKg, bodyType, adjustments)
  const baseFresh = Boolean(baseBlob && baseKey === currentKey)

  async function makeBase() {
    if (demo || !sourceBlob) {
      setError('先上传一张全身照。基准图要用照片里的脸。')
      return
    }
    const editing = Boolean(baseBlob)
    setBusy(true)
    setError('')
    setStatus(editing ? '正在这张基准图上改身材，脸和站姿不动。这一次用一张额度。' : '正在用全身照和手填身材生成个人模特。这一次用一张额度。')
    try {
      const image = await generateBasePhoto({
        photoBlob: editing ? baseBlob! : sourceBlob,
        heightCm,
        weightKg,
        bodyLabel: BODY_LABEL[bodyType],
        adjustments,
        edit: editing,
      })
      let marks = shapeMarks
      try {
        const canvas = await blobToCanvas(image)
        marks = (await detectMarks(canvas)) ?? shapeMarks
      } catch {
        marks = shapeMarks
      }
      setBaseBlob(image)
      setBaseMarks(marks)
      setBaseKey(currentKey)
      setStatus('基准图好了。脸来自全身照，身材按当前比例。满意后存下来。')
    } catch (cause) {
      setError(wearError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!sourceBlob || !normalizedBlob || !normalizedMarks || !shapeBlob || !shapeMarks) return
    if (!demo && !baseFresh) {
      setError(baseBlob ? '比例已经改了，先重新生成基准图再保存。' : '先按这个比例生成基准图，再保存。')
      return
    }
    await saveBody({
      heightCm,
      weightKg,
      bodyType,
      adjustments,
      sourceBlob,
      normalizedBlob,
      normalizedMarks,
      imageBlob: demo ? shapeBlob : (baseBlob ?? shapeBlob),
      marks: demo ? shapeMarks : (baseMarks ?? shapeMarks),
      demo,
      segmented,
      posed,
      person: !demo,
      updatedAt: Date.now(),
    })
    notify(demo ? '已保存这套比例' : '基准图已保存')
  }

  async function resetProfile() {
    if (!window.confirm('清除已保存的身形基准？衣橱和穿搭还会留着。')) return
    await clearBody()
    notify('身形基准已清除')
  }

  return (
    <div className="split">
      <section>
        <p className="kicker">身形</p>
        <h1>先得到一张你认可的基准图。</h1>
        <p className="lede">
          别人帮拍或对着镜子拍全身，镜头放在胸口高度，手臂稍离开身体，尽量穿贴身衣服。个人模特只用这张全身照的脸，身材按身高、体重和滑块。旁边的比例图只在页面上看。
        </p>
        <button type="button" className="text-button back-link" onClick={() => setNav('account')}>
          回到我的
        </button>

        <label className="drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) void takePhoto(file)
        }}>
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void takePhoto(file)
            }}
          />
          <strong>{busy ? '正在处理…' : '上传全身照'}</strong>
          <span>JPG 或 PNG，站直，全身入镜</span>
        </label>

        <div className="measure">
          <label>
            身高 cm
            <input
              type="number"
              min={120}
              max={220}
              value={heightCm}
              onChange={(event) => setHeightCm(Number(event.target.value))}
            />
          </label>
          <label>
            体重 kg
            <input
              type="number"
              min={30}
              max={200}
              value={weightKg}
              onChange={(event) => setWeightKg(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="type-grid">
          {BODY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={bodyType === option.id ? 'type-card selected' : 'type-card'}
              onClick={() => setBodyType(option.id)}
            >
              <Silhouette type={option.id} />
              <span>{BODY_LABEL[option.id]}</span>
              <small>{option.text}</small>
            </button>
          ))}
        </div>

        <div className="row-actions">
          <button type="button" className="ghost" onClick={() => void showDemo()} disabled={busy}>
            只用比例参考
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {body ? (
          <button type="button" className="text-button danger" onClick={() => void resetProfile()}>
            清除身形档案
          </button>
        ) : null}
      </section>

      <section className="review">
        {shapeBlob ? (
          <>
            <div className="compare">
              <figure>
                <BlobImg blob={sourceBlob} alt={demo ? '比例参考' : '上传的全身照'} />
                <figcaption>{demo ? '比例参考' : '你的照片'}</figcaption>
              </figure>
              <figure>
                <BlobImg blob={shapeBlob} alt="当前比例" />
                <figcaption>当前比例，只在本地看</figcaption>
              </figure>
            </div>
            {baseBlob ? (
              <figure className="stage">
                <BlobImg blob={baseBlob} alt="基准图" />
                <figcaption>基准图</figcaption>
              </figure>
            ) : null}
            <p className="hint">{status}</p>
            {baseBlob && !baseFresh ? <p className="hint">比例已经改了。再生成一次，会在这张基准图上只改身材，脸和站姿不动。以前贴好的单品图层要对不齐，需要重做。</p> : null}
            <div className="sliders">
              <Slider label="肩线" left="窄" right="宽" value={adjustments.shoulder} onChange={(shoulder) => setAdjustments({ ...adjustments, shoulder })} />
              <Slider label="腰" left="收" right="放" value={adjustments.waist} onChange={(waist) => setAdjustments({ ...adjustments, waist })} />
              <Slider label="胯" left="窄" right="宽" value={adjustments.hip} onChange={(hip) => setAdjustments({ ...adjustments, hip })} />
              <Slider label="腿" left="短" right="长" value={adjustments.leg} onChange={(leg) => setAdjustments({ ...adjustments, leg })} />
            </div>
            <p className="hint">滑块马上改的是旁边的比例图。生成时只发送全身照和这些数字。已经有基准图后再生成，就在那张成品上改身材。生成一次用一张额度。</p>
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => setAdjustments(ZERO_ADJUSTMENTS)}>
                按照片比例
              </button>
              <button type="button" className="ghost" onClick={() => setAdjustments(presetFor(bodyType))}>
                按{BODY_LABEL[bodyType]}重设
              </button>
              <button type="button" className="primary" onClick={() => void makeBase()} disabled={busy || demo || !sourceBlob}>
                {busy ? '正在生成基准图…' : baseBlob ? '在这张基准图上改比例' : '按这个比例生成基准图'}
              </button>
              <button type="button" className="primary" onClick={() => void save()} disabled={busy || !shapeMarks || (!demo && !baseFresh)}>
                存为基准图
              </button>
            </div>
          </>
        ) : (
          <div className="placeholder">
            <p>上传全身照后，先定肩、腰、胯和腿，再生成穿着运动背心和紧身裤的个人模特。</p>
            <p className="hint">脸用照片里的脸。之后的单品图层和全身效果都贴在这张图上。</p>
          </div>
        )}
      </section>
    </div>
  )
}

function Silhouette({ type }: { type: BodyType }) {
  const shoulder = type === 'pear' ? 22 : type === 'apple' ? 32 : 28
  const waist = type === 'hourglass' ? 16 : type === 'apple' ? 34 : type === 'pear' ? 24 : 26
  const hip = type === 'pear' || type === 'hourglass' ? 36 : type === 'apple' ? 30 : 26
  return (
    <span className="silhouette" aria-hidden="true">
      <i style={{ width: 18, height: 18 }} />
      <i style={{ width: shoulder, height: 22 }} />
      <i style={{ width: waist, height: 14 }} />
      <i style={{ width: hip, height: 24 }} />
    </span>
  )
}
