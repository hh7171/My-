import { frameFitsImage, readStickerFrame, writeStickerFrame } from './library-mark.ts'
import { placedJewelry, ZERO_ADJUSTMENTS, type Adjustments, type BodyMarks, type BodyProfile, type BodyType, type Category, type Point, type StickerFrame } from './types.ts'
export type { StickerFrame }
import { detectMarks, jewelryPoints, segmentPerson, wristWearPoint } from './vision.ts'

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
  return { canvas, marks: mapMarkPoints(marks, (point) => ({ x: dx + point.x * scale, y: dy + point.y * scale })) }
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
  const marks: BodyMarks = {
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
  return { ...marks, ...jewelryPoints(marks.nose, marks.neck, marks.lShoulder, marks.rShoulder) }
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
    if (next.lEar && next.rEar) [next.lEar, next.rEar] = [next.rEar, next.lEar]
    if (next.neckLeft && next.neckRight) [next.neckLeft, next.neckRight] = [next.neckRight, next.neckLeft]
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
  return { canvas: output, marks: mapMarkPoints(oriented, mapPoint) }
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
  return { canvas: frame, marks: mapMarkPoints(marks, mapPoint) }
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
  return { canvas, marks: mapMarkPoints(marks, (point) => ({ x: point.x * scale + dx, y: point.y * scale + dy })) }
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

function smoothPaleBackdrop(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, background: Rgb): boolean {
  const offset = (y * width + x) * 4
  if (pixels[offset + 3] < 16) return true
  const red = pixels[offset]
  const green = pixels[offset + 1]
  const blue = pixels[offset + 2]
  const light = Math.min(red, green, blue)
  const neutral = Math.max(red, green, blue) - light
  const distance = Math.abs(red - background[0]) + Math.abs(green - background[1]) + Math.abs(blue - background[2])
  let darkest = 255
  let brightest = 0
  let counted = 0
  for (let dy = -2; dy <= 2; dy += 2) {
    for (let dx = -2; dx <= 2; dx += 2) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const neighbor = (ny * width + nx) * 4
      if (pixels[neighbor + 3] < 16) continue
      const value = Math.min(pixels[neighbor], pixels[neighbor + 1], pixels[neighbor + 2])
      if (value < darkest) darkest = value
      if (value > brightest) brightest = value
      counted += 1
    }
  }
  const gradient = counted < 3 ? 255 : brightest - darkest
  const pale = light > 226 && neutral < 16 && gradient < 9 && distance <= 70
  const close = light > 244 && neutral < 12 && distance <= 24
  return pale || close
}

function dropDistantLightIslands(pixels: Uint8ClampedArray, width: number, height: number): number {
  const count = width * height
  const labels = new Int32Array(count)
  const queueX = new Int32Array(count)
  const queueY = new Int32Array(count)
  let components = 0
  const sizes: number[] = [0]
  const softs: number[] = [0]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x
      if (pixels[start * 4 + 3] < 16 || labels[start]) continue
      components += 1
      let head = 0
      let tail = 0
      let size = 0
      let soft = 0
      queueX[tail] = x
      queueY[tail] = y
      tail += 1
      labels[start] = components
      while (head < tail) {
        const cx = queueX[head]
        const cy = queueY[head]
        head += 1
        size += 1
        const offset = (cy * width + cx) * 4
        const light = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2])
        const neutral = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) - light
        if (light > 215 && neutral < 22) soft += 1
        const visit = (nx: number, ny: number) => {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) return
          const index = ny * width + nx
          if (labels[index] || pixels[index * 4 + 3] < 16) return
          labels[index] = components
          queueX[tail] = nx
          queueY[tail] = ny
          tail += 1
        }
        visit(cx - 1, cy)
        visit(cx + 1, cy)
        visit(cx, cy - 1)
        visit(cx, cy + 1)
      }
      sizes.push(size)
      softs.push(soft)
    }
  }
  if (components < 2) return 0
  let main = 1
  for (let label = 2; label <= components; label += 1) {
    if (sizes[label] > sizes[main]) main = label
  }
  const distance = new Int32Array(count)
  distance.fill(-1)
  let head = 0
  let tail = 0
  for (let index = 0; index < count; index += 1) {
    if (labels[index] !== main) continue
    distance[index] = 0
    queueX[tail] = index % width
    queueY[tail] = Math.floor(index / width)
    tail += 1
  }
  while (head < tail) {
    const cx = queueX[head]
    const cy = queueY[head]
    const next = distance[cy * width + cx] + 1
    head += 1
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return
      const index = ny * width + nx
      if (distance[index] !== -1) return
      distance[index] = next
      queueX[tail] = nx
      queueY[tail] = ny
      tail += 1
    }
    visit(cx - 1, cy)
    visit(cx + 1, cy)
    visit(cx, cy - 1)
    visit(cx, cy + 1)
  }
  const nearest = new Float64Array(components + 1)
  nearest.fill(Number.POSITIVE_INFINITY)
  for (let index = 0; index < count; index += 1) {
    const label = labels[index]
    if (!label || label === main) continue
    if (distance[index] < nearest[label]) nearest[label] = distance[index]
  }
  const drop = new Uint8Array(components + 1)
  for (let label = 1; label <= components; label += 1) {
    if (label === main || sizes[label] > sizes[main] * 0.4) continue
    if (softs[label] < sizes[label] * 0.75) continue
    if (nearest[label] <= 32) continue
    drop[label] = 1
  }
  let removed = 0
  for (let index = 0; index < count; index += 1) {
    if (!drop[labels[index]]) continue
    pixels[index * 4 + 3] = 0
    removed += 1
  }
  return removed
}

function clearEnclosedBackdrop(pixels: Uint8ClampedArray, width: number, height: number, background: Rgb): number {
  const count = width * height
  const pale = new Uint8Array(count)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (pixels[index * 4 + 3] < 16) continue
      if (smoothPaleBackdrop(pixels, width, height, x, y, background)) pale[index] = 1
    }
  }
  const outside = new Uint8Array(count)
  const queueX = new Int32Array(count)
  const queueY = new Int32Array(count)
  let head = 0
  let tail = 0
  const pushOutside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = y * width + x
    if (outside[index] || pixels[index * 4 + 3] >= 16) return
    outside[index] = 1
    queueX[tail] = x
    queueY[tail] = y
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    pushOutside(x, 0)
    pushOutside(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    pushOutside(0, y)
    pushOutside(width - 1, y)
  }
  while (head < tail) {
    const x = queueX[head]
    const y = queueY[head]
    head += 1
    pushOutside(x - 1, y)
    pushOutside(x + 1, y)
    pushOutside(x, y - 1)
    pushOutside(x, y + 1)
  }
  const seen = new Uint8Array(count)
  const members = new Int32Array(count)
  let removed = 0
  let opaque = 0
  for (let index = 0; index < count; index += 1) if (pixels[index * 4 + 3] >= 16) opaque += 1
  for (let start = 0; start < count; start += 1) {
    if (!pale[start] || seen[start]) continue
    let compHead = 0
    let compTail = 0
    seen[start] = 1
    queueX[compTail] = start % width
    queueY[compTail] = Math.floor(start / width)
    compTail += 1
    members[compHead] = start
    let area = 1
    let touch = outside[start] === 1
    let minX = start % width
    let maxX = minX
    let minY = Math.floor(start / width)
    let maxY = minY
    while (compHead < compTail) {
      const x = queueX[compHead]
      const y = queueY[compHead]
      compHead += 1
      const visit = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return
        const index = ny * width + nx
        if (outside[index]) touch = true
        if (!pale[index] || seen[index]) return
        seen[index] = 1
        queueX[compTail] = nx
        queueY[compTail] = ny
        compTail += 1
        members[area] = index
        area += 1
        if (nx < minX) minX = nx
        if (nx > maxX) maxX = nx
        if (ny < minY) minY = ny
        if (ny > maxY) maxY = ny
      }
      visit(x - 1, y)
      visit(x + 1, y)
      visit(x, y - 1)
      visit(x, y + 1)
    }
    const boxW = maxX - minX + 1
    const boxH = maxY - minY + 1
    if (touch || area < 4000 || area / (boxW * boxH) < 0.66 || Math.min(boxW, boxH) < 48 || area > opaque * 0.7) continue
    const sampleCount = Math.min(area, 800)
    const step = Math.max(1, Math.floor(area / sampleCount))
    const lights: number[] = []
    const chromas: number[] = []
    for (let index = 0; index < area; index += step) {
      const pixel = members[index] * 4
      const red = pixels[pixel]
      const green = pixels[pixel + 1]
      const blue = pixels[pixel + 2]
      lights.push(Math.min(red, green, blue))
      chromas.push(Math.max(red, green, blue) - Math.min(red, green, blue))
    }
    lights.sort((a, b) => a - b)
    chromas.sort((a, b) => a - b)
    const holeLight = lights[Math.floor(lights.length / 2)]
    const chroma = chromas[Math.floor(chromas.length / 2)]
    if (holeLight < 240 || chroma > 16) continue
    const around: number[] = []
    const edgeStep = Math.max(1, Math.floor(area / 500))
    for (let index = 0; index < area; index += edgeStep) {
      const current = members[index]
      const x = current % width
      const y = Math.floor(current / width)
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !pale[current - 1] ||
        !pale[current + 1] ||
        !pale[current - width] ||
        !pale[current + width]
      if (!edge) continue
      for (let radius = 6; radius <= 12; radius += 3) {
        for (let turn = 0; turn < 8; turn += 1) {
          const angle = (turn * Math.PI) / 4
          const nx = x + Math.round(Math.cos(angle) * radius)
          const ny = y + Math.round(Math.sin(angle) * radius)
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const at = ny * width + nx
          if (pale[at] || pixels[at * 4 + 3] < 16) continue
          const pixel = at * 4
          around.push(Math.min(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]))
        }
      }
    }
    if (around.length < 12) continue
    around.sort((a, b) => a - b)
    const boundLight = around[Math.floor(around.length / 2)]
    if (holeLight - boundLight < 18) continue
    for (let index = 0; index < area; index += 1) {
      pixels[members[index] * 4 + 3] = 0
      removed += 1
    }
  }
  return removed
}

export function removeNearWhiteEdges(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; removedRatio: number } {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width < 2 || canvas.height < 2) return { canvas: source, removedRatio: 0 }
  context.drawImage(source, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  const width = canvas.width
  const height = canvas.height
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  let transparentEdge = 0
  let edgeSamples = 0
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48))
  const take = (x: number, y: number) => {
    edgeSamples += 1
    const index = (y * width + x) * 4
    if (pixels[index + 3] < 16) {
      transparentEdge += 1
      return
    }
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
  const background: Rgb = reds.length >= 8
    ? [medianChannel(reds), medianChannel(greens), medianChannel(blues)]
    : [255, 255, 255]
  const spread = Math.max(...background) - Math.min(...background)
  const whiteEdge = reds.length >= 8 && Math.min(...background) >= 228 && spread <= 18
  const openEdge = transparentEdge > edgeSamples * 0.6
  if (!whiteEdge && !openEdge) return { canvas: source, removedRatio: 0 }
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
    if (pixels[index + 3] >= 16 && !smoothPaleBackdrop(pixels, width, height, x, y, background)) continue
    if (pixels[index + 3] >= 16) removed += 1
    pixels[index + 3] = 0
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
  }
  removed += dropDistantLightIslands(pixels, width, height)
  removed += clearEnclosedBackdrop(pixels, width, height, background)
  if (!removed) return { canvas: source, removedRatio: 0 }
  context.putImageData(image, 0, 0)
  return { canvas, removedRatio: removed / (width * height) }
}

export async function isolateProductCutout(blob: Blob, category?: Category): Promise<Blob> {
  const source = await blobToCanvas(blob)
  const removed = removeNearWhiteEdges(source)
  const jewelry = category === 'jewelry' || (category != null && placedJewelry(category))
  if (removed.removedRatio <= 0 || (!jewelry && removed.removedRatio > 0.82)) return blob
  return canvasToPng(trimAlpha(removed.canvas, 12))
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
  if (category === 'jewelry' || category === 'necklace') {
    return rectGrid(center.x - shoulderW * 0.34, marks.neck.y - 6, shoulderW * 0.68, shoulderW * 0.55)
  }
  if (category === 'earrings') {
    const face = Math.max(36, marks.neck.y - marks.nose.y)
    return rectGrid(marks.nose.x - face * 0.7, marks.nose.y - face * 0.05, face * 1.4, face * 0.7)
  }
  if (category === 'bracelet' || category === 'watch') {
    const wear = wristWearPoint(marks)
    const size = Math.max(36, shoulderW * 0.2)
    return rectGrid(wear.x - size / 2, wear.y - size / 2, size, size)
  }
  if (category === 'glasses') {
    return rectGrid(marks.nose.x - shoulderW * 0.22, marks.nose.y - 18, shoulderW * 0.44, 36)
  }
  if (category === 'belt') {
    return rectGrid(center.x - shoulderW * 0.28, hipY - 16, shoulderW * 0.56, 28)
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

  if (category === 'pants' || category === 'skirt') {
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
  const long = category === 'dress'
  const bottomY = category === 'dress' ? kneeY + (kneeY - hipY) * 0.45 : long ? hipY + (kneeY - hipY) * 0.58 : hipY + 24
  const waistY = topY + (bottomY - topY) * 0.46
  const topHalf = shoulderW * (long ? 0.64 : 0.56)
  const waistHalf = shoulderW * (long ? 0.58 : 0.5)
  const bottomHalf = shoulderW * (long ? 0.6 : 0.48)
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
  'pants',
  'skirt',
  'dress',
  'top',
  'belt',
  'scarf',
  'necklace',
  'earrings',
  'jewelry',
  'bracelet',
  'watch',
  'hat',
  'glasses',
  'bag',
]

export function raiseSecondWrist<T extends { id: string; category: Category }>(layers: T[], order: readonly string[]): T[] {
  const wrists = layers.filter((layer) => layer.category === 'watch' || layer.category === 'bracelet')
  if (wrists.length < 2) return layers
  const rank = (layer: T) => {
    const at = order.indexOf(layer.id)
    if (at >= 0) return at
    return 1000 + (layer.category === 'watch' ? 0 : 1)
  }
  const ordered = [...wrists].sort((a, b) => rank(a) - rank(b))
  const first = ordered[0]
  const second = ordered[ordered.length - 1]
  const rest = layers.filter((layer) => layer.id !== second.id)
  const at = rest.findIndex((layer) => layer.id === first.id)
  if (at < 0) return layers
  rest.splice(at + 1, 0, second)
  return rest
}

export function secondWristShift(
  layers: { id: string; category: Category; frame: StickerFrame }[],
  order: readonly string[],
  scaleOf: (id: string) => number,
  marks: BodyMarks,
  width: number,
  height: number,
): { id: string; dx: number; dy: number } | null {
  const wrists = layers.filter((layer) => layer.category === 'watch' || layer.category === 'bracelet')
  if (wrists.length < 2) return null
  const rank = (layer: { id: string; category: Category }) => {
    const at = order.indexOf(layer.id)
    if (at >= 0) return at
    return 1000 + (layer.category === 'watch' ? 0 : 1)
  }
  const ordered = [...wrists].sort((a, b) => rank(a) - rank(b))
  const first = ordered[0]
  const second = ordered[ordered.length - 1]
  const fitted = orientMarks(fitMarksToCanvas(marks, width, height))
  const wrist = wristWearPoint(fitted)
  const dx = fitted.rShoulder.x - wrist.x
  const dy = fitted.rShoulder.y - wrist.y
  const length = Math.hypot(dx, dy) || 1
  const shoulderW = Math.hypot(fitted.rShoulder.x - fitted.lShoulder.x, fitted.rShoulder.y - fitted.lShoulder.y)
  const distance = shoulderW * 0.046 * ((scaleOf(first.id) + scaleOf(second.id)) / 2)
  return { id: second.id, dx: (dx / length) * distance, dy: (dy / length) * distance }
}

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
  const long = category === 'dress'
  const ease = long ? 1.12 : 1.16
  let scale = (measure.shoulderW * ease) / content
  const widthCap = measure.shoulderW * (long ? 1.72 : 1.48)
  if (image.width * scale > widthCap) scale = widthCap / image.width
  if (image.width * scale < measure.shoulderW) scale = measure.shoulderW / image.width
  if (long) {
    const thighY = category === 'dress'
      ? measure.kneeY + (measure.kneeY - measure.hipY) * 0.35
      : measure.hipY + (measure.kneeY - measure.hipY) * 0.5
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
  if (category === 'top' || category === 'dress') return layoutWornTop(image, marks, category)
  if (category === 'pants' || category === 'skirt') return layoutWornBottom(image, marks)
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

const OVER_BODY: Category[] = ['hat', 'glasses', 'jewelry', 'necklace', 'earrings', 'bracelet', 'watch', 'bag']

function scalePoint(point: Point, sx: number, sy: number): Point {
  return { x: point.x * sx, y: point.y * sy }
}

function mapMarkPoints(marks: BodyMarks, map: (point: Point) => Point): BodyMarks {
  const next: BodyMarks = {
    nose: map(marks.nose),
    neck: map(marks.neck),
    lShoulder: map(marks.lShoulder),
    rShoulder: map(marks.rShoulder),
    lElbow: map(marks.lElbow),
    rElbow: map(marks.rElbow),
    lWrist: map(marks.lWrist),
    rWrist: map(marks.rWrist),
    lHip: map(marks.lHip),
    rHip: map(marks.rHip),
    lKnee: map(marks.lKnee),
    rKnee: map(marks.rKnee),
    lAnkle: map(marks.lAnkle),
    rAnkle: map(marks.rAnkle),
  }
  if (marks.lEar) next.lEar = map(marks.lEar)
  if (marks.rEar) next.rEar = map(marks.rEar)
  if (marks.neckLeft) next.neckLeft = map(marks.neckLeft)
  if (marks.neckRight) next.neckRight = map(marks.neckRight)
  return next
}

function fitMarksToCanvas(marks: BodyMarks, width: number, height: number): BodyMarks {
  const points = Object.values(marks).filter((point): point is Point => point != null)
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  const fromFrame = maxX <= FRAME_W + 2 && maxY <= FRAME_H + 2 && (width !== FRAME_W || height !== FRAME_H)
  if (!fromFrame) return marks
  const sx = width / FRAME_W
  const sy = height / FRAME_H
  return mapMarkPoints(marks, (point) => scalePoint(point, sx, sy))
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

function shapeSticker(category: Category): boolean {
  return (
    category === 'bag' ||
    category === 'jewelry' ||
    category === 'necklace' ||
    category === 'earrings' ||
    category === 'bracelet' ||
    category === 'watch' ||
    category === 'glasses'
  )
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

const PARSER_CLASS: Record<Category, number> = {
  top: 3,
  dress: 4,
  skirt: 5,
  pants: 6,
  shoes: 15,
  belt: 7,
  bag: 8,
  hat: 9,
  scarf: 10,
  glasses: 11,
  necklace: 17,
  earrings: 17,
  bracelet: 17,
  watch: 17,
  jewelry: 17,
}

const PARSER_W = 384
const PARSER_H = 576

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function fetchClothLabels(source: HTMLCanvasElement): Promise<{ labels: Uint8Array; width: number; height: number }> {
  const canvas = document.createElement('canvas')
  canvas.width = PARSER_W
  canvas.height = PARSER_H
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('服饰分割没有跑起来，这次没有保存。')
  context.drawImage(source, 0, 0, PARSER_W, PARSER_H)
  const pixels = context.getImageData(0, 0, PARSER_W, PARSER_H).data
  const rgb = new Uint8Array(PARSER_W * PARSER_H * 3)
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 3) {
    rgb[pixel] = pixels[index]
    rgb[pixel + 1] = pixels[index + 1]
    rgb[pixel + 2] = pixels[index + 2]
  }
  const response = await fetch('/api/cloth-mask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rgb: bytesToBase64(rgb) }),
  })
  if (!response.ok) throw new Error((await response.text()) || '服饰分割没有跑起来，这次没有保存。')
  const payload = (await response.json()) as { width?: number; height?: number; labels?: string }
  if (!payload.labels || !payload.width || !payload.height) throw new Error('服饰分割没有返回衣服区域，这次没有保存。')
  const labels = base64ToBytes(payload.labels)
  if (labels.length !== payload.width * payload.height) throw new Error('服饰分割没有返回衣服区域，这次没有保存。')
  return { labels, width: payload.width, height: payload.height }
}

function parserClassMask(
  labels: Uint8Array,
  labelW: number,
  labelH: number,
  width: number,
  height: number,
  category: Category,
): Uint8Array {
  const target = PARSER_CLASS[category]
  const full = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const ly = Math.min(labelH - 1, Math.floor(((y + 0.5) * labelH) / height))
    for (let x = 0; x < width; x += 1) {
      const lx = Math.min(labelW - 1, Math.floor(((x + 0.5) * labelW) / width))
      if (labels[ly * labelW + lx] === target) full[y * width + x] = 1
    }
  }
  return full
}

function clipToRegion(mask: Uint8Array, region: Uint8Array): Uint8Array {
  for (let index = 0; index < mask.length; index += 1) if (mask[index] && !region[index]) mask[index] = 0
  return mask
}

function keepScarfMask(
  mask: Uint8Array,
  labels: Uint8Array,
  worn: Uint8ClampedArray,
  width: number,
  height: number,
  palette: WornRgb[],
): Uint8Array {
  const candidate = mask.slice()
  for (let index = 0; index < candidate.length; index += 1) {
    if (!candidate[index] || labels[index] || palette.length === 0) continue
    const pixel = index * 4
    const rgb: WornRgb = [worn[pixel], worn[pixel + 1], worn[pixel + 2]]
    if (nearestColor(rgb, palette) >= 52) candidate[index] = 0
  }
  const seen = new Uint8Array(candidate.length)
  const kept = new Uint8Array(candidate.length)
  for (let index = 0; index < candidate.length; index += 1) {
    if (!candidate[index] || seen[index]) continue
    const pixels: number[] = []
    const stack = [index]
    seen[index] = 1
    let overlap = 0
    while (stack.length > 0) {
      const current = stack.pop() ?? 0
      pixels.push(current)
      if (labels[current]) overlap += 1
      const x = current % width
      const y = (current - x) / width
      if (x > 0) {
        const left = current - 1
        if (candidate[left] && !seen[left]) {
          seen[left] = 1
          stack.push(left)
        }
      }
      if (x + 1 < width) {
        const right = current + 1
        if (candidate[right] && !seen[right]) {
          seen[right] = 1
          stack.push(right)
        }
      }
      if (y > 0) {
        const up = current - width
        if (candidate[up] && !seen[up]) {
          seen[up] = 1
          stack.push(up)
        }
      }
      if (y + 1 < height) {
        const down = current + width
        if (candidate[down] && !seen[down]) {
          seen[down] = 1
          stack.push(down)
        }
      }
    }
    if (overlap < 40) continue
    for (const pixel of pixels) kept[pixel] = 1
  }
  return kept
}

function canvasOutsideMask(source: HTMLCanvasElement, mask: Uint8Array, fill: Rgb): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return source
  context.drawImage(source, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) continue
    const pixel = index * 4
    pixels[pixel] = fill[0]
    pixels[pixel + 1] = fill[1]
    pixels[pixel + 2] = fill[2]
    pixels[pixel + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return canvas
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
  _storedMarks: BodyMarks,
  category: Category,
): Promise<{ stickerBlob: Blob; stickerFrame: StickerFrame }> {
  const base = await blobToCanvas(baseBlob)
  const wornSource = await blobToCanvas(wornBlob)
  const garment = await blobToCanvas(garmentBlob)
  const worn = alignWorn(base, wornSource)
  const palette = garmentPalette(garment)
  const baseContext = base.getContext('2d', { willReadFrequently: true })
  const wornContext = worn.getContext('2d', { willReadFrequently: true })
  if (!baseContext || !wornContext) throw new Error('没能从穿上身的图里分出这件衣服。')
  const width = base.width
  const height = base.height
  const baseData = baseContext.getImageData(0, 0, width, height).data
  const wornData = wornContext.getImageData(0, 0, width, height).data
  const frame: PixelRect[] = [{ x0: 0, y0: 0, x1: width - 1, y1: height - 1 }]
  const shape = shapeSticker(category)
  const hollow = category === 'glasses'
  const minPixels = shape ? 36 : 80
  const finish = (source: Uint8Array) => {
    const box = boundsOf(source, width, height)
    const zones = box ? [box] : frame
    if (hollow) return keepComponents(keepGarmentPixels(source, wornData, width, zones, palette), width, height, 0)
    return shape
      ? solidShape(source, width, height, zones)
      : keepComponents(closeCloth(keepGarmentPixels(source, wornData, width, zones, palette), wornData, width, height, zones, palette), width, height, 0.03)
  }
  let core = paintDiffMask(baseData, wornData, width, frame, 28)
  let mask = finish(core)
  if (maskCount(mask) < minPixels) {
    core = paintDiffMask(baseData, wornData, width, frame, 16)
    mask = finish(core)
  }
  if (maskCount(mask) < minPixels && palette.length > 0) {
    core = paintMask(baseData, wornData, width, frame, palette, shape ? 54 : 50, 22, shape)
    mask = finish(core)
  }
  const parsed = await fetchClothLabels(worn)
  const labels = parserClassMask(parsed.labels, parsed.width, parsed.height, width, height, category)
  if (maskCount(labels) < minPixels) throw new Error('没有在上身图里标出这件单品，这次没有保存。')
  if (category === 'scarf') {
    mask = keepScarfMask(mask, labels, wornData, width, height, palette)
    const isolated = canvasOutsideMask(worn, mask, [196, 196, 196])
    const parsedAgain = await fetchClothLabels(isolated)
    const scarfAgain = parserClassMask(parsedAgain.labels, parsedAgain.width, parsedAgain.height, width, height, category)
    if (maskCount(scarfAgain) < minPixels) throw new Error('没有在上身图里标出这件单品，这次没有保存。')
    mask = clipToRegion(mask, scarfAgain)
    core = clipToRegion(core, scarfAgain)
  } else {
    const labelBox = boundsOf(labels, width, height)
    const classes = labelBox && !hollow ? fillHoles(labels, width, [labelBox]) : labels
    mask = clipToRegion(mask, classes)
    core = clipToRegion(core, classes)
  }
  const clipped = boundsOf(mask, width, height)
  if (clipped && !hollow && category !== 'scarf') {
    mask = shape ? fillHoles(mask, width, [clipped]) : fillClothHoles(mask, wornData, width, [clipped], palette)
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
      if (shape && !hollow && !core[at]) {
        const source = nearestCore(core, width, height, x + col, y + row)
        pixels[pixel] = wornData[source]
        pixels[pixel + 1] = wornData[source + 1]
        pixels[pixel + 2] = wornData[source + 2]
      }
      pixels[pixel + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const stickerFrame = { x, y, width: cropW, height: cropH }
  const png = new Uint8Array(await (await canvasToPng(cut)).arrayBuffer())
  const stamped = writeStickerFrame(png, stickerFrame)
  const packed = new ArrayBuffer(stamped.byteLength)
  new Uint8Array(packed).set(stamped)
  return {
    stickerBlob: new Blob([packed], { type: 'image/png' }),
    stickerFrame,
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
  if (category === 'top' || category === 'dress') {
    const elbow = Math.abs(marks.rElbow.x - marks.lElbow.x)
    const long = category !== 'top'
    const targetW = Math.max(measure.shoulderW * 1.45, elbow * 0.92, bodyW * (long ? 0.5 : 0.42))
    const hemY = long
      ? measure.hipY + (measure.kneeY - measure.hipY) * (category === 'dress' ? 0.9 : 0.55)
      : measure.hipY + (measure.hipY - measure.waistY) * 0.2
    const targetH = Math.max(80, hemY - measure.shoulderY, bodyH * (long ? 0.42 : 0.34))
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
  if (category === 'pants' || category === 'skirt') {
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

function scaleCanvas(image: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return image
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

function jewelrySource(source: HTMLCanvasElement): HTMLCanvasElement {
  let image = source
  if (solidBackdrop(image)) {
    const removed = removeSolidBackground(image)
    if (removed.removedRatio > 0.04 && removed.removedRatio < 0.93) image = removed.canvas
  }
  return trimAlpha(image, 2)
}

function columnInk(image: HTMLCanvasElement): Uint32Array | null {
  const context = image.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const { width, height } = image
  const data = context.getImageData(0, 0, width, height).data
  const counts = new Uint32Array(width)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 24) counts[x] += 1
    }
  }
  return counts
}

function splitEarringPair(image: HTMLCanvasElement): [HTMLCanvasElement, HTMLCanvasElement] | null {
  const trimmed = trimAlpha(image, 1)
  if (trimmed.width < 16 || trimmed.height < 16) return null
  const counts = columnInk(trimmed)
  if (!counts) return null
  const width = trimmed.width
  let peak = 0
  for (let x = 0; x < width; x += 1) if (counts[x] > peak) peak = counts[x]
  if (peak < 8) return null
  const valley = Math.max(4, peak * 0.12)
  let bestStart = -1
  let bestEnd = -1
  let run = -1
  const from = Math.floor(width * 0.18)
  const to = Math.ceil(width * 0.82)
  for (let x = from; x < to; x += 1) {
    if (counts[x] <= valley) {
      if (run < 0) run = x
    } else if (run >= 0) {
      if (x - run > bestEnd - bestStart) {
        bestStart = run
        bestEnd = x
      }
      run = -1
    }
  }
  if (run >= 0 && to - run > bestEnd - bestStart) {
    bestStart = run
    bestEnd = to
  }
  if (bestStart < 0 || bestEnd - bestStart < Math.max(6, width * 0.03)) return null
  const cut = Math.round((bestStart + bestEnd) / 2)
  let leftInk = 0
  let rightInk = 0
  for (let x = 0; x < cut; x += 1) leftInk += counts[x]
  for (let x = cut; x < width; x += 1) rightInk += counts[x]
  if (leftInk < peak * 4 || rightInk < peak * 4) return null
  if (leftInk < rightInk * 0.2 || rightInk < leftInk * 0.2) return null
  const left = trimAlpha(cropImage(trimmed, 0, 0, cut, trimmed.height), 1)
  const right = trimAlpha(cropImage(trimmed, cut, 0, width - cut, trimmed.height), 1)
  if (left.width < 4 || right.width < 4) return null
  return [left, right]
}


function pointBounds(points: Point[], pad: number): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return {
    x: Math.floor(minX - pad),
    y: Math.floor(minY - pad),
    width: Math.max(1, Math.ceil(maxX - minX + pad * 2)),
    height: Math.max(1, Math.ceil(maxY - minY + pad * 2)),
  }
}


function placeFlatJewelry(image: HTMLCanvasElement, x: number, y: number, scale: number): { canvas: HTMLCanvasElement; x: number; y: number } {
  const canvas = scaleCanvas(image, scale)
  return { canvas, x: x - canvas.width / 2, y }
}

function anchorsPlausible(marks: BodyMarks): boolean {
  if (!marks.lEar || !marks.rEar || !marks.neckLeft || !marks.neckRight) return false
  const shoulder = Math.hypot(marks.rShoulder.x - marks.lShoulder.x, marks.rShoulder.y - marks.lShoulder.y)
  const neckW = Math.hypot(marks.neckRight.x - marks.neckLeft.x, marks.neckRight.y - marks.neckLeft.y)
  return neckW > shoulder * 0.2
}

function wornAnchors(marks: BodyMarks): { lEar: Point; rEar: Point; neckLeft: Point; neckRight: Point } {
  if (anchorsPlausible(marks) && marks.lEar && marks.rEar && marks.neckLeft && marks.neckRight) {
    return { lEar: marks.lEar, rEar: marks.rEar, neckLeft: marks.neckLeft, neckRight: marks.neckRight }
  }
  return jewelryPoints(marks.nose, marks.neck, marks.lShoulder, marks.rShoulder)
}

function composeEarrings(source: HTMLCanvasElement, marks: BodyMarks): { canvas: HTMLCanvasElement; x: number; y: number } {
  const measure = wearMeasures(marks)
  const face = Math.max(36, marks.neck.y - marks.nose.y)
  const anchors = wornAnchors(marks)
  const lobes = [anchors.lEar, anchors.rEar]
  const pair = splitEarringPair(source)
  const pieces = pair ?? [source, source]
  const placed = pieces.map((piece, index) => {
    const lobe = lobes[index] ?? lobes[0]
    const tall = piece.height > piece.width * 1.8
    const target = tall ? Math.max(face * 1.15, measure.shoulderW * 0.36) : Math.max(10, measure.shoulderW * 0.055)
    let scale = tall ? target / piece.height : target / piece.width
    const maxH = Math.max(face * 1.35, measure.shoulderW * 0.42)
    const minH = Math.max(8, face * 0.07)
    if (piece.height * scale > maxH) scale = maxH / piece.height
    if (piece.height * scale < minH) scale = minH / piece.height
    const width = Math.max(1, Math.round(piece.width * scale))
    const height = Math.max(1, Math.round(piece.height * scale))
    const hang = piece.height > piece.width * 1.35
    return { piece, x: lobe.x - width / 2, y: hang ? lobe.y : lobe.y - height / 2, width, height }
  })
  const x0 = Math.min(...placed.map((item) => item.x))
  const y0 = Math.min(...placed.map((item) => item.y))
  const x1 = Math.max(...placed.map((item) => item.x + item.width))
  const y1 = Math.max(...placed.map((item) => item.y + item.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(x1 - x0))
  canvas.height = Math.max(1, Math.round(y1 - y0))
  const context = canvas.getContext('2d')
  if (!context) return { canvas: source, x: x0, y: y0 }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  for (const item of placed) context.drawImage(item.piece, Math.round(item.x - x0), Math.round(item.y - y0), item.width, item.height)
  return { canvas, x: x0, y: y0 }
}

function placeNecklace(image: HTMLCanvasElement, marks: BodyMarks): { canvas: HTMLCanvasElement; x: number; y: number } {
  const measure = wearMeasures(marks)
  const face = Math.max(36, marks.neck.y - marks.nose.y)
  const anchors = wornAnchors(marks)
  const neckLeft = anchors.neckLeft.x <= anchors.neckRight.x ? anchors.neckLeft : anchors.neckRight
  const neckRight = anchors.neckLeft.x <= anchors.neckRight.x ? anchors.neckRight : anchors.neckLeft
  const neckW = Math.max(48, neckRight.x - neckLeft.x)
  let scale = neckW / image.width
  const maxH = Math.max(face * 1.35, (measure.hipY - marks.neck.y) * 0.42)
  if (image.height * scale > maxH) scale = maxH / image.height
  const wornW = image.width * scale
  const wornH = image.height * scale
  const topY = (neckLeft.y + neckRight.y) / 2
  const topLeft = { x: marks.neck.x - wornW / 2, y: topY }
  const topRight = { x: marks.neck.x + wornW / 2, y: topY }
  const bow = wornW * 0.07
  const bottomLeft = { x: topLeft.x, y: topLeft.y + wornH }
  const bottomRight = { x: topRight.x, y: topRight.y + wornH }
  const leftControl = { x: topLeft.x - bow, y: topLeft.y + wornH * 0.48 }
  const rightControl = { x: topRight.x + bow, y: topRight.y + wornH * 0.48 }
  const strips = Math.max(32, Math.min(image.height, 220))
  const samples: Point[] = []
  for (let index = 0; index <= strips; index += 1) {
    const t = index / strips
    samples.push(quadPoint(topLeft, leftControl, bottomLeft, t), quadPoint(topRight, rightControl, bottomRight, t))
  }
  const box = pointBounds(samples, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, box.width)
  canvas.height = Math.max(1, box.height)
  const context = canvas.getContext('2d')
  if (!context) return placeFlatJewelry(image, marks.neck.x, marks.neck.y, scale)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const slice = image.height / strips
  for (let index = 0; index < strips; index += 1) {
    const t0 = index / strips
    const t1 = (index + 1) / strips
    const from = quadPoint(topLeft, leftControl, bottomLeft, t0)
    const to = quadPoint(topRight, rightControl, bottomRight, t0)
    const next = quadPoint(topLeft, leftControl, bottomLeft, t1)
    const sy = index * slice
    context.save()
    context.transform(
      (to.x - from.x) / image.width,
      (to.y - from.y) / image.width,
      (next.x - from.x) / slice,
      (next.y - from.y) / slice,
      from.x - box.x,
      from.y - box.y,
    )
    context.drawImage(image, 0, sy, image.width, slice + 0.75, 0, 0, image.width, slice + 0.75)
    context.restore()
  }
  return { canvas, x: box.x, y: box.y }
}

function wristFront(image: HTMLCanvasElement): HTMLCanvasElement {
  const cropW = Math.max(1, Math.round(image.width * 0.5))
  const x = Math.floor((image.width - cropW) / 2)
  return cropImage(image, x, 0, cropW, image.height)
}

function placeWristJewelry(image: HTMLCanvasElement, marks: BodyMarks): { canvas: HTMLCanvasElement; x: number; y: number } {
  const front = wristFront(image)
  const measure = wearMeasures(marks)
  const long = front.height > front.width * 1.15
  const target = Math.max(22, measure.shoulderW * (long ? 0.2 : 0.145))
  const scale = target / (long ? front.height : front.width)
  const width = Math.max(1, Math.round(front.width * scale))
  const height = Math.max(1, Math.round(front.height * scale))
  const wear = wristWearPoint(marks)
  const axis = Math.atan2(marks.rShoulder.y - wear.y, marks.rShoulder.x - wear.x)
  const rotation = long ? axis + Math.PI / 2 : 0
  const pad = Math.ceil(Math.hypot(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = pad
  canvas.height = pad
  const context = canvas.getContext('2d')
  if (!context) return placeFlatJewelry(front, wear.x, wear.y - height / 2, scale)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.translate(pad / 2, pad / 2)
  context.rotate(rotation)
  context.drawImage(front, -width / 2, -height / 2, width, height)
  const bounds = alphaBounds(canvas, 12)
  const trimmed = trimAlpha(canvas, 1)
  if (!bounds) return { canvas: trimmed, x: wear.x - trimmed.width / 2, y: wear.y - trimmed.height / 2 }
  const trimX = Math.max(0, bounds.x - 1)
  const trimY = Math.max(0, bounds.y - 1)
  return {
    canvas: trimmed,
    x: wear.x - (bounds.x + bounds.w / 2 - trimX),
    y: wear.y - (bounds.y + bounds.h / 2 - trimY),
  }
}

async function packPlacedSticker(canvas: HTMLCanvasElement, x: number, y: number): Promise<{ stickerBlob: Blob; stickerFrame: StickerFrame }> {
  const stickerFrame = { x: Math.round(x), y: Math.round(y), width: canvas.width, height: canvas.height }
  const png = new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer())
  const stamped = writeStickerFrame(png, stickerFrame)
  const packed = new ArrayBuffer(stamped.byteLength)
  new Uint8Array(packed).set(stamped)
  return { stickerBlob: new Blob([packed], { type: 'image/png' }), stickerFrame }
}

function hasJewelryAnchors(marks: BodyMarks): boolean {
  return anchorsPlausible(marks)
}

async function withJewelryAnchors(base: HTMLCanvasElement, marks: BodyMarks): Promise<BodyMarks> {
  const fitted = orientMarks(fitMarksToCanvas(marks, base.width, base.height))
  if (hasJewelryAnchors(fitted)) return fitted
  const photo = base.width === FRAME_W && base.height === FRAME_H ? paintStudio(base) : base
  try {
    const detected = await detectMarks(photo)
    if (detected?.lEar && detected.rEar && detected.neckLeft && detected.neckRight) {
      return orientMarks({ ...fitted, lEar: detected.lEar, rEar: detected.rEar, neckLeft: detected.neckLeft, neckRight: detected.neckRight })
    }
  } catch {
    return orientMarks({ ...fitted, ...jewelryPoints(fitted.nose, fitted.neck, fitted.lShoulder, fitted.rShoulder) })
  }
  return orientMarks({ ...fitted, ...jewelryPoints(fitted.nose, fitted.neck, fitted.lShoulder, fitted.rShoulder) })
}

export async function completeJewelryMarks(profile: BodyProfile): Promise<BodyProfile | null> {
  if (hasJewelryAnchors(profile.marks) && hasJewelryAnchors(profile.normalizedMarks)) return null
  const image = await blobToCanvas(profile.imageBlob)
  const normalized = await blobToCanvas(profile.normalizedBlob)
  const marks = hasJewelryAnchors(profile.marks) ? profile.marks : await withJewelryAnchors(image, profile.marks)
  const normalizedMarks = hasJewelryAnchors(profile.normalizedMarks) ? profile.normalizedMarks : await withJewelryAnchors(normalized, profile.normalizedMarks)
  return { ...profile, marks, normalizedMarks }
}

export async function placeJewelryCutout(
  bodyBlob: Blob,
  cutoutBlob: Blob,
  marks: BodyMarks,
  category: Category,
): Promise<{ stickerBlob: Blob; stickerFrame: StickerFrame }> {
  const base = await blobToCanvas(bodyBlob)
  const oriented = await withJewelryAnchors(base, marks)
  const source = jewelrySource(await blobToCanvas(cutoutBlob))
  const placed =
    category === 'earrings'
      ? composeEarrings(source, oriented)
      : category === 'necklace'
        ? placeNecklace(source, oriented)
        : placeWristJewelry(source, oriented)
  return packPlacedSticker(placed.canvas, placed.x, placed.y)
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
  const kept = { png: sticker, baseWidth: base.width, baseHeight: base.height, refit: false, store: false }
  if (solidBackdrop(stickerCanvas)) {
    return fitGarmentOnBody(base, marks, product ?? sticker, category)
  }
  if (stickerCanvas.width === base.width && stickerCanvas.height === base.height) {
    return { ...kept, frame: { x: 0, y: 0, width: base.width, height: base.height } }
  }
  if (placed && frameFitsImage(placed, stickerCanvas.width, stickerCanvas.height)) {
    return { ...kept, frame: placed }
  }
  const embedded = readStickerFrame(new Uint8Array(await sticker.arrayBuffer()))
  if (embedded && frameFitsImage(embedded, stickerCanvas.width, stickerCanvas.height)) {
    return { ...kept, frame: embedded, refit: true, store: true }
  }
  const oriented = await marksOnPhoto(base, marks, true)
  const laid = placeCutout(stickerCanvas, oriented, category, base.width, base.height)
  return {
    ...kept,
    frame: {
      x: laid.frame.x + (laid.frame.width - stickerCanvas.width) / 2,
      y: laid.frame.y + (laid.frame.height - stickerCanvas.height) / 2,
      width: stickerCanvas.width,
      height: stickerCanvas.height,
    },
  }
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
      if (item.category === 'top' || item.category === 'dress') paintWornTop(placed, garment, oriented, item.category)
      else if (item.category === 'pants' || item.category === 'skirt') paintWornBottom(placed, garment, oriented)
      else if (item.category === 'shoes') paintWornShoes(placed, garment, oriented)
      else paintMesh(placed, garment, garmentGrid(oriented, item.category))
      if (item.category === 'top' || item.category === 'dress' || item.category === 'scarf' || item.category === 'jewelry') {
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
    if (item.category === 'top' || item.category === 'dress') paintWornTop(context, item.image, oriented, item.category)
    else if (item.category === 'pants' || item.category === 'skirt') paintWornBottom(context, item.image, oriented)
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
