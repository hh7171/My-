type PosterPiece = { key: string; blob: Blob }
type Sprite = { canvas: HTMLCanvasElement; ratio: number }

export async function composeLookPoster(input: { photo: Blob; pieces: PosterPiece[] }): Promise<Blob> {
  const photo = await loadScaled(input.photo, 1800)
  const sprites = (await Promise.all(input.pieces.map((piece) => paperSprite(piece).catch(() => null)))).filter(
    (sprite): sprite is Sprite => Boolean(sprite),
  )
  if (sprites.length === 0) return canvasBlob(photo.canvas)
  const posterH = 1600
  const posterW = Math.round(posterH * 3 / 4)
  const ground = groundFrom((await Promise.all(input.pieces.map((piece) => sampleColors(piece.blob)))).flat())
  const oneSideW = Math.round(posterW / 3)
  const twoSideW = Math.round(posterW / 4)
  const plan = splitForPoster(sprites, posterH, oneSideW, twoSideW)
  const twoSides = plan.left.length > 0 && plan.right.length > 0
  const faceX = faceCenter(photo.canvas)
  const scale = posterH / photo.canvas.height
  const fullW = photo.canvas.width * scale
  const targetCenter = twoSides ? posterW - twoSideW * 2 : posterW - oneSideW
  const centerW = Math.round(Math.min(fullW, targetCenter))
  const leftW = twoSides ? Math.floor((posterW - centerW) / 2) : 0
  const rightW = posterW - centerW - leftW
  const poster = document.createElement('canvas')
  poster.width = posterW
  poster.height = posterH
  const context = poster.getContext('2d')
  if (!context) return canvasBlob(photo.canvas)
  if (leftW > 0) paintGround(context, ground, 0, 0, leftW, posterH)
  paintGround(context, ground, leftW + centerW, 0, rightW, posterH)
  const srcCropW = Math.max(1, Math.min(photo.canvas.width, centerW / scale))
  const srcX = clamp(faceX - srcCropW / 2, 0, photo.canvas.width - srcCropW)
  context.drawImage(photo.canvas, srcX, 0, srcCropW, photo.canvas.height, leftW, 0, centerW, posterH)
  if (leftW > 0) drawColumn(context, plan.left, 0, leftW, posterH)
  drawColumn(context, plan.right, leftW + centerW, rightW, posterH)
  return canvasBlob(poster)
}

function splitForPoster(
  items: Sprite[],
  photoHeight: number,
  oneSideW: number,
  twoSideW: number,
): { left: Sprite[]; right: Sprite[] } {
  if (columnFits(items, oneSideW, photoHeight)) return { left: [], right: items }
  const split = balance(items, items.map((item) => twoSideW * sideFill * item.ratio))
  if (split.left.length === 0 || split.right.length === 0) return { left: [], right: items }
  return split
}

function columnFits(items: Sprite[], sideWidth: number, photoHeight: number): boolean {
  const content = items.reduce((sum, item) => sum + sideWidth * sideFill * item.ratio, 0)
  return content + photoHeight * 0.035 * (items.length + 1) <= photoHeight
}

function faceCenter(source: HTMLCanvasElement): number {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return source.width / 2
  const pixels = context.getImageData(0, 0, source.width, source.height).data
  const width = source.width
  const height = source.height
  const step = 3
  const subjectAt = (x: number, y: number) => {
    const edgeX = x < width / 2 ? 2 : width - 3
    return Math.abs(tone(pixels, (y * width + x) * 4) - tone(pixels, (y * width + edgeX) * 4)) > 26
  }
  let top = height
  let bottom = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!subjectAt(x, y)) continue
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (bottom <= top) return width / 2
  const headEnd = Math.min(height - 1, top + Math.max(step * 4, Math.round((bottom - top) * 0.14)))
  let left = width
  let right = 0
  for (let y = top; y <= headEnd; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!subjectAt(x, y)) continue
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  if (right <= left) return width / 2
  return (left + right) / 2
}

function tone(pixels: Uint8ClampedArray, offset: number): number {
  return pixels[offset] * 0.3 + pixels[offset + 1] * 0.5 + pixels[offset + 2] * 0.2
}

const sideFill = 0.97

function drawColumn(
  context: CanvasRenderingContext2D,
  items: Sprite[],
  columnX: number,
  sideWidth: number,
  photoHeight: number,
) {
  if (items.length === 0) return
  const inner = sideWidth * sideFill
  let heights = items.map((item) => inner * item.ratio)
  const minGap = Math.max(8, Math.round(photoHeight * 0.015))
  let content = heights.reduce((sum, value) => sum + value, 0)
  const room = photoHeight - minGap * (items.length + 1)
  if (content > room && content > 0) {
    const scale = room / content
    heights = heights.map((value) => value * scale)
    content = heights.reduce((sum, value) => sum + value, 0)
  }
  const gap = (photoHeight - content) / (items.length + 1)
  let y = gap
  items.forEach((item, index) => {
    const height = heights[index]
    const width = height / item.ratio
    const x = columnX + (sideWidth - width) / 2
    context.save()
    context.shadowColor = 'rgba(40, 32, 24, 0.16)'
    context.shadowBlur = 18
    context.shadowOffsetY = 8
    context.drawImage(item.canvas, x, y, width, height)
    context.restore()
    y += height + gap
  })
}

async function paperSprite(piece: PosterPiece): Promise<Sprite> {
  const source = await loadScaled(piece.blob, 520)
  const bounds = opaqueBounds(source.canvas)
  const crop = cropCanvas(source.canvas, bounds)
  const pad = clamp(Math.round(Math.max(crop.width, crop.height) * 0.22), 36, 110)
  const canvas = document.createElement('canvas')
  canvas.width = crop.width + pad * 2
  canvas.height = crop.height + pad * 2
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { canvas: crop, ratio: crop.height / Math.max(1, crop.width) }
  context.drawImage(crop, pad, pad)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  const body = productMask(pixels, canvas.width, canvas.height)
  const dist = distanceFrom(body, canvas.width, canvas.height, pad + 8)
  const seed = hashKey(piece.key)
  for (let index = 0; index < body.length; index += 1) {
    const pixel = index * 4
    const x = index % canvas.width
    const y = Math.floor(index / canvas.width)
    const reach = pad * (0.8 + (fieldNoise(x, y, seed) - 0.5) * 0.32)
    if (body[index] === 0 && dist[index] > reach) {
      pixels[pixel + 3] = 0
      continue
    }
    if (pixels[pixel + 3] < 40) {
      pixels[pixel] = 255
      pixels[pixel + 1] = 255
      pixels[pixel + 2] = 255
      pixels[pixel + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const trimmed = cropCanvas(canvas, opaqueBounds(canvas))
  return { canvas: trimmed, ratio: trimmed.height / Math.max(1, trimmed.width) }
}

function productMask(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  let opaque = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (pixels[index * 4 + 3] > 40) {
      mask[index] = 1
      opaque += 1
    }
  }
  if (opaque / mask.length < 0.9) return mask
  const outside = new Uint8Array(mask.length)
  const queueX: number[] = []
  const queueY: number[] = []
  const push = (x: number, y: number) => {
    const index = y * width + x
    if (outside[index] || !pale(pixels, index * 4)) return
    outside[index] = 1
    queueX.push(x)
    queueY.push(y)
  }
  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }
  for (let head = 0; head < queueX.length; head += 1) {
    const x = queueX[head]
    const y = queueY[head]
    if (x > 0) push(x - 1, y)
    if (x + 1 < width) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y + 1 < height) push(x, y + 1)
  }
  for (let index = 0; index < mask.length; index += 1) {
    if (outside[index]) mask[index] = 0
  }
  return mask
}

function pale(pixels: Uint8ClampedArray, offset: number): boolean {
  if (pixels[offset + 3] < 40) return true
  return pixels[offset] > 244 && pixels[offset + 1] > 244 && pixels[offset + 2] > 244
}

function distanceFrom(mask: Uint8Array, width: number, height: number, limit: number): Float32Array {
  const dist = new Float32Array(mask.length)
  dist.fill(limit + 2)
  const queueX = new Int32Array(mask.length)
  const queueY = new Int32Array(mask.length)
  let tail = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask[index] === 0) continue
      dist[index] = 0
      queueX[tail] = x
      queueY[tail] = y
      tail += 1
    }
  }
  let head = 0
  while (head < tail) {
    const x = queueX[head]
    const y = queueY[head]
    const base = dist[y * width + x]
    head += 1
    if (base >= limit) continue
    const step = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return
      const next = ny * width + nx
      if (dist[next] <= base + 1) return
      dist[next] = base + 1
      queueX[tail] = nx
      queueY[tail] = ny
      tail += 1
    }
    step(x + 1, y)
    step(x - 1, y)
    step(x, y + 1)
    step(x, y - 1)
  }
  return dist
}

function fieldNoise(x: number, y: number, seed: number): number {
  const scale = 22
  const x0 = Math.floor(x / scale)
  const y0 = Math.floor(y / scale)
  const tx = x / scale - x0
  const ty = y / scale - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const at = (ix: number, iy: number) => {
    let hash = Math.imul(ix + seed, 374761393) + Math.imul(iy + (seed >>> 3), 668265263)
    hash = (hash ^ (hash >>> 13)) >>> 0
    return (hash % 1000) / 999
  }
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
  return top + (bottom - top) * sy
}

function balance<T>(items: T[], heights: number[]): { left: T[]; right: T[] } {
  const ranked = items.map((item, index) => ({ item, index, height: heights[index] ?? 0 }))
  ranked.sort((a, b) => b.height - a.height || a.index - b.index)
  const left: typeof ranked = []
  const right: typeof ranked = []
  let leftSum = 0
  let rightSum = 0
  for (const entry of ranked) {
    if (leftSum <= rightSum) {
      left.push(entry)
      leftSum += entry.height
    } else {
      right.push(entry)
      rightSum += entry.height
    }
  }
  const restore = (group: typeof ranked) => group.sort((a, b) => a.index - b.index).map((entry) => entry.item)
  return { left: restore(left), right: restore(right) }
}

async function loadScaled(blob: Blob, maxEdge: number): Promise<{ canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('无法读取图片')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return { canvas }
}

function opaqueBounds(source: HTMLCanvasElement): { x: number; y: number; w: number; h: number } {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return { x: 0, y: 0, w: source.width, h: source.height }
  const pixels = context.getImageData(0, 0, source.width, source.height).data
  let minX = source.width
  let minY = source.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < source.height; y += 2) {
    for (let x = 0; x < source.width; x += 2) {
      if (pixels[(y * source.width + x) * 4 + 3] < 24) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: source.width, h: source.height }
  return {
    x: minX,
    y: minY,
    w: Math.min(source.width - minX, maxX - minX + 2),
    h: Math.min(source.height - minY, maxY - minY + 2),
  }
}

function cropCanvas(source: HTMLCanvasElement, bounds: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, bounds.w)
  canvas.height = Math.max(1, bounds.h)
  const context = canvas.getContext('2d')
  if (!context) return source
  context.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, canvas.width, canvas.height)
  return canvas
}

function paintGround(context: CanvasRenderingContext2D, ground: string, x: number, y: number, width: number, height: number) {
  const colors = [...ground.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0])
  if (ground.startsWith('linear-gradient') && colors.length >= 2) {
    const gradient = context.createLinearGradient(x, y, x, y + height)
    gradient.addColorStop(0, colors[0])
    gradient.addColorStop(1, colors[1])
    context.fillStyle = gradient
  } else {
    context.fillStyle = colors[0] ?? ground
  }
  context.fillRect(x, y, width, height)
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法保存穿搭图'))), 'image/jpeg', 0.92)
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

async function sampleColors(blob: Blob): Promise<Array<[number, number, number]>> {
  const bitmap = await createImageBitmap(blob)
  const scale = 96 / Math.max(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    return []
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const colors: Array<[number, number, number]> = []
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 170) continue
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    if (red > 244 && green > 244 && blue > 244) continue
    colors.push([red, green, blue])
  }
  return colors
}

function groundFrom(colors: Array<[number, number, number]>): string {
  if (colors.length === 0) return '#d5cfc4'
  const bins = new Map<number, { h: number; count: number; r: number; g: number; b: number }>()
  let neutralCount = 0
  let neutralLight = 0
  for (const [red, green, blue] of colors) {
    const [hue, sat, light] = rgbToHsl(red, green, blue)
    if (sat < 0.12) {
      neutralCount += 1
      neutralLight += light
      continue
    }
    const bin = Math.round(hue / 15) % 24
    const current = bins.get(bin) ?? { h: hue, count: 0, r: 0, g: 0, b: 0 }
    current.count += 1
    current.r += red
    current.g += green
    current.b += blue
    current.h += hue
    bins.set(bin, current)
  }
  const groups = cluster(
    [...bins.values()].map((bin) => ({
      h: bin.h / bin.count,
      count: bin.count,
      r: bin.r / bin.count,
      g: bin.g / bin.count,
      b: bin.b / bin.count,
    })),
  ).filter((group) => rgbToHsl(group.r, group.g, group.b)[1] >= 0.14)
  const chroma = groups.reduce((sum, group) => sum + group.count, 0)
  const total = colors.length
  if (chroma < total * 0.28 || groups.length === 0) {
    const light = neutralCount > 0 ? neutralLight / neutralCount : 0.45
    return neutralGround(light)
  }
  const first = soften(groups[0].r, groups[0].g, groups[0].b)
  const second = groups.slice(1).find((group) => hueDistance(group.h, groups[0].h) > 36 && group.count > chroma * 0.22)
  if (!second) return first
  const next = soften(second.r, second.g, second.b)
  if (hexDistance(first, next) < 36) return first
  return `linear-gradient(180deg, ${first}, ${next})`
}

function cluster(bins: Array<{ h: number; count: number; r: number; g: number; b: number }>) {
  const rest = [...bins].sort((a, b) => b.count - a.count)
  const used = new Set<number>()
  const groups: typeof rest = []
  for (let index = 0; index < rest.length; index += 1) {
    if (used.has(index)) continue
    used.add(index)
    const group = { ...rest[index] }
    for (let other = 0; other < rest.length; other += 1) {
      if (used.has(other)) continue
      if (hueDistance(rest[index].h, rest[other].h) > 32) continue
      used.add(other)
      const count = group.count + rest[other].count
      group.r = (group.r * group.count + rest[other].r * rest[other].count) / count
      group.g = (group.g * group.count + rest[other].g * rest[other].count) / count
      group.b = (group.b * group.count + rest[other].b * rest[other].count) / count
      group.h = rest[index].h
      group.count = count
    }
    groups.push(group)
  }
  return groups.sort((a, b) => b.count - a.count)
}

function soften(red: number, green: number, blue: number): string {
  const [hue, sat] = rgbToHsl(red, green, blue)
  if (sat < 0.12) return neutralGround(rgbToHsl(red, green, blue)[2])
  return hslToHex(hue, clamp(sat, 0.22, 0.46), 0.75)
}

function neutralGround(light: number): string {
  return hslToHex(30, 0.04, clamp(0.58 + light * 0.18, 0.6, 0.78))
}

function hexDistance(a: string, b: string): number {
  const read = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
  const [ar, ag, ab] = read(a)
  const [br, bg, bb] = read(b)
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)
}

function hueDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360
  return Math.min(delta, 360 - delta)
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, light]
  const sat = delta / (1 - Math.abs(2 * light - 1))
  let hue = 0
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue *= 60
  if (hue < 0) hue += 360
  return [hue, sat, light]
}

function hslToHex(hue: number, sat: number, light: number): string {
  const chroma = (1 - Math.abs(2 * light - 1)) * sat
  const section = hue / 60
  const x = chroma * (1 - Math.abs((section % 2) - 1))
  const match = light - chroma / 2
  let red = 0
  let green = 0
  let blue = 0
  if (section < 1) [red, green, blue] = [chroma, x, 0]
  else if (section < 2) [red, green, blue] = [x, chroma, 0]
  else if (section < 3) [red, green, blue] = [0, chroma, x]
  else if (section < 4) [red, green, blue] = [0, x, chroma]
  else if (section < 5) [red, green, blue] = [x, 0, chroma]
  else [red, green, blue] = [chroma, 0, x]
  const hex = (value: number) => Math.round((value + match) * 255).toString(16).padStart(2, '0')
  return `#${hex(red)}${hex(green)}${hex(blue)}`
}

function hashKey(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
