import { extractWornGarment } from './imaging.ts'
import { maxGarments, type ImageTaskId } from './model-config.ts'
import { CATEGORY_LABEL, type Adjustments, type BodyMarks, type Category, type StickerFrame } from './types.ts'

export type WearPiece = {
  role: Category | '参考'
  name: string
  blob: Blob
}

type MeasureInput = {
  heightCm: number
  weightKg: number
  bodyLabel: string
  adjustments: Adjustments
}

type WearInput = {
  bodyBlob: Blob
  heightCm: number
  weightKg: number
  bodyLabel: string
  pieces: WearPiece[]
  adjust?: string
  person?: boolean
}

const ROLE_LINE: Record<WearPiece['role'], string> = {
  top: '要穿上的上衣',
  dress: '要穿上的连衣裙',
  skirt: '要穿上的裙子',
  pants: '要穿上的裤子',
  outer: '要穿上的外套',
  shoes: '要穿上的鞋子',
  belt: '要系的腰带',
  bag: '要拿的包',
  hat: '要戴的帽子',
  scarf: '要戴的围巾',
  glasses: '要戴的眼镜',
  jewelry: '要戴的珠宝',
  参考: '同一套衣服的参考照片，用来对齐颜色、图案和版型',
}

const MIN_SIDE = 240
const MAX_SIDE = 8000
const MAX_RATIO = 8

function fittedFrame(srcW: number, srcH: number, maxEdge: number) {
  const longest = Math.max(srcW, srcH)
  const shortest = Math.min(srcW, srcH)
  let scale = longest > maxEdge ? maxEdge / longest : 1
  if (shortest * scale < MIN_SIDE) scale = MIN_SIDE / shortest
  let drawW = Math.max(1, Math.round(srcW * scale))
  let drawH = Math.max(1, Math.round(srcH * scale))
  if (Math.max(drawW, drawH) > MAX_SIDE) {
    const fit = MAX_SIDE / Math.max(drawW, drawH)
    drawW = Math.max(1, Math.round(drawW * fit))
    drawH = Math.max(1, Math.round(drawH * fit))
  }
  let canvasW = Math.max(drawW, MIN_SIDE)
  let canvasH = Math.max(drawH, MIN_SIDE)
  if (canvasW / canvasH > MAX_RATIO) canvasH = Math.ceil(canvasW / MAX_RATIO)
  if (canvasH / canvasW > MAX_RATIO) canvasW = Math.ceil(canvasH / MAX_RATIO)
  canvasW = Math.min(MAX_SIDE, Math.max(MIN_SIDE, canvasW))
  canvasH = Math.min(MAX_SIDE, Math.max(MIN_SIDE, canvasH))
  const fit = Math.min(canvasW / drawW, canvasH / drawH, 1)
  drawW = Math.max(1, Math.round(drawW * fit))
  drawH = Math.max(1, Math.round(drawH * fit))
  return { canvasW, canvasH, drawW, drawH }
}

async function flatten(blob: Blob, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const { canvasW, canvasH, drawW, drawH } = fittedFrame(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布不可用')
  ctx.fillStyle = '#f3f0ea'
  ctx.fillRect(0, 0, canvasW, canvasH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, Math.round((canvasW - drawW) / 2), Math.round((canvasH - drawH) / 2), drawW, drawH)
  bitmap.close()
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
  if (!jpeg) throw new Error('图片没有准备好')
  return jpeg
}

export async function prepareReference(file: File): Promise<Blob> {
  return flatten(file, 1280)
}

function proportionLine(adjustments: Adjustments): string {
  const part = (name: string, value: number, up: string, down: string) => {
    if (value === 0) return `${name}按身高和体重的常见比例`
    return value > 0 ? `${name}要比常见比例${up}` : `${name}要比常见比例${down}`
  }
  return [
    part('肩宽', adjustments.shoulder, '更宽', '更窄'),
    part('腰', adjustments.waist, '更粗', '更细'),
    part('胯', adjustments.hip, '更宽', '更窄'),
    part('腿长', adjustments.leg, '更长', '更短'),
  ].join('，') + '。'
}

function measureLine(input: MeasureInput): string {
  return `手填身材：大约 ${input.heightCm} 厘米，${input.weightKg} 公斤，体型是${input.bodyLabel}。${proportionLine(input.adjustments)}`
}

function promptFor(input: WearInput): string {
  const clothes = input.pieces
    .map(
      (piece, index) =>
        `图${index + 2}是${ROLE_LINE[piece.role]}的商品图，名称是「${piece.name}」。只参考它的颜色、图案、版型和细节。不要按它在画面里的位置摆放，也不要把商品图原样贴上去。`,
    )
    .join('\n')
  const lines = [
    '生成一张写实的全身照片，从头到脚都在画面里。',
    '图1是这个人的个人模特。脸、五官、肤色、表情、身材、站姿和画面裁切都保持图1。',
    `她大约 ${input.heightCm} 厘米，${input.weightKg} 公斤，${input.bodyLabel}。这些数字只用来核对，肩宽、腰、胯、腿长都保持图1。`,
    '图1现在穿着运动背心和紧身裤。用后面的商品图，把这些单品真实地穿在这个人身上。',
    clothes,
    '上衣或连衣裙压住裤腰和裙腰，裤子和裙子压住鞋面，外套穿在上衣外面。帽子戴在头上，围巾围在脖子上。',
    '不要把商品图里的模特、衣架或背景带进来，也不要换成另一套衣服。',
    '不要拼贴，不要文字，不要水印，不要多余的人。',
  ]
  if (input.pieces.some((piece) => piece.role === 'bag')) {
    lines.push('包用右手拎住提手，包身垂在身体外侧。不要斜挎，不要换到左手。')
  }
  if (input.pieces.some((piece) => piece.role === 'jewelry')) lines.push('项链戴在脖子前面，手表或手链戴在右手腕正面。')
  if (input.pieces.some((piece) => piece.role === 'glasses')) lines.push('眼镜戴在眼睛上。')
  const note = input.adjust?.trim()
  if (note) {
    const topAt = input.pieces.findIndex((piece) => piece.role === 'top' || piece.role === 'dress')
    const bottomAt = input.pieces.findIndex((piece) => piece.role === 'pants' || piece.role === 'skirt')
    lines.push('这次仍然保持图1的脸、身材和站姿。')
    lines.push(`用户指定的穿法，必须照做：${note}`)
    if (topAt >= 0 && bottomAt >= 0 && /下摆|裤腰|塞进|外面|里面/.test(note)) {
      lines.push(
        `图${topAt + 2}的衣摆要全部露在图${bottomAt + 2}的腰头外面，盖住腰头一截，能看见完整的衣摆。不要把上衣塞进裤子或裙子。`,
      )
    }
  }
  return lines.join('\n')
}

export function basePrompt(input: MeasureInput): string {
  return [
    '生成一张影棚正面全身照，从头到脚都在画面里，纯色浅灰背景。',
    '图1是用户本人的全身照，只用来取脸和肤色。脸必须是这个人，五官不要换成别人。',
    '只有这一张图。不要使用白色人台、塑料模特或关节玩偶。',
    measureLine(input),
    '画面里是同一个真人，有皮肤纹理。',
    '正面站立，双脚站稳，腿伸直，双手微微离开身体。这张图的脸、站姿和裁切要固定，后面的单品都贴在它上面。',
    '只穿浅色运动背心和同色紧身裤。肩膀、手臂、小腿都露在外面。',
    '不要保留图1原来的衣服、姿势和背景。不要文字，不要水印，不要其他人。',
  ].join('\n')
}

export function editPrompt(input: MeasureInput): string {
  return [
    '在图1上改图。图1是已经生成好的个人模特。',
    '只改身材比例。脸、五官、肤色、表情、站姿、手脚的摆法、画面裁切和背景保持图1。',
    measureLine(input),
    '仍穿原来的浅色运动背心和同色紧身裤。',
    '不要换脸，不要换一套衣服，不要改成别人。',
    '不要使用白色人台。不要文字，不要水印，不要其他人。',
  ].join('\n')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片没有准备好'))
    reader.readAsDataURL(blob)
  })
}

function detail(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message
    if ('msg' in error && typeof error.msg === 'string') return error.msg
  }
  return ''
}

export function wearError(error: unknown): string {
  console.error(error)
  const text = detail(error)
  if (text.includes('API Key') || text.includes('OPENROUTER') || text.includes('ARK_API_KEY') || text.includes('图太多')) return text
  const lower = text.toLowerCase()
  if (lower.includes('invalid') && lower.includes('key') || lower.includes('unauthorized') || lower.includes('invalidapikey') || text.includes('鉴权')) {
    return '火山方舟 API Key 无效。请检查 .env 里的 ARK_API_KEY，改完后重新运行 npm run dev。'
  }
  if (lower.includes('quota') || lower.includes('credit') || lower.includes('allocation') || text.includes('额度') || text.includes('免费额度')) {
    return '火山方舟的免费额度用完了，这次没有生成。'
  }
  if (lower.includes('failed to fetch') || lower.includes('fetch failed') || lower.includes('network')) {
    return '图像模型没有连上。检查网络后再试一次。'
  }
  if (lower.includes('resolution must be at least') || lower.includes('image resolution')) {
    return '有一张图太小，每张至少要 240×240。请再点一次生成。'
  }
  const visible = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (visible) return visible
  return '这次没有生成全身照片。可以再试一次。'
}

async function postWear(task: ImageTaskId, prompt: string, images: Blob[]): Promise<Blob> {
  const prepared = await Promise.all(images.map((blob) => flatten(blob, 1024)))
  const dataUrls = await Promise.all(prepared.map((blob) => blobToDataUrl(blob)))
  const response = await fetch('/api/wear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, prompt, images: dataUrls }),
  })
  if (!response.ok) throw new Error((await response.text()) || '这次没有生成全身照片')
  return response.blob()
}

export async function generateBasePhoto(input: MeasureInput & { photoBlob: Blob; edit?: boolean }): Promise<Blob> {
  const prompt = input.edit ? editPrompt(input) : basePrompt(input)
  return postWear('avatar', prompt, [input.photoBlob])
}

const FLAT_KEEP: Record<Category, string> = {
  top: '保留这件上衣的领、袖、下摆、颜色和图案。不要外套、裤子、裙子、鞋子。',
  dress: '保留这件连衣裙从领口到裙摆的完整样子。不要另外的上衣、外套、裤子、鞋子。',
  skirt: '保留这件裙子的腰头和裙摆。被上衣挡住的腰头按这条裙子补全。不要上衣、外套、裤子、鞋子。',
  pants: '保留这条裤子的腰头、裤腿、裤长、颜色和图案。被上衣挡住的腰头按这条裤子补全。不要上衣、外套、裙子、鞋子。',
  outer: '保留这件外套的领、袖、下摆、颜色和图案。不要里面的上衣、裤子、裙子、鞋子。',
  shoes: '只保留这一双鞋，左脚和右脚都在。不要裤脚、裙摆和其他衣服。',
  belt: '只保留这根腰带。不要上衣、裤子、裙子。',
  bag: '只保留这只包。不要身体、衣服和鞋子。',
  hat: '只保留这顶帽子。不要脸、头发和衣服。',
  scarf: '只保留这条围巾。不要衣服和身体。',
  glasses: '只保留这副眼镜。不要脸和衣服。',
  jewelry: '只保留这一件珠宝。不要身体和衣服。',
}

export function flatLayPrompt(category: Category, name: string): string {
  const label = CATEGORY_LABEL[category]
  const lines = [
    '把图1整理成一张白底平铺商品图。',
    '图1可能是穿着拍的、单独拍的，也可能是网店上身图。你自己判断单品在人身上、衣架上还是摊在地上。画面里常常还有别的单品。',
    `这次只要${label}。只保留这一件，正面展平。`,
    FLAT_KEEP[category],
    '不要人，不要衣架，不要原背景，不要文字，不要水印。背景是纯白。',
  ]
  const extra = name.trim()
  if (extra && extra !== label) lines.push(`用户补充的描述是「${extra}」，仍然只出${label}。`)
  return lines.join('\n')
}

export async function generateFlatLay(input: { category: Category; name: string; blob: Blob }): Promise<Blob> {
  return postWear('flatlay', flatLayPrompt(input.category, input.name), [input.blob])
}

const FIT_PLACE: Record<Category, string> = {
  top: '上衣的肩线落在图1肩膀的位置，袖子顺着图1的手臂，衣长跟图2。',
  dress: '连衣裙的肩线落在图1肩膀的位置，裙摆长度跟图2。',
  skirt: '裙腰落在图1的腰上，裙摆长度跟图2。',
  pants: '裤腰落在图1的腰上，裤腿顺着图1的腿，裤长跟图2。',
  outer: '外套的肩线落在图1肩膀上，穿在上衣外面的位置，衣长跟图2。',
  shoes: '鞋子穿进图1的脚里，盖住原来的脚趾。图2没有靴筒时不要画成长靴。',
  belt: '腰带系在图1腰上的位置。',
  bag: '模特用右手拎住提手，左手保持原样。包身完整垂在身体外侧。不要斜挎，不要只露出一小块。',
  hat: '帽子落在图1头顶的位置。',
  scarf: '围巾围在图1脖子的位置。',
  glasses: '眼镜戴在图1眼睛的位置。',
  jewelry: '项链落在图1脖子前面，手表或手链落在图1右手腕正面。只出现这一件。',
}

export function stickerPrompt(input: { name: string; category: Category }): string {
  if (input.category === 'shoes') {
    const title = input.name.includes('/') ? '这双鞋' : input.name
    return [
      '在图1上改图。图1是个人模特，输出必须和图1是同一张画面。',
      '脸、五官、头发、表情、身材、站姿、腿、画面裁切和背景都保持图1。禁止重画脸，禁止换姿势，禁止换背景。',
      `图2是「${title}」的商品图，经常是从上往下拍的。不要把这张俯拍图原样竖着贴在脚前面。`,
      '把鞋子穿进图1的两只脚里，左脚一只、右脚一只。鞋头方向跟图1的脚尖一致，鞋跟落在脚后跟。',
      '鞋面要盖住原来的脚趾和脚面，原来的脚趾不要再露出来。鞋子的大小刚好包住脚。',
      '图2没有高出脚踝的靴筒时，鞋子只到脚踝，不要盖住小腿，不要画成长靴。只有图2本身是短靴或长靴时，靴筒高度才跟图2。',
      '除了两只脚上的鞋子，其余都保持图1。不要文字，不要水印，不要其他人。',
    ].join('\n')
  }
  if (input.category === 'bag') {
    return [
      '在图1上改图。图1是个人模特，输出必须和图1是同一张画面。',
      '脸、五官、肤色、头发、表情、身材、站姿、左手、画面裁切和背景都保持图1。禁止重画脸，禁止重画身体，禁止换背景。',
      `图2是「${input.name}」。模特只用右手拎住这只包的提手，右手可以握住提手。`,
      '包身按提手垂下来，完整、清楚，挂在身体外侧。不要斜挎，不要把包缩成一小块，不要把图2原样贴上去。',
      '除了右手和这只包，其余都保持图1。不要文字，不要水印，不要其他人。',
    ].join('\n')
  }
  return [
    '在图1上改图。图1是个人模特，输出必须和图1是同一张画面。',
    '脸、五官、肤色、头发、表情、身材、皮肤、站姿、手脚摆法、画面裁切和背景都保持图1。禁止重画脸，禁止重画身体，禁止换姿势，禁止换背景。',
    `图2是「${input.name}」的白底平铺商品图。只把这一件穿到图1身上，替换原来挡住的衣服。`,
    '衣服按图1的肩、腰、手脚变形。不要把图2原样缩小后贴上去。',
    FIT_PLACE[input.category],
    '除了这件新衣服盖住的区域，其余都保持图1。不要文字，不要水印，不要其他人。',
  ].join('\n')
}

async function mapWornToBody(bodyBlob: Blob, wornBlob: Blob): Promise<Blob> {
  const body = await createImageBitmap(bodyBlob)
  const worn = await createImageBitmap(wornBlob)
  const sent = fittedFrame(body.width, body.height, 1024)
  const canvas = document.createElement('canvas')
  canvas.width = body.width
  canvas.height = body.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布不可用')
  const ox = (sent.canvasW - sent.drawW) / 2
  const oy = (sent.canvasH - sent.drawH) / 2
  ctx.drawImage(
    worn,
    (ox / sent.canvasW) * worn.width,
    (oy / sent.canvasH) * worn.height,
    (sent.drawW / sent.canvasW) * worn.width,
    (sent.drawH / sent.canvasH) * worn.height,
    0,
    0,
    body.width,
    body.height,
  )
  body.close()
  worn.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('图片没有准备好')
  return blob
}

export async function generateGarmentSticker(input: {
  bodyBlob: Blob
  productBlob: Blob
  category: Category
  name: string
  marks: BodyMarks
}): Promise<{ stickerBlob: Blob; stickerFrame: StickerFrame }> {
  const worn = await postWear('fitted-layer', stickerPrompt(input), [input.bodyBlob, input.productBlob])
  const aligned = await mapWornToBody(input.bodyBlob, worn)
  return extractWornGarment(input.bodyBlob, aligned, input.productBlob, input.marks, input.category)
}

export async function generateWearPhoto(input: WearInput): Promise<Blob> {
  if (!input.person) throw new Error('先用全身照生成个人模特，再做全身效果。')
  if (input.pieces.length === 0) throw new Error('没有衣服')
  const garmentCap = maxGarments()
  if (input.pieces.length > garmentCap) throw new Error(`这套单品超过 ${garmentCap} 件。一次最多再加上 ${garmentCap} 张衣服图，请先拿下几件。`)
  return postWear('outfit', promptFor(input), [input.bodyBlob, ...input.pieces.map((piece) => piece.blob)])
}
