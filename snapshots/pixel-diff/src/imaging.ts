import type { Adjustments, BodyMarks, BodyType, Category, Point, StickerFrame } from './types.ts'
export type { StickerFrame }
import { ZERO_ADJUSTMENTS } from './types.ts'
import { detectMarks, segmentPerson } from './vision.ts'

export const FRAME_W = 768
export const FRAME_H = 1152

const CONTENT = { x: 64, y: 42, w: FRAME_W - 128, h: FRAME_H - 96 }

export function presetFor(bodyType: BodyType): Adjustments {
  if (bodyType === 'pear') return { shoulder: -10, waist: 4, hip: 18, leg: 0 }
  if (bodyType === 'hourglass') return { shoulder: 4, waist: -18, hip: 12, leg: 2 }
  if (bodyType === 'apple') return { shoulder: 6, waist: 16, hip: -4, leg: 0 }
  return { ...ZERO_ADJUSTMENTS }
}

export function transparentFrame(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_W
  canvas.height = FRAME_H
  return canvas
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('图片导出失败'))
    }, 'image/png')
  })
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取图片')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

export async function fileToCanvas(file: File, maxEdge = 1400): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取图片')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

type Bounds = { x: number; y: number; w: number; h: number }

function alphaBounds(source: HTMLCanvasElement, threshold = 16): Bounds | null {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const image = context.getImageData(0, 0, source.width, source.height)
  const pixels = image.data
  let minX = source.width
  let minY = source.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function trimAlpha(source: HTMLCanvasElement, padding = 8): HTMLCanvasElement {
  const bounds = alphaBounds(source, 12)
  if (!bounds) return source
  const fullyOpaque = bounds.w === source.width && bounds.h === source.height
  if (fullyOpaque && padding === 0) return source
  const canvas = document.createElement('canvas')
  const x = Math.max(0, bounds.x - padding)
  const y = Math.max(0, bounds.y - padding)
  const right = Math.min(source.width, bounds.x + bounds.w + padding)
  const bottom = Math.min(source.height, bounds.y + bounds.h + padding)
  canvas.width = Math.max(1, right - x)
  canvas.height = Math.max(1, bottom - y)
  const context = canvas.getContext('2d')
  if (!context) return source
  context.drawImage(source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

function drawContain(dest: HTMLCanvasElement, source: HTMLCanvasElement, box: Bounds) {
  const context = dest.getContext('2d')
  if (!context) return
  const scale = Math.min(box.w / source.width, box.h / source.height)
  const width = source.width * scale
  const height = source.height * scale
  const x = box.x + (box.w - width) / 2
  const y = box.y + (box.h - height) / 2
  context.drawImage(source, x, y, width, height)
}

export function fitImageToFrame(
  source: HTMLCanvasElement,
  marks: BodyMarks,
): { canvas: HTMLCanvasElement; marks: BodyMarks } {
  const scale = Math.min(FRAME_W / source.width, FRAME_H / source.height)
  const width = source.width * scale
  const height = source.height * scale
  const dx = (FRAME_W - width) / 2
  const dy = (FRAME_H - height) / 2
  const canvas = transparentFrame()
  const context = canvas.getContext('2d')
  if (!context) return { canvas, marks }
  context.drawImage(source, 0, 0, 1, source.height, 0, dy, Math.ceil(dx), height)
  context.drawImage(
    source,
    source.width - 1,
    0,
    1,
    source.height,
    Math.floor(dx + width),
    dy,
    FRAME_W - Math.floor(dx + width),
    height,
  )
  context.drawImage(source, dx, dy, width, height)
  const keys = Object.keys(marks) as (keyof BodyMarks)[]
  const fitted = {} as BodyMarks
  for (const key of keys) {
    fitted[key] = { x: dx + marks[key].x * scale, y: dy + marks[key].y * scale }
  }
  return { canvas, marks: fitted }
}

export function paintStudio(person: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = transparentFrame()
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const gradient = context.createLinearGradient(0, 0, 0, FRAME_H)
  gradient.addColorStop(0, '#e7e1d6')
  gradient.addColorStop(0.72, '#ddd4c6')
  gradient.addColorStop(1, '#cfc4b4')
  context.fillStyle = gradient
  context.fillRect(0, 0, FRAME_W, FRAME_H)
  context.fillStyle = 'rgba(70, 52, 36, 0.08)'
  context.beginPath()
  context.ellipse(FRAME_W / 2, FRAME_H * 0.93, 180, 18, 0, 0, Math.PI * 2)
  context.fill()
  context.drawImage(person, 0, 0)
  return canvas
}

function guessMarks(source: HTMLCanvasElement): BodyMarks {
  const bounds = alphaBounds(source, 12) ?? { x: CONTENT.x, y: CONTENT.y, w: CONTENT.w, h: CONTENT.h }
  const cx = bounds.x + bounds.w / 2
  const top = bounds.y
  const width = bounds.w
  const height = bounds.h
  const at = (xFactor: number, yFactor: number): Point => ({
    x: cx + xFactor * width,
    y: top + yFactor * height,
  })
  return {
    nose: at(0, 0.1),
    neck: at(0, 0.16),
    lShoulder: at(-0.18, 0.2),
    rShoulder: at(0.18, 0.2),
    lElbow: at(-0.26, 0.34),
    rElbow: at(0.26, 0.34),
    lWrist: at(-0.28, 0.46),
    rWrist: at(0.28, 0.46),
    lHip: at(-0.11, 0.48),
    rHip: at(0.11, 0.48),
    lKnee: at(-0.1, 0.7),
    rKnee: at(0.1, 0.7),
    lAnkle: at(-0.09, 0.96),
    rAnkle: at(0.09, 0.96),
  }
}

export type PreparedBody = {
  sourceBlob: Blob
  normalizedBlob: Blob
  normalizedMarks: BodyMarks
  segmented: boolean
  posed: boolean
}

export async function prepareFromFile(file: File): Promise<PreparedBody> {
  const sourceCanvas = await fileToCanvas(file, 1400)
  const sourceBlob = await canvasToPng(sourceCanvas)
  let working = sourceCanvas
  let segmented = false
  try {
    const segmentedCanvas = await segmentPerson(sourceCanvas)
    if (segmentedCanvas) {
      working = segmentedCanvas
      segmented = true
    }
  } catch {
    segmented = false
  }

  const trimmed = trimAlpha(working, segmented ? 6 : 0)
  const normalized = transparentFrame()
  drawContain(normalized, trimmed, CONTENT)
  let marks: BodyMarks | null = null
  let posed = false
  try {
    marks = await detectMarks(paintStudio(normalized))
    posed = Boolean(marks)
  } catch {
    posed = false
  }
  if (!marks) marks = guessMarks(normalized)
  return {
    sourceBlob,
    normalizedBlob: await canvasToPng(normalized),
    normalizedMarks: marks,
    segmented,
    posed,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1)
  return t * t * (3 - 2 * t)
}

function gauss(value: number, center: number, sigma: number): number {
  const d = (value - center) / sigma
  return Math.exp(-d * d)
}

function orientMarks(marks: BodyMarks): BodyMarks {
  const next = { ...marks }
  if (next.lShoulder.x > next.rShoulder.x) {
    ;[next.lShoulder, next.rShoulder] = [next.rShoulder, next.lShoulder]
    ;[next.lElbow, next.rElbow] = [next.rElbow, next.lElbow]
    ;[next.lWrist, next.rWrist] = [next.rWrist, next.lWrist]
  }
  if (next.lHip.x > next.rHip.x) {
    ;[next.lHip, next.rHip] = [next.rHip, next.lHip]
    ;[next.lKnee, next.rKnee] = [next.rKnee, next.lKnee]
    ;[next.lAnkle, next.rAnkle] = [next.rAnkle, next.lAnkle]
  }
  return next
}

type WarpField = {
  lateral: (y: number) => number
  centerX: (y: number) => number
  srcY: (dstY: number) => number
  dstY: (srcY: number) => number
  hipY: number
  outputHeight: number
}

function buildField(marks: BodyMarks, adjustments: Adjustments, sourceHeight: number): WarpField {
  const shoulder = clamp(adjustments.shoulder, -40, 40) / 115
  const waist = clamp(adjustments.waist, -40, 40) / 115
  const hip = clamp(adjustments.hip, -40, 40) / 115
  const legScale = 1 + clamp(adjustments.leg, -40, 40) / 145
  const shoulderY = (marks.lShoulder.y + marks.rShoulder.y) / 2
  const hipY = (marks.lHip.y + marks.rHip.y) / 2
  const ankleY = Math.max(marks.lAnkle.y, marks.rAnkle.y)
  const waistY = shoulderY + (hipY - shoulderY) * 0.52
  const noseY = marks.nose.y
  const shoulderMidX = (marks.lShoulder.x + marks.rShoulder.x) / 2
  const hipMidX = (marks.lHip.x + marks.rHip.x) / 2
  const ankleMidX = (marks.lAnkle.x + marks.rAnkle.x) / 2

  const centerX = (y: number) => {
    if (y <= hipY) {
      const t = clamp((y - shoulderY) / (hipY - shoulderY || 1), 0, 1)
      return shoulderMidX + (hipMidX - shoulderMidX) * t
    }
    const t = clamp((y - hipY) / (ankleY - hipY || 1), 0, 1)
    return hipMidX + (ankleMidX - hipMidX) * t
  }

  const lateral = (y: number) => {
    const ws = gauss(y, shoulderY, 78)
    const ww = gauss(y, waistY, 86)
    const wh = gauss(y, hipY, 96)
    const extra = (shoulder * ws + waist * ww + hip * wh) / (ws + ww + wh || 1)
    return 1 + extra * smoothstep(noseY - 10, shoulderY, y)
  }

  const srcY = (dstY: number) => (dstY <= hipY ? dstY : hipY + (dstY - hipY) / legScale)
  const dstY = (y: number) => (y <= hipY ? y : hipY + (y - hipY) * legScale)
  const extra = Math.max(0, (sourceHeight - hipY) * (legScale - 1))
  return { lateral, centerX, srcY, dstY, hipY, outputHeight: Math.ceil(sourceHeight + extra) }
}

function samplePixel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= width || y >= height) return [0, 0, 0, 0]
  const x0 = Math.min(width - 1, Math.floor(x))
  const y0 = Math.min(height - 1, Math.floor(y))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const index = (row: number, col: number) => (row * width + col) * 4
  const i00 = index(y0, x0)
  const i10 = index(y0, x1)
  const i01 = index(y1, x0)
  const i11 = index(y1, x1)
  const mix = (channel: number) => {
    const top = pixels[i00 + channel] * (1 - tx) + pixels[i10 + channel] * tx
    const bottom = pixels[i01 + channel] * (1 - tx) + pixels[i11 + channel] * tx
    return top * (1 - ty) + bottom * ty
  }
  return [mix(0), mix(1), mix(2), mix(3)]
}

function warpPerson(
  source: HTMLCanvasElement,
  marks: BodyMarks,
  adjustments: Adjustments,
): { canvas: HTMLCanvasElement; marks: BodyMarks } {
  const oriented = orientMarks(marks)
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return { canvas: source, marks: oriented }
  const input = context.getImageData(0, 0, source.width, source.height)
  const field = buildField(oriented, adjustments, source.height)
  const output = document.createElement('canvas')
  output.width = source.width
  output.height = field.outputHeight
  const outContext = output.getContext('2d', { willReadFrequently: true })
  if (!outContext) return { canvas: source, marks: oriented }
  const image = outContext.createImageData(output.width, output.height)
  const pixels = image.data

  for (let y = 0; y < output.height; y += 1) {
    const srcY = field.srcY(y)
    const scale = field.lateral(srcY)
    const center = field.centerX(srcY)
    for (let x = 0; x < output.width; x += 1) {
      const srcX = center + (x - center) / (scale || 1)
      const [r, g, b, a] = samplePixel(input.data, source.width, source.height, srcX, srcY)
      const offset = (y * output.width + x) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = a
    }
  }
  outContext.putImageData(image, 0, 0)

  const mapPoint = (point: Point): Point => {
    const scale = field.lateral(point.y)
    const center = field.centerX(point.y)
    return {
      x: center + (point.x - center) * scale,
      y: field.dstY(point.y),
    }
  }
  const keys = Object.keys(oriented) as (keyof BodyMarks)[]
  const mapped = {} as BodyMarks
  for (const key of keys) mapped[key] = mapPoint(oriented[key])
  return { canvas: output, marks: mapped }
}

function fitIntoFrame(person: HTMLCanvasElement, marks: BodyMarks): { canvas: HTMLCanvasElement; marks: BodyMarks } {
  const bounds = alphaBounds(person, 18)
  const frame = transparentFrame()
  if (!bounds) return { canvas: frame, marks }
  const scale = Math.min(CONTENT.w / bounds.w, CONTENT.h / bounds.h)
  const dx = CONTENT.x + (CONTENT.w - bounds.w * scale) / 2 - bounds.x * scale
  const dy = CONTENT.y + (CONTENT.h - bounds.h * scale) / 2 - bounds.y * scale
  const context = frame.getContext('2d')
  if (!context) return { canvas: frame, marks }
  context.setTransform(scale, 0, 0, scale, dx, dy)
  context.drawImage(person, 0, 0)
  const mapPoint = (point: Point): Point => ({ x: point.x * scale + dx, y: point.y * scale + dy })
  const keys = Object.keys(marks) as (keyof BodyMarks)[]
  const fitted = {} as BodyMarks
  for (const key of keys) fitted[key] = mapPoint(marks[key])
  return { canvas: frame, marks: fitted }
}

function placeWarpedStudio(
  person: HTMLCanvasElement,
  marks: BodyMarks,
): { canvas: HTMLCanvasElement; marks: BodyMarks } {
  if (person.width === FRAME_W && person.height === FRAME_H) return { canvas: person, marks }
  const scale = Math.min(FRAME_W / person.width, FRAME_H / person.height)
  const width = person.width * scale
  const height = person.height * scale
  const dx = (FRAME_W - width) / 2
  const dy = (FRAME_H - height) / 2
  const canvas = transparentFrame()
  const context = canvas.getContext('2d')
  if (!context) return { canvas: person, marks }
  context.drawImage(person, 0, 0, 1, person.height, 0, dy, Math.ceil(dx) + 1, height)
  context.drawImage(
    person,
    person.width - 1,
    0,
    1,
    person.height,
    Math.floor(dx + width) - 1,
    dy,
    FRAME_W - Math.floor(dx + width) + 1,
    height,
  )
  context.drawImage(person, dx, dy, width, height)
  const keys = Object.keys(marks) as (keyof BodyMarks)[]
  const fitted = {} as BodyMarks
  for (const key of keys) fitted[key] = { x: marks[key].x * scale + dx, y: marks[key].y * scale + dy }
  return { canvas, marks: fitted }
}

export async function renderAdjusted(
  normalizedBlob: Blob,
  marks: BodyMarks,
  adjustments: Adjustments,
  options?: { studio?: boolean },
): Promise<{ imageBlob: Blob; marks: BodyMarks }> {
  const normalized = await blobToCanvas(normalizedBlob)
  const warped = warpPerson(normalized, marks, adjustments)
  if (options?.studio) {
    const placed = placeWarpedStudio(warped.canvas, warped.marks)
    return { imageBlob: await canvasToPng(placed.canvas), marks: placed.marks }
  }
  const fitted = fitIntoFrame(warped.canvas, warped.marks)
  const studio = paintStudio(fitted.canvas)
  return { imageBlob: await canvasToPng(studio), marks: fitted.marks }
}

type Rgb = [number, number, number]

function medianChannel(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 255
}

export function removeSolidBackground(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; removedRatio: number } {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { canvas: source, removedRatio: 0 }
  context.drawImage(source, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  const width = canvas.width
  const height = canvas.height
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48))
  const take = (x: number, y: number) => {
    const index = (y * width + x) * 4
    reds.push(pixels[index])
    greens.push(pixels[index + 1])
    blues.push(pixels[index + 2])
  }
  for (let x = 0; x < width; x += step) {
    take(x, 0)
    take(x, height - 1)
  }
  for (let y = 0; y < height; y += step) {
    take(0, y)
    take(width - 1, y)
  }
  const background: Rgb = [medianChannel(reds), medianChannel(greens), medianChannel(blues)]
  const threshold = 48
  const seen = new Uint8Array(width * height)
  const queueX = new Int32Array(width * height)
  const queueY = new Int32Array(width * height)
  let head = 0
  let tail = 0
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = y * width + x
    if (seen[index]) return
    seen[index] = 1
    queueX[tail] = x
    queueY[tail] = y
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }
  let removed = 0
  while (head < tail) {
    const x = queueX[head]
    const y = queueY[head]
    head += 1
    const index = (y * width + x) * 4
    const distance =
      Math.abs(pixels[index] - background[0]) +
      Math.abs(pixels[index + 1] - background[1]) +
      Math.abs(pixels[index + 2] - background[2])
    if (distance > threshold) continue
    pixels[index + 3] = 0
    removed += 1
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
  }
  context.putImageData(image, 0, 0)
  return { canvas, removedRatio: removed / (width * height) }
}

export function dominantColor(source: HTMLCanvasElement): string {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return '#c8bfb2'
  const image = context.getImageData(0, 0, source.width, source.height)
  const pixels = image.data
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
  for (let index = 0; index < pixels.length; index += 16) {
    const alpha = pixels[index + 3]
    if (alpha < 180) continue
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    if (r > 242 && g > 242 && b > 242) continue
    const key = `${r >> 4},${g >> 4},${b >> 4}`
    const current = buckets.get(key)
    if (current) current.count += 1
    else buckets.set(key, { count: 1, r, g, b })
  }
  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket
  }
  if (!best) return '#c8bfb2'
  const hex = (value: number) => value.toString(16).padStart(2, '0')
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`
}

export async function prepareGarment(file: File): Promise<{ cutoutBlob: Blob; originalBlob: Blob; color: string; keptBackground: boolean }> {
  const source = await fileToCanvas(file, 1200)
  const removed = removeSolidBackground(source)
  const keptBackground = removed.removedRatio < 0.06 || removed.removedRatio > 0.9
  const chosen = keptBackground ? source : removed.canvas
  const trimmed = trimAlpha(chosen, keptBackground ? 0 : 4)
  return {
    cutoutBlob: await canvasToPng(trimmed),
    originalBlob: file,
    color: dominantColor(trimmed),
    keptBackground,
  }
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  s0: Point,
  s1: Point,
  s2: Point,
  d0: Point,
  d1: Point,
  d2: Point,
) {
  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(denom) < 0.001) return
  const coeff = (x0: number, x1: number, x2: number) =>
    (x0 * (s1.y - s2.y) + x1 * (s2.y - s0.y) + x2 * (s0.y - s1.y)) / denom
  const cross = (x0: number, x1: number, x2: number) =>
    (x0 * (s2.x - s1.x) + x1 * (s0.x - s2.x) + x2 * (s1.x - s0.x)) / denom
  const offset = (x0: number, x1: number, x2: number) =>
    (x0 * (s1.x * s2.y - s2.x * s1.y) +
      x1 * (s2.x * s0.y - s0.x * s2.y) +
      x2 * (s0.x * s1.y - s1.x * s0.y)) /
    denom
  const cx = (d0.x + d1.x + d2.x) / 3
  const cy = (d0.y + d1.y + d2.y) / 3
  const grow = (point: Point): Point => {
    const dx = point.x - cx
    const dy = point.y - cy
    const length = Math.hypot(dx, dy) || 1
    return { x: point.x + (dx / length) * 1.6, y: point.y + (dy / length) * 1.6 }
  }
  const c0 = grow(d0)
  const c1 = grow(d1)
  const c2 = grow(d2)
  context.save()
  context.beginPath()
  context.moveTo(c0.x, c0.y)
  context.lineTo(c1.x, c1.y)
  context.lineTo(c2.x, c2.y)
  context.closePath()
  context.clip()
  context.transform(
    coeff(d0.x, d1.x, d2.x),
    coeff(d0.y, d1.y, d2.y),
    cross(d0.x, d1.x, d2.x),
    cross(d0.y, d1.y, d2.y),
    offset(d0.x, d1.x, d2.x),
    offset(d0.y, d1.y, d2.y),
  )
  context.drawImage(image, 0, 0)
  context.restore()
}

function paintMesh(context: CanvasRenderingContext2D, image: HTMLCanvasElement, grid: Point[][]) {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows < 2 || cols < 2) return
  const width = image.width
  const height = image.height
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const u0 = col / (cols - 1)
      const u1 = (col + 1) / (cols - 1)
      const v0 = row / (rows - 1)
      const v1 = (row + 1) / (rows - 1)
      const s00 = { x: u0 * width, y: v0 * height }
      const s10 = { x: u1 * width, y: v0 * height }
      const s01 = { x: u0 * width, y: v1 * height }
      const s11 = { x: u1 * width, y: v1 * height }
      const d00 = grid[row][col]
      const d10 = grid[row][col + 1]
      const d01 = grid[row + 1][col]
      const d11 = grid[row + 1][col + 1]
      drawTexturedTriangle(context, image, s00, s10, s01, d00, d10, d01)
      drawTexturedTriangle(context, image, s10, s11, s01, d10, d11, d01)
    }
  }
}

function quadPoint(a: Point, b: Point, c: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
  }
}

function gridBetween(
  left0: Point,
  left1: Point,
  left2: Point,
  right0: Point,
  right1: Point,
  right2: Point,
  rows = 10,
  cols = 8,
): Point[][] {
  const grid: Point[][] = []
  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1)
    const left = quadPoint(left0, left1, left2, t)
    const right = quadPoint(right0, right1, right2, t)
    const line: Point[] = []
    for (let col = 0; col < cols; col += 1) {
      const v = col / (cols - 1)
      line.push({ x: left.x + (right.x - left.x) * v, y: left.y + (right.y - left.y) * v })
    }
    grid.push(line)
  }
  return grid
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function rectGrid(x: number, y: number, width: number, height: number): Point[][] {
  return gridBetween(
    { x, y },
    { x, y: y + height / 2 },
    { x, y: y + height },
    { x: x + width, y },
    { x: x + width, y: y + height / 2 },
    { x: x + width, y: y + height },
  )
}

function garmentGrid(marks: BodyMarks, category: Category): Point[][] {
  const hipY = (marks.lHip.y + marks.rHip.y) / 2
  const shoulderW = Math.hypot(marks.rShoulder.x - marks.lShoulder.x, marks.rShoulder.y - marks.lShoulder.y)
  const center = midpoint(marks.lShoulder, marks.rShoulder)

  if (category === 'hat') {
    const rise = Math.max(70, (marks.neck.y - marks.nose.y) * 1.6)
    return rectGrid(marks.nose.x - rise * 0.7, marks.nose.y - rise * 1.35, rise * 1.4, rise * 0.9)
  }
  if (category === 'scarf') {
    return rectGrid(center.x - shoulderW * 0.34, marks.neck.y - 18, shoulderW * 0.68, shoulderW * 0.42)
  }
  if (category === 'necklace') {
    return rectGrid(center.x - shoulderW * 0.16, marks.neck.y + 4, shoulderW * 0.32, shoulderW * 0.28)
  }
  if (category === 'belt') {
    return rectGrid(center.x - shoulderW * 0.28, hipY - 16, shoulderW * 0.56, 28)
  }
  if (category === 'watch') {
    return rectGrid(marks.lWrist.x - 22, marks.lWrist.y - 16, 44, 32)
  }
  if (category === 'bag') {
    return rectGrid(marks.rHip.x + 6, marks.rHip.y - 8, shoulderW * 0.42, shoulderW * 0.55)
  }
  if (category === 'shoes') {
    const y = Math.max(marks.lAnkle.y, marks.rAnkle.y) - 6
    const left = Math.min(marks.lAnkle.x, marks.rAnkle.x) - 28
    const right = Math.max(marks.lAnkle.x, marks.rAnkle.x) + 28
    return rectGrid(left, y, Math.max(48, right - left), 58)
  }

  if (category === 'bottom') {
    const topLift = 28
    return gridBetween(
      { x: marks.lHip.x - 48, y: marks.lHip.y - topLift },
      { x: marks.lKnee.x - 34, y: marks.lKnee.y },
      { x: marks.lAnkle.x - 18, y: marks.lAnkle.y + 28 },
      { x: marks.rHip.x + 48, y: marks.rHip.y - topLift },
      { x: marks.rKnee.x + 34, y: marks.rKnee.y },
      { x: marks.rAnkle.x + 18, y: marks.rAnkle.y + 28 },
    )
  }

  const kneeY = (marks.lKnee.y + marks.rKnee.y) / 2
  const topY = Math.min(marks.lShoulder.y, marks.rShoulder.y) - 22
  const bottomY = category === 'outer' ? hipY + (kneeY - hipY) * 0.58 : hipY + 24
  const waistY = topY + (bottomY - topY) * 0.46
  const topHalf = shoulderW * (category === 'outer' ? 0.64 : 0.56)
  const waistHalf = shoulderW * (category === 'outer' ? 0.58 : 0.5)
  const bottomHalf = shoulderW * (category === 'outer' ? 0.6 : 0.48)
  return gridBetween(
    { x: center.x - topHalf, y: topY },
    { x: center.x - waistHalf, y: waistY },
    { x: center.x - bottomHalf, y: bottomY },
    { x: center.x + topHalf, y: topY },
    { x: center.x + waistHalf, y: waistY },
    { x: center.x + bottomHalf, y: bottomY },
  )
}

const DRAW_ORDER: Category[] = [
  'shoes',
  'bottom',
  'top',
  'belt',
  'outer',
  'scarf',
  'necklace',
  'hat',
  'watch',
  'bag',
]

function cropImage(image: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  canvas.getContext('2d')?.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)
  return canvas
}

function wearMeasures(marks: BodyMarks) {
  const shoulderY = (marks.lShoulder.y + marks.rShoulder.y) / 2
  const hipY = (marks.lHip.y + marks.rHip.y) / 2
  const kneeY = (marks.lKnee.y + marks.rKnee.y) / 2
  const ankleY = Math.max(marks.lAnkle.y, marks.rAnkle.y)
  const shoulderW = Math.hypot(marks.rShoulder.x - marks.lShoulder.x, marks.rShoulder.y - marks.lShoulder.y)
  const centerX = (marks.lShoulder.x + marks.rShoulder.x) / 2
  const waistY = hipY + (shoulderY - hipY) * 0.42
  return { shoulderY, hipY, kneeY, ankleY, shoulderW, centerX, waistY }
}

function bandSpan(image: HTMLCanvasElement, from: number, to: number): number {
  const context = image.getContext('2d', { willReadFrequently: true })
  if (!context || image.width < 2 || image.height < 2) return image.width
  const data = context.getImageData(0, 0, image.width, image.height).data
  const start = Math.max(0, Math.floor(image.height * from))
  const end = Math.min(image.height, Math.max(start + 1, Math.floor(image.height * to)))
  const step = Math.max(1, Math.floor((end - start) / 8))
  const widths: number[] = []
  for (let y = start; y < end; y += step) {
    const row = y * image.width
    let left = -1
    let right = -1
    for (let x = 0; x < image.width; x += 1) {
      if (data[(row + x) * 4 + 3] > 24) {
        left = x
        break
      }
    }
    for (let x = image.width - 1; x >= 0; x -= 1) {
      if (data[(row + x) * 4 + 3] > 24) {
        right = x
        break
      }
    }
    if (left >= 0 && right > left + 2) widths.push(right - left)
  }
  if (widths.length === 0) return image.width
  widths.sort((a, b) => a - b)
  return widths[Math.floor((widths.length - 1) * 0.7)]
}

function paintFitted(
  context: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  scale: number,
  sourceHeight = image.height,
) {
  const height = Math.max(1, Math.min(image.height, sourceHeight))
  context.drawImage(image, 0, 0, image.width, height, x, y, image.width * scale, height * scale)
}

type LaidSticker = { frame: StickerFrame; sourceHeight: number }

function layoutWornTop(image: HTMLCanvasElement, marks: BodyMarks, category: Category): LaidSticker {
  const measure = wearMeasures(marks)
  const upper = bandSpan(image, 0.05, 0.28)
  const lower = bandSpan(image, 0.4, 0.78)
  const flared = lower > upper * 1.16 && upper < image.width * 0.9
  const content = flared ? Math.max(upper, image.width * 0.4) : image.width
  const ease = category === 'outer' ? 1.12 : 1.16
  let scale = (measure.shoulderW * ease) / content
  const widthCap = measure.shoulderW * (category === 'outer' ? 1.72 : 1.48)
  if (image.width * scale > widthCap) scale = widthCap / image.width
  if (image.width * scale < measure.shoulderW) scale = measure.shoulderW / image.width
  if (category === 'outer') {
    const thighY = measure.hipY + (measure.kneeY - measure.hipY) * 0.5
    const lengthScale = Math.max(48, thighY - measure.shoulderY) / image.height
    if (lengthScale > scale) scale = Math.min(lengthScale, scale * 1.12)
  }
  const width = image.width * scale
  const height = image.height * scale
  return {
    frame: { x: measure.centerX - width / 2, y: measure.shoulderY - height * 0.08, width, height },
    sourceHeight: image.height,
  }
}

function layoutWornBottom(image: HTMLCanvasElement, marks: BodyMarks): LaidSticker {
  const measure = wearMeasures(marks)
  const hipJoint = Math.hypot(marks.rHip.x - marks.lHip.x, marks.rHip.y - marks.lHip.y)
  const hipTarget = Math.max(hipJoint * 1.22, measure.shoulderW * 0.7)
  const waistBand = bandSpan(image, 0.02, 0.2)
  const waistContent = waistBand < image.width * 0.38 ? Math.max(waistBand, image.width * 0.48) : waistBand
  const aspect = image.height / image.width
  const leg = Math.max(48, measure.ankleY - measure.waistY)
  const hipScale = hipTarget / waistContent
  let scale = hipScale
  let sourceHeight = image.height
  if (aspect < 1.15) {
    const kneeLimit = measure.kneeY - (measure.kneeY - measure.hipY) * 0.08
    const maxH = Math.max(36, kneeLimit - measure.waistY)
    if (image.height * scale > maxH) scale = maxH / image.height
  } else if (aspect >= 1.55 && image.height * hipScale < leg * 0.92) {
    const ankleScale = leg / image.height
    const widest = (hipTarget * 1.7) / waistContent
    scale = Math.min(ankleScale, Math.max(hipScale, widest))
    if (image.height * scale > leg) sourceHeight = leg / scale
  } else if (image.height * scale > leg) {
    sourceHeight = leg / scale
  }
  const width = image.width * scale
  const center = (marks.lHip.x + marks.rHip.x) / 2
  return {
    frame: { x: center - width / 2, y: measure.waistY, width, height: sourceHeight * scale },
    sourceHeight,
  }
}

function layoutWornShoes(image: HTMLCanvasElement, marks: BodyMarks): LaidSticker {
  const measure = wearMeasures(marks)
  const shoeH = Math.max(78, (measure.ankleY - measure.hipY) * 0.22)
  const span = Math.abs(marks.rAnkle.x - marks.lAnkle.x)
  const shoeW = Math.max(span + shoeH * 1.2, shoeH * 1.8)
  const scale = Math.min(shoeW / image.width, shoeH / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const center = (marks.lAnkle.x + marks.rAnkle.x) / 2
  const ankleY = Math.max(marks.lAnkle.y, marks.rAnkle.y)
  return { frame: { x: center - width / 2, y: ankleY - height * 0.72, width, height }, sourceHeight: image.height }
}

function layoutMesh(image: HTMLCanvasElement, marks: BodyMarks, category: Category): LaidSticker {
  const grid = garmentGrid(marks, category).flat()
  const left = Math.min(...grid.map((point) => point.x))
  const top = Math.min(...grid.map((point) => point.y))
  const boxW = Math.max(...grid.map((point) => point.x)) - left
  const boxH = Math.max(...grid.map((point) => point.y)) - top
  const scale = Math.min(boxW / image.width, boxH / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return {
    frame: { x: left + (boxW - width) / 2, y: top + (boxH - height) / 2, width, height },
    sourceHeight: image.height,
  }
}

function layoutSticker(image: HTMLCanvasElement, marks: BodyMarks, category: Category): LaidSticker {
  if (category === 'top' || category === 'outer') return layoutWornTop(image, marks, category)
  if (category === 'bottom') return layoutWornBottom(image, marks)
  if (category === 'shoes') return layoutWornShoes(image, marks)
  return layoutMesh(image, marks, category)
}

function paintWornTop(context: CanvasRenderingContext2D, image: HTMLCanvasElement, marks: BodyMarks, category: Category) {
  const laid = layoutWornTop(image, marks, category)
  paintFitted(context, image, laid.frame.x, laid.frame.y, laid.frame.width / image.width, laid.sourceHeight)
}

function paintWornBottom(context: CanvasRenderingContext2D, image: HTMLCanvasElement, marks: BodyMarks) {
  const laid = layoutWornBottom(image, marks)
  paintFitted(context, image, laid.frame.x, laid.frame.y, laid.frame.width / image.width, laid.sourceHeight)
}

function paintWornShoes(context: CanvasRenderingContext2D, image: HTMLCanvasElement, marks: BodyMarks) {
  const measure = wearMeasures(marks)
  const shoeH = Math.max(78, (measure.ankleY - measure.hipY) * 0.2)
  const shoeW = shoeH * 1.55
  const pair = image.width > image.height * 1.25
  const place = (source: HTMLCanvasElement, ankle: Point) => {
    const scale = Math.min(shoeW / source.width, shoeH / source.height)
    const width = source.width * scale
    const height = source.height * scale
    context.drawImage(source, ankle.x - width / 2, ankle.y - height * 0.42, width, height)
  }
  if (pair) {
    place(cropImage(image, 0, 0, image.width / 2, image.height), marks.lAnkle)
    place(cropImage(image, image.width / 2, 0, image.width / 2, image.height), marks.rAnkle)
  } else {
    place(image, marks.lAnkle)
    place(image, marks.rAnkle)
  }
}

function cutHeadAndHands(context: CanvasRenderingContext2D, marks: BodyMarks, person: boolean) {
  const shoulderW = Math.hypot(marks.rShoulder.x - marks.lShoulder.x, marks.rShoulder.y - marks.lShoulder.y)
  const face = Math.max(36, marks.neck.y - marks.nose.y)
  const rise = person ? face * 1.2 : Math.max(48, face * 1.45)
  const cx = marks.nose.x
  const cy = person ? marks.nose.y - face * 0.15 : marks.nose.y - rise * 0.12
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.beginPath()
  context.ellipse(cx, cy, person ? face * 1.05 : rise * 0.92, person ? face * 1.35 : rise * 1.12, 0, 0, Math.PI * 2)
  context.fill()
  for (const [wrist, elbow] of [
    [marks.lWrist, marks.lElbow],
    [marks.rWrist, marks.rElbow],
  ] as const) {
    const dx = wrist.x - elbow.x
    const dy = wrist.y - elbow.y
    const length = Math.hypot(dx, dy) || 1
    context.beginPath()
    context.ellipse(wrist.x + (dx / length) * 16, wrist.y + (dy / length) * 20, shoulderW * 0.09, shoulderW * 0.12, Math.atan2(dy, dx), 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function shadeClothes(base: HTMLCanvasElement, clothes: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = base.width
  canvas.height = base.height
  const context = canvas.getContext('2d')
  if (!context) return clothes
  context.drawImage(base, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    const tone = data[index] * 0.3 + data[index + 1] * 0.59 + data[index + 2] * 0.11
    const shaped = Math.max(0, Math.min(255, (tone - 128) * 1.65 + 168))
    data[index] = shaped
    data[index + 1] = shaped
    data[index + 2] = shaped
  }
  context.putImageData(image, 0, 0)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(clothes, 0, 0)
  return canvas
}

const OVER_BODY: Category[] = ['hat', 'watch', 'bag']

function scalePoint(point: Point, sx: number, sy: number): Point {
  return { x: point.x * sx, y: point.y * sy }
}

function fitMarksToCanvas(marks: BodyMarks, width: number, height: number): BodyMarks {
  const points = Object.values(marks)
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  const fromFrame = maxX <= FRAME_W + 2 && maxY <= FRAME_H + 2 && (width !== FRAME_W || height !== FRAME_H)
  if (!fromFrame) return marks
  const sx = width / FRAME_W
  const sy = height / FRAME_H
  return {
    nose: scalePoint(marks.nose, sx, sy),
    neck: scalePoint(marks.neck, sx, sy),
    lShoulder: scalePoint(marks.lShoulder, sx, sy),
    rShoulder: scalePoint(marks.rShoulder, sx, sy),
    lElbow: scalePoint(marks.lElbow, sx, sy),
    rElbow: scalePoint(marks.rElbow, sx, sy),
    lWrist: scalePoint(marks.lWrist, sx, sy),
    rWrist: scalePoint(marks.rWrist, sx, sy),
    lHip: scalePoint(marks.lHip, sx, sy),
    rHip: scalePoint(marks.rHip, sx, sy),
    lKnee: scalePoint(marks.lKnee, sx, sy),
    rKnee: scalePoint(marks.rKnee, sx, sy),
    lAnkle: scalePoint(marks.lAnkle, sx, sy),
    rAnkle: scalePoint(marks.rAnkle, sx, sy),
  }
}

async function marksOnPhoto(base: HTMLCanvasElement, stored: BodyMarks, person: boolean): Promise<BodyMarks> {
  const fitted = orientMarks(fitMarksToCanvas(stored, base.width, base.height))
  if (!person && base.width === FRAME_W && base.height === FRAME_H) return fitted
  try {
    const detected = await detectMarks(base)
    if (detected) return orientMarks(detected)
  } catch {
    return fitted
  }
  return fitted
}

function stripMagentaCanvas(canvas: HTMLCanvasElement, knockCorners = false) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width < 8 || canvas.height < 8) return
  const width = canvas.width
  const height = canvas.height
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  if (knockCorners) {
    const corner = (x: number, y: number) => {
      const index = (y * width + x) * 4
      if (data[index + 3] < 200) return null
      return [data[index], data[index + 1], data[index + 2]]
    }
    const corners = [corner(2, 2), corner(width - 3, 2), corner(2, height - 3), corner(width - 3, height - 3)].filter(
      (point): point is number[] => point !== null,
    )
    if (corners.length === 4) {
      const average = [0, 1, 2].map((channel) => corners.reduce((sum, point) => sum + point[channel], 0) / corners.length)
      const spread = Math.max(
        ...corners.map((point) => Math.abs(point[0] - average[0]) + Math.abs(point[1] - average[1]) + Math.abs(point[2] - average[2])),
      )
      if (spread < 60) {
        for (let index = 0; index < data.length; index += 4) {
          const dist =
            Math.abs(data[index] - average[0]) +
            Math.abs(data[index + 1] - average[1]) +
            Math.abs(data[index + 2] - average[2])
          if (dist < 48) data[index + 3] = 0
          else if (dist < 96) data[index + 3] = Math.min(data[index + 3], Math.round(data[index + 3] * ((dist - 48) / 48)))
        }
      }
    }
  }
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]
    if (alpha < 8) {
      data[index + 3] = 0
      continue
    }
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const spill = Math.min(red, blue) - green
    const magenta = Math.abs(red - 255) + green + Math.abs(blue - 255)
    if (magenta < 110 || (spill > 70 && red > 130 && blue > 130 && green < 170)) {
      data[index + 3] = 0
      continue
    }
    if (spill > 28 && red > 90 && blue > 90 && green < 190) {
      const keep = Math.max(0, 1 - (spill - 28) / 55)
      data[index] = Math.round(green + (red - green) * keep)
      data[index + 2] = Math.round(green + (blue - green) * keep)
      data[index + 3] = Math.round(alpha * Math.min(1, keep + 0.15))
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const kill: number[] = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        if (data[index + 3] < 20) continue
        const spill = Math.min(data[index], data[index + 2]) - data[index + 1]
        if (spill < 18) continue
        let exposed = x === 0 || y === 0 || x === width - 1 || y === height - 1
        for (let dy = -1; dy <= 1 && !exposed; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || data[(ny * width + nx) * 4 + 3] < 20) {
              exposed = true
              break
            }
          }
        }
        if (exposed) kill.push(index)
      }
    }
    for (const index of kill) data[index + 3] = 0
  }
  context.putImageData(image, 0, 0)
}

export async function keyBackdrop(blob: Blob, knockCorners = true): Promise<Blob> {
  const source = await blobToCanvas(blob)
  stripMagentaCanvas(source, knockCorners)
  return canvasToPng(source)
}

type WornRgb = [number, number, number]
type PixelRect = { x0: number; y0: number; x1: number; y1: number }

function colorDist(a: WornRgb, b: WornRgb): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function limbTone(r: number, g: number, b: number): boolean {
  return r > 145 && g > 90 && b > 70 && r > g && g > b && r - b < 130 && r - g < 80
}

function clampRect(x0: number, y0: number, x1: number, y1: number, width: number, height: number): PixelRect {
  const left = Math.max(0, Math.floor(Math.min(x0, x1)))
  const top = Math.max(0, Math.floor(Math.min(y0, y1)))
  const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1)))
  const bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1)))
  return { x0: left, y0: top, x1: Math.max(left + 1, right), y1: Math.max(top + 1, bottom) }
}

function wearZones(category: Category, marks: BodyMarks, width: number, height: number): PixelRect[] {
  const measure = wearMeasures(marks)
  const hipW = Math.abs(marks.rHip.x - marks.lHip.x)
  const armL = Math.min(marks.lWrist.x, marks.lElbow.x, marks.lShoulder.x)
  const armR = Math.max(marks.rWrist.x, marks.rElbow.x, marks.rShoulder.x)
  if (category === 'shoes') {
    const y0 = measure.kneeY - (measure.kneeY - measure.hipY) * 0.35
    const y1 = measure.ankleY + (measure.ankleY - measure.kneeY) * 0.6
    const span = Math.max(Math.abs(marks.rAnkle.x - marks.lAnkle.x), measure.shoulderW * 0.7)
    const center = (marks.lAnkle.x + marks.rAnkle.x) / 2
    return [clampRect(center - span * 0.85, y0, center + span * 0.85, y1, width, height)]
  }
  if (category === 'bottom') {
    return [clampRect(measure.centerX - hipW * 0.95, measure.waistY - 12, measure.centerX + hipW * 0.95, measure.ankleY + 16, width, height)]
  }
  if (category === 'top' || category === 'outer') {
    const y1 = category === 'outer' ? measure.kneeY : measure.hipY + (measure.kneeY - measure.hipY) * 0.55
    const y0 = Math.min(marks.neck.y - 12, measure.shoulderY - 8)
    return [clampRect(armL - 18, y0, armR + 18, y1, width, height)]
  }
  if (category === 'hat') {
    return [clampRect(marks.nose.x - measure.shoulderW * 0.55, 0, marks.nose.x + measure.shoulderW * 0.55, marks.neck.y + 16, width, height)]
  }
  if (category === 'bag') {
    const hand = modelRightHand(marks)
    return [
      clampRect(
        hand.x - measure.shoulderW * 0.9,
        hand.y - measure.shoulderW * 0.2,
        Math.min(hand.x + measure.shoulderW * 0.32, measure.centerX - measure.shoulderW * 0.08),
        measure.hipY + (measure.kneeY - measure.hipY) * 0.55,
        width,
        height,
      ),
    ]
  }
  if (category === 'scarf') {
    return [clampRect(armL, marks.nose.y, armR, measure.waistY, width, height)]
  }
  if (category === 'necklace') {
    const drop = Math.max(36, measure.shoulderW * 0.34)
    return [clampRect(measure.centerX - measure.shoulderW * 0.2, marks.neck.y, measure.centerX + measure.shoulderW * 0.2, marks.neck.y + drop, width, height)]
  }
  if (category === 'watch') {
    const hand = modelRightHand(marks)
    const reach = Math.max(26, measure.shoulderW * 0.16)
    return [clampRect(hand.x - reach, hand.y - reach * 0.7, hand.x + reach, hand.y + reach * 0.9, width, height)]
  }
  return [clampRect(measure.centerX - hipW * 0.8, measure.waistY - 28, measure.centerX + hipW * 0.8, measure.hipY + 18, width, height)]
}

function modelRightHand(marks: BodyMarks): Point {
  return marks.lWrist.x <= marks.rWrist.x ? marks.lWrist : marks.rWrist
}

function shapeSticker(category: Category): boolean {
  return category === 'bag' || category === 'necklace' || category === 'watch'
}

function garmentPalette(image: HTMLCanvasElement): WornRgb[] {
  const context = image.getContext('2d', { willReadFrequently: true })
  if (!context || image.width < 2 || image.height < 2) return []
  const { width, height } = image
  const data = context.getImageData(0, 0, width, height).data
  const sample = (x: number, y: number): WornRgb | null => {
    const index = (y * width + x) * 4
    if (data[index + 3] < 40) return null
    return [data[index], data[index + 1], data[index + 2]]
  }
  const corners = [sample(1, 1), sample(width - 2, 1), sample(1, height - 2), sample(width - 2, height - 2)].filter(
    (color): color is WornRgb => color !== null,
  )
  let backdrop: WornRgb | null = null
  if (corners.length >= 3) {
    const average: WornRgb = [
      corners.reduce((sum, color) => sum + color[0], 0) / corners.length,
      corners.reduce((sum, color) => sum + color[1], 0) / corners.length,
      corners.reduce((sum, color) => sum + color[2], 0) / corners.length,
    ]
    const spread = Math.max(...corners.map((color) => colorDist(color, average)))
    if (spread < 36) backdrop = average
  }
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>()
  const step = Math.max(1, Math.floor(Math.max(width, height) / 72))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4
      if (data[index + 3] < 40) continue
      const rgb: WornRgb = [data[index], data[index + 1], data[index + 2]]
      if (backdrop && colorDist(rgb, backdrop) < 40) continue
      const key = `${rgb[0] >> 4},${rgb[1] >> 4},${rgb[2] >> 4}`
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
      bucket.r += rgb[0]
      bucket.g += rgb[1]
      bucket.b += rgb[2]
      bucket.n += 1
      buckets.set(key, bucket)
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 14)
    .map((bucket) => [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n])
}

function nearestColor(rgb: WornRgb, palette: WornRgb[]): number {
  let best = 1e9
  for (const color of palette) {
    const distance = colorDist(rgb, color)
    if (distance < best) best = distance
  }
  return best
}

function alignWorn(base: HTMLCanvasElement, worn: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = base.width
  canvas.height = base.height
  const context = canvas.getContext('2d')
  if (!context) return worn
  const scale = Math.min(base.width / worn.width, base.height / worn.height)
  const drawW = worn.width * scale
  const drawH = worn.height * scale
  context.drawImage(base, 0, 0)
  context.drawImage(worn, (base.width - drawW) / 2, (base.height - drawH) / 2, drawW, drawH)
  return canvas
}

function paintDiffMask(
  base: Uint8ClampedArray,
  worn: Uint8ClampedArray,
  width: number,
  zones: PixelRect[],
  changeMin: number,
): Uint8Array {
  const mask = new Uint8Array(worn.length / 4)
  for (const zone of zones) {
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      for (let x = zone.x0; x <= zone.x1; x += 1) {
        const index = (y * width + x) * 4
        const wornRgb: WornRgb = [worn[index], worn[index + 1], worn[index + 2]]
        const baseRgb: WornRgb = [base[index], base[index + 1], base[index + 2]]
        if (colorDist(wornRgb, baseRgb) > changeMin) mask[y * width + x] = 1
      }
    }
  }
  return mask
}

function paintMask(
  base: Uint8ClampedArray,
  worn: Uint8ClampedArray,
  width: number,
  zones: PixelRect[],
  palette: WornRgb[],
  garmentMax: number,
  changeMin: number,
  dropSkin: boolean,
): Uint8Array {
  const mask = new Uint8Array(worn.length / 4)
  for (const zone of zones) {
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      for (let x = zone.x0; x <= zone.x1; x += 1) {
        const index = (y * width + x) * 4
        const wornRgb: WornRgb = [worn[index], worn[index + 1], worn[index + 2]]
        const baseRgb: WornRgb = [base[index], base[index + 1], base[index + 2]]
        const garmentDist = nearestColor(wornRgb, palette)
        const baseDist = colorDist(wornRgb, baseRgb)
        const skin = limbTone(wornRgb[0], wornRgb[1], wornRgb[2])
        if (skin && garmentDist > 26 && (dropSkin || limbTone(baseRgb[0], baseRgb[1], baseRgb[2]))) continue
        if (garmentDist < garmentMax && baseDist > changeMin) mask[y * width + x] = 1
        else if (garmentDist < garmentMax * 0.72 && garmentDist + 8 < baseDist) mask[y * width + x] = 1
      }
    }
  }
  return mask
}

function dilateMask(mask: Uint8Array, width: number, height: number, zone: PixelRect, radius: number): Uint8Array {
  const next = mask.slice()
  const x0 = Math.max(0, zone.x0 - radius)
  const y0 = Math.max(0, zone.y0 - radius)
  const x1 = Math.min(width - 1, zone.x1 + radius)
  const y1 = Math.min(height - 1, zone.y1 + radius)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      let on = 0
      for (let dy = -radius; dy <= radius && !on; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          if (mask[ny * width + nx]) {
            on = 1
            break
          }
        }
      }
      if (on) next[y * width + x] = 1
    }
  }
  return next
}

function erodeMask(mask: Uint8Array, width: number, height: number, zone: PixelRect, radius: number): Uint8Array {
  const next = mask.slice()
  for (let y = zone.y0; y <= zone.y1; y += 1) {
    for (let x = zone.x0; x <= zone.x1; x += 1) {
      if (!mask[y * width + x]) continue
      let solid = 1
      for (let dy = -radius; dy <= radius && solid; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) {
          solid = 0
          break
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width || !mask[ny * width + nx]) {
            solid = 0
            break
          }
        }
      }
      if (!solid) next[y * width + x] = 0
    }
  }
  return next
}

function unionRect(zones: PixelRect[]): PixelRect {
  return {
    x0: Math.min(...zones.map((zone) => zone.x0)),
    y0: Math.min(...zones.map((zone) => zone.y0)),
    x1: Math.max(...zones.map((zone) => zone.x1)),
    y1: Math.max(...zones.map((zone) => zone.y1)),
  }
}

function closeMask(mask: Uint8Array, width: number, height: number, zones: PixelRect[], radius = 2): Uint8Array {
  const zone = unionRect(zones)
  const grown = {
    x0: Math.max(0, zone.x0 - radius),
    y0: Math.max(0, zone.y0 - radius),
    x1: Math.min(width - 1, zone.x1 + radius),
    y1: Math.min(height - 1, zone.y1 + radius),
  }
  const dilated = dilateMask(mask, width, height, zone, radius)
  const filled = fillHoles(dilated, width, [grown])
  return erodeMask(filled, width, height, grown, radius)
}

function keepGarmentPixels(
  mask: Uint8Array,
  worn: Uint8ClampedArray,
  width: number,
  zones: PixelRect[],
  palette: WornRgb[],
): Uint8Array {
  const next = mask.slice()
  for (const zone of zones) {
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      for (let x = zone.x0; x <= zone.x1; x += 1) {
        const index = y * width + x
        if (!next[index]) continue
        const pixel = index * 4
        const rgb: WornRgb = [worn[pixel], worn[pixel + 1], worn[pixel + 2]]
        const garmentDist = palette.length ? nearestColor(rgb, palette) : 0
        if (limbTone(rgb[0], rgb[1], rgb[2]) && garmentDist > 24) next[index] = 0
      }
    }
  }
  return next
}

function fillClothHoles(
  mask: Uint8Array,
  worn: Uint8ClampedArray,
  width: number,
  zones: PixelRect[],
  palette: WornRgb[],
): Uint8Array {
  const next = mask.slice()
  for (const zone of zones) {
    const outside = new Uint8Array(mask.length)
    const stack: number[] = []
    const push = (x: number, y: number) => {
      if (x < zone.x0 || y < zone.y0 || x > zone.x1 || y > zone.y1) return
      const index = y * width + x
      if (outside[index] || next[index]) return
      outside[index] = 1
      stack.push(index)
    }
    for (let x = zone.x0; x <= zone.x1; x += 1) {
      push(x, zone.y0)
      push(x, zone.y1)
    }
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      push(zone.x0, y)
      push(zone.x1, y)
    }
    while (stack.length > 0) {
      const index = stack.pop() ?? 0
      const x = index % width
      const y = (index - x) / width
      push(x - 1, y)
      push(x + 1, y)
      push(x, y - 1)
      push(x, y + 1)
    }
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      for (let x = zone.x0; x <= zone.x1; x += 1) {
        const index = y * width + x
        if (next[index] || outside[index]) continue
        const pixel = index * 4
        const rgb: WornRgb = [worn[pixel], worn[pixel + 1], worn[pixel + 2]]
        const garmentDist = palette.length ? nearestColor(rgb, palette) : 0
        if (limbTone(rgb[0], rgb[1], rgb[2]) && garmentDist > 24) continue
        next[index] = 1
      }
    }
  }
  return next
}

function peelOuterFringe(
  mask: Uint8Array,
  worn: Uint8ClampedArray,
  width: number,
  height: number,
  palette: WornRgb[],
): Uint8Array {
  const next = mask.slice()
  const seen = new Uint8Array(mask.length)
  const stack: number[] = []
  const removable = (index: number) => {
    const pixel = index * 4
    const wornRgb: WornRgb = [worn[pixel], worn[pixel + 1], worn[pixel + 2]]
    const garmentDist = palette.length ? nearestColor(wornRgb, palette) : 0
    return limbTone(wornRgb[0], wornRgb[1], wornRgb[2]) && garmentDist > 24
  }
  const push = (index: number) => {
    if (!next[index] || seen[index] || !removable(index)) return
    seen[index] = 1
    next[index] = 0
    stack.push(index)
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (!next[index]) continue
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !next[index - 1] ||
        !next[index + 1] ||
        !next[index - width] ||
        !next[index + width]
      if (edge) push(index)
    }
  }
  while (stack.length > 0) {
    const index = stack.pop() ?? 0
    const x = index % width
    const y = (index - x) / width
    if (x > 0) push(index - 1)
    if (x + 1 < width) push(index + 1)
    if (y > 0) push(index - width)
    if (y + 1 < height) push(index + width)
  }
  return next
}

function closeCloth(
  mask: Uint8Array,
  worn: Uint8ClampedArray,
  width: number,
  height: number,
  zones: PixelRect[],
  palette: WornRgb[],
): Uint8Array {
  const zone = unionRect(zones)
  const radius = 8
  const grown = {
    x0: Math.max(0, zone.x0 - radius),
    y0: Math.max(0, zone.y0 - radius),
    x1: Math.min(width - 1, zone.x1 + radius),
    y1: Math.min(height - 1, zone.y1 + radius),
  }
  const dilated = dilateMask(mask, width, height, zone, radius)
  const filled = fillClothHoles(dilated, worn, width, [grown], palette)
  const eroded = erodeMask(filled, width, height, grown, radius)
  return peelOuterFringe(eroded, worn, width, height, palette)
}

function keepComponents(mask: Uint8Array, width: number, height: number, ratio = 0.08): Uint8Array {
  const seen = new Uint8Array(mask.length)
  const kept = new Uint8Array(mask.length)
  let largest = 0
  const groups: number[][] = []
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || seen[index]) continue
    const pixels: number[] = []
    const stack = [index]
    seen[index] = 1
    while (stack.length > 0) {
      const current = stack.pop() ?? 0
      pixels.push(current)
      const x = current % width
      const y = (current - x) / width
      if (x > 0) {
        const left = current - 1
        if (mask[left] && !seen[left]) {
          seen[left] = 1
          stack.push(left)
        }
      }
      if (x + 1 < width) {
        const right = current + 1
        if (mask[right] && !seen[right]) {
          seen[right] = 1
          stack.push(right)
        }
      }
      if (y > 0) {
        const up = current - width
        if (mask[up] && !seen[up]) {
          seen[up] = 1
          stack.push(up)
        }
      }
      if (y + 1 < height) {
        const down = current + width
        if (mask[down] && !seen[down]) {
          seen[down] = 1
          stack.push(down)
        }
      }
    }
    if (pixels.length > largest) largest = pixels.length
    groups.push(pixels)
  }
  const floor = Math.max(36, largest * ratio)
  for (const pixels of groups) {
    if (pixels.length < floor) continue
    for (const index of pixels) kept[index] = 1
  }
  return kept
}

function fillHoles(mask: Uint8Array, width: number, zones: PixelRect[]): Uint8Array {
  const next = mask.slice()
  for (const zone of zones) {
    const outside = new Uint8Array(mask.length)
    const stack: number[] = []
    const push = (x: number, y: number) => {
      if (x < zone.x0 || y < zone.y0 || x > zone.x1 || y > zone.y1) return
      const index = y * width + x
      if (outside[index] || next[index]) return
      outside[index] = 1
      stack.push(index)
    }
    for (let x = zone.x0; x <= zone.x1; x += 1) {
      push(x, zone.y0)
      push(x, zone.y1)
    }
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      push(zone.x0, y)
      push(zone.x1, y)
    }
    while (stack.length > 0) {
      const index = stack.pop() ?? 0
      const x = index % width
      const y = (index - x) / width
      push(x - 1, y)
      push(x + 1, y)
      push(x, y - 1)
      push(x, y + 1)
    }
    for (let y = zone.y0; y <= zone.y1; y += 1) {
      for (let x = zone.x0; x <= zone.x1; x += 1) {
        const index = y * width + x
        if (!next[index] && !outside[index]) next[index] = 1
      }
    }
  }
  return next
}

function zoneArea(zones: PixelRect[]): number {
  return zones.reduce((sum, zone) => sum + Math.max(1, zone.x1 - zone.x0 + 1) * Math.max(1, zone.y1 - zone.y0 + 1), 0)
}

function solidShape(mask: Uint8Array, width: number, height: number, zones: PixelRect[]): Uint8Array {
  return fillHoles(keepComponents(closeMask(mask, width, height, zones), width, height, 1), width, zones)
}

function nearestCore(core: Uint8Array, width: number, height: number, x: number, y: number): number {
  for (let radius = 1; radius <= 16; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (core[ny * width + nx]) return (ny * width + nx) * 4
      }
    }
  }
  return (y * width + x) * 4
}

function maskCount(mask: Uint8Array): number {
  let count = 0
  for (let index = 0; index < mask.length; index += 1) if (mask[index]) count += 1
  return count
}

function boundsOf(mask: Uint8Array, width: number, height: number): PixelRect | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0 || y1 < y0) return null
  return { x0, y0, x1, y1 }
}

export async function extractWornGarment(
  baseBlob: Blob,
  wornBlob: Blob,
  garmentBlob: Blob,
  storedMarks: BodyMarks,
  category: Category,
): Promise<{ stickerBlob: Blob; stickerFrame: StickerFrame }> {
  const base = await blobToCanvas(baseBlob)
  const wornSource = await blobToCanvas(wornBlob)
  const garment = await blobToCanvas(garmentBlob)
  const worn = alignWorn(base, wornSource)
  const marks = orientMarks(fitMarksToCanvas(storedMarks, base.width, base.height))
  const palette = garmentPalette(garment)
  const baseContext = base.getContext('2d', { willReadFrequently: true })
  const wornContext = worn.getContext('2d', { willReadFrequently: true })
  if (!baseContext || !wornContext) throw new Error('没能从穿上身的图里分出这件衣服。')
  const width = base.width
  const height = base.height
  const baseData = baseContext.getImageData(0, 0, width, height).data
  const wornData = wornContext.getImageData(0, 0, width, height).data
  const tight = wearZones(category, marks, width, height)
  const shape = shapeSticker(category)
  const minPixels = shape ? 36 : 80
  const finish = (source: Uint8Array, zones: PixelRect[]) => {
    if (shape) return solidShape(source, width, height, zones)
    const cloth = keepGarmentPixels(source, wornData, width, zones, palette)
    return keepComponents(closeCloth(cloth, wornData, width, height, zones, palette), width, height, 0.03)
  }
  let core = paintDiffMask(baseData, wornData, width, tight, 28)
  let mask = finish(core, tight)
  if (maskCount(mask) < minPixels) {
    core = paintDiffMask(baseData, wornData, width, tight, 16)
    mask = finish(core, tight)
  }
  if (maskCount(mask) < minPixels && palette.length > 0) {
    core = paintMask(baseData, wornData, width, tight, palette, shape ? 54 : 50, 22, shape)
    mask = finish(core, tight)
  }
  if (maskCount(mask) > zoneArea(tight) * 0.9) {
    throw new Error('这次模特也被改动了，贴纸没有保存。可以再试一次。')
  }
  const covered = maskCount(mask)
  const box = boundsOf(mask, width, height)
  if (!box || covered < minPixels || covered > width * height * 0.42 || (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) > width * height * 0.55) {
    throw new Error('没能从穿上身的图里分出这件衣服。可以再点一次重做贴纸。')
  }
  const x = Math.max(0, box.x0 - 1)
  const y = Math.max(0, box.y0 - 1)
  const cropW = Math.min(width - x, box.x1 - box.x0 + 3)
  const cropH = Math.min(height - y, box.y1 - box.y0 + 3)
  const cut = document.createElement('canvas')
  cut.width = cropW
  cut.height = cropH
  const context = cut.getContext('2d')
  if (!context) throw new Error('没能从穿上身的图里分出这件衣服。')
  const image = wornContext.getImageData(x, y, cropW, cropH)
  const pixels = image.data
  for (let row = 0; row < cropH; row += 1) {
    for (let col = 0; col < cropW; col += 1) {
      const at = (y + row) * width + (x + col)
      const pixel = (row * cropW + col) * 4
      if (!mask[at]) {
        pixels[pixel + 3] = 0
        continue
      }
      if (shape && !core[at]) {
        const source = nearestCore(core, width, height, x + col, y + row)
        pixels[pixel] = wornData[source]
        pixels[pixel + 1] = wornData[source + 1]
        pixels[pixel + 2] = wornData[source + 2]
      }
      pixels[pixel + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return {
    stickerBlob: await canvasToPng(cut),
    stickerFrame: { x, y, width: cropW, height: cropH },
  }
}

function solidBackdrop(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width < 8 || canvas.height < 8) return false
  const width = canvas.width
  const height = canvas.height
  const data = context.getImageData(0, 0, width, height).data
  const points = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ]
  const colors: number[][] = []
  for (const [x, y] of points) {
    const index = (y * width + x) * 4
    if (data[index + 3] < 200) return false
    colors.push([data[index], data[index + 1], data[index + 2]])
  }
  const average = [0, 1, 2].map((channel) => colors.reduce((sum, color) => sum + color[channel], 0) / colors.length)
  const spread = Math.max(
    ...colors.map((color) => Math.abs(color[0] - average[0]) + Math.abs(color[1] - average[1]) + Math.abs(color[2] - average[2])),
  )
  return spread < 80
}

function placeCutout(image: HTMLCanvasElement, marks: BodyMarks, category: Category, bodyW: number, bodyH: number): LaidSticker {
  const measure = wearMeasures(marks)
  if (category === 'top' || category === 'outer') {
    const elbow = Math.abs(marks.rElbow.x - marks.lElbow.x)
    const targetW = Math.max(measure.shoulderW * 1.45, elbow * 0.92, bodyW * (category === 'outer' ? 0.5 : 0.42))
    const hemY = category === 'outer'
      ? measure.hipY + (measure.kneeY - measure.hipY) * 0.55
      : measure.hipY + (measure.hipY - measure.waistY) * 0.2
    const targetH = Math.max(80, hemY - measure.shoulderY, bodyH * (category === 'outer' ? 0.42 : 0.34))
    let scale = targetW / image.width
    if (image.height * scale < targetH * 0.92) scale = (targetH * 0.92) / image.height
    if (image.width * scale > targetW * 1.25) scale = (targetW * 1.25) / image.width
    const width = image.width * scale
    const height = image.height * scale
    return {
      frame: { x: measure.centerX - width / 2, y: measure.shoulderY - height * 0.12, width, height },
      sourceHeight: image.height,
    }
  }
  if (category === 'bottom') {
    const laid = layoutWornBottom(image, marks)
    const leg = Math.max(80, measure.ankleY - measure.waistY)
    if (laid.frame.height < leg * 0.85) {
      const scale = (leg * 0.92) / image.height
      const width = image.width * scale
      const center = (marks.lHip.x + marks.rHip.x) / 2
      return {
        frame: { x: center - width / 2, y: measure.waistY, width, height: image.height * scale },
        sourceHeight: image.height,
      }
    }
    return laid
  }
  if (category === 'bag') {
    const targetW = Math.max(measure.shoulderW * 0.85, bodyW * 0.2)
    const maxH = Math.max(measure.shoulderW * 1.15, bodyH * 0.26)
    let scale = targetW / image.width
    if (image.height * scale > maxH) scale = maxH / image.height
    const width = image.width * scale
    const height = image.height * scale
    return {
      frame: {
        x: marks.rWrist.x - width * 0.42,
        y: marks.rWrist.y - height * 0.08,
        width,
        height,
      },
      sourceHeight: image.height,
    }
  }
  return layoutSticker(image, marks, category)
}

async function fitGarmentOnBody(
  base: HTMLCanvasElement,
  marks: BodyMarks,
  garmentBlob: Blob,
  category: Category,
): Promise<{ png: Blob; frame: StickerFrame; baseWidth: number; baseHeight: number; refit: boolean; store: boolean }> {
  const source = await blobToCanvas(garmentBlob)
  stripMagentaCanvas(source, false)
  const removed = removeSolidBackground(source)
  let garment = trimAlpha(removed.removedRatio > 0.05 ? removed.canvas : source, 2)
  const oriented = await marksOnPhoto(base, marks, true)
  const laid = placeCutout(garment, oriented, category, base.width, base.height)
  if (laid.sourceHeight < garment.height - 1) {
    garment = cropImage(garment, 0, 0, garment.width, laid.sourceHeight)
  }
  return {
    png: await canvasToPng(garment),
    frame: laid.frame,
    baseWidth: base.width,
    baseHeight: base.height,
    refit: true,
    store: !solidBackdrop(garment),
  }
}

export async function stickerLayer(
  baseBlob: Blob,
  marks: BodyMarks,
  sticker: Blob,
  category: Category,
  placed?: StickerFrame | null,
  product?: Blob | null,
): Promise<{ png: Blob; frame: StickerFrame; baseWidth: number; baseHeight: number; refit: boolean; store: boolean }> {
  const base = await blobToCanvas(baseBlob)
  const stickerCanvas = await blobToCanvas(sticker)
  if (solidBackdrop(stickerCanvas)) {
    return fitGarmentOnBody(base, marks, product ?? sticker, category)
  }
  if (placed && placed.width > 8 && placed.height > 8) {
    return { png: sticker, frame: placed, baseWidth: base.width, baseHeight: base.height, refit: false, store: false }
  }
  return fitGarmentOnBody(base, marks, product ?? sticker, category)
}

export async function compositeLook(
  baseBlob: Blob,
  marks: BodyMarks,
  items: { category: Category; blob: Blob; sticker?: Blob }[],
  options?: { person?: boolean },
): Promise<Blob> {
  const base = await blobToCanvas(baseBlob)
  const output = document.createElement('canvas')
  output.width = base.width
  output.height = base.height
  const out = output.getContext('2d')
  if (!out) return baseBlob
  const person = Boolean(options?.person)
  const oriented = await marksOnPhoto(base, marks, person)
  const sorted = [...items].sort((a, b) => DRAW_ORDER.indexOf(a.category) - DRAW_ORDER.indexOf(b.category))
  const prepared = await Promise.all(
    sorted.map(async (item) => ({
      category: item.category,
      image: item.sticker ? null : trimAlpha(await blobToCanvas(item.blob), 2),
      sticker: item.sticker ? await blobToCanvas(item.sticker) : null,
    })),
  )
  out.drawImage(base, 0, 0)
  for (const item of prepared) {
    if (item.sticker) {
      const layer = document.createElement('canvas')
      layer.width = base.width
      layer.height = base.height
      const placed = layer.getContext('2d')
      if (!placed) continue
      stripMagentaCanvas(item.sticker)
      const garment = trimAlpha(item.sticker, 1)
      if (item.category === 'top' || item.category === 'outer') paintWornTop(placed, garment, oriented, item.category)
      else if (item.category === 'bottom') paintWornBottom(placed, garment, oriented)
      else if (item.category === 'shoes') paintWornShoes(placed, garment, oriented)
      else paintMesh(placed, garment, garmentGrid(oriented, item.category))
      if (item.category === 'top' || item.category === 'outer' || item.category === 'scarf' || item.category === 'necklace') {
        cutHeadAndHands(placed, oriented, true)
      }
      out.drawImage(layer, 0, 0)
      continue
    }
    if (!item.image) continue
    const layer = document.createElement('canvas')
    layer.width = base.width
    layer.height = base.height
    const context = layer.getContext('2d')
    if (!context) continue
    const over = OVER_BODY.includes(item.category)
    if (item.category === 'top' || item.category === 'outer') paintWornTop(context, item.image, oriented, item.category)
    else if (item.category === 'bottom') paintWornBottom(context, item.image, oriented)
    else if (item.category === 'shoes') paintWornShoes(context, item.image, oriented)
    else paintMesh(context, item.image, garmentGrid(oriented, item.category))
    if (!over) cutHeadAndHands(context, oriented, person)
    out.drawImage(layer, 0, 0)
    out.save()
    out.globalAlpha = person ? 0.28 : 0.62
    out.globalCompositeOperation = 'multiply'
    out.drawImage(shadeClothes(base, layer), 0, 0)
    out.restore()
  }
  return canvasToPng(output)
}
