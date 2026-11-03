import type { BodyMarks, Category } from './types.ts'
import { fitImageToFrame } from './imaging.ts'
import mannequinUrl from './assets/mannequin.png'

const MANNEQUIN_MARKS: BodyMarks = {
  nose: { x: 246, y: 138 },
  neck: { x: 242, y: 196 },
  lShoulder: { x: 138, y: 214 },
  rShoulder: { x: 348, y: 214 },
  lElbow: { x: 100, y: 372 },
  rElbow: { x: 382, y: 372 },
  lWrist: { x: 78, y: 468 },
  rWrist: { x: 404, y: 468 },
  lHip: { x: 172, y: 480 },
  rHip: { x: 322, y: 480 },
  lKnee: { x: 190, y: 700 },
  rKnee: { x: 300, y: 700 },
  lAnkle: { x: 188, y: 915 },
  rAnkle: { x: 296, y: 915 },
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('白模图片没有载入'))
    image.src = url
  })
}

function sameSide(x: number, y: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0 === (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0
}

function insidePlayIcon(x: number, y: number): boolean {
  const nx = (x - 218) / 42
  const ny = (y - 510) / 38
  if (nx * nx + ny * ny <= 1) return true
  const ax = 196
  const ay = 482
  const bx = 196
  const by = 538
  const cx = 272
  const cy = 510
  return (
    sameSide(x, y, ax, ay, bx, by, cx, cy) &&
    sameSide(x, y, bx, by, cx, cy, ax, ay) &&
    sameSide(x, y, cx, cy, ax, ay, bx, by)
  )
}

function erasePlayIcon(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  const width = canvas.width
  const height = canvas.height
  const image = context.getImageData(0, 0, width, height)
  const pixels = image.data
  const hard = new Uint8Array(width * height)
  for (let y = 468; y <= 552; y += 1) {
    for (let x = 170; x <= 280; x += 1) {
      if (insidePlayIcon(x, y)) hard[y * width + x] = 1
    }
  }
  const soft = new Float32Array(hard)
  const blurred = new Float32Array(soft.length)
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 466; y <= 554; y += 1) {
      for (let x = 168; x <= 282; x += 1) {
        let total = 0
        let count = 0
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            total += soft[(y + oy) * width + (x + ox)]
            count += 1
          }
        }
        blurred[y * width + x] = total / count
      }
    }
    soft.set(blurred)
  }
  const axis = 247
  const copyFrom = (x: number, y: number, channel: number) => pixels[(y * width + x) * 4 + channel]
  for (let y = 466; y <= 554; y += 1) {
    for (let x = 168; x <= 282; x += 1) {
      const fade = soft[y * width + x]
      if (fade < 0.02) continue
      let sourceX = axis * 2 - x
      if (sourceX < 0) sourceX = 0
      if (sourceX >= width) sourceX = width - 1
      const mirrored = hard[y * width + sourceX] === 1
      const sampleX = mirrored ? x : sourceX
      const sampleY = mirrored ? 560 : y
      const index = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const source = copyFrom(sampleX, sampleY, channel)
        pixels[index + channel] = source * fade + pixels[index + channel] * (1 - fade)
      }
    }
  }
  context.putImageData(image, 0, 0)
}

export async function buildMannequin(): Promise<{ canvas: HTMLCanvasElement; marks: BodyMarks }> {
  const image = await loadImage(mannequinUrl)
  const source = document.createElement('canvas')
  source.width = image.naturalWidth
  source.height = image.naturalHeight
  const context = source.getContext('2d')
  if (!context) throw new Error('白模图片没有载入')
  context.drawImage(image, 0, 0)
  erasePlayIcon(source)
  return fitImageToFrame(source, MANNEQUIN_MARKS)
}

export type DrawnGarment = {
  canvas: HTMLCanvasElement
  name: string
  category: Category
  color: string
}

function garmentCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建画布')
  return context
}

export function drawStripeTop(): DrawnGarment {
  const context = garmentCanvas(520, 640)
  context.fillStyle = '#f6f1ea'
  context.beginPath()
  context.moveTo(150, 78)
  context.lineTo(96, 150)
  context.lineTo(78, 214)
  context.lineTo(132, 228)
  context.lineTo(156, 168)
  context.lineTo(176, 560)
  context.quadraticCurveTo(260, 598, 344, 560)
  context.lineTo(364, 168)
  context.lineTo(388, 228)
  context.lineTo(442, 214)
  context.lineTo(424, 150)
  context.lineTo(370, 78)
  context.quadraticCurveTo(260, 118, 150, 78)
  context.closePath()
  context.fill()
  context.save()
  context.clip()
  context.strokeStyle = '#9c3b2e'
  context.lineWidth = 16
  for (let y = 120; y < 600; y += 42) {
    context.beginPath()
    context.moveTo(60, y)
    context.lineTo(470, y + 28)
    context.stroke()
  }
  context.restore()
  context.fillStyle = '#f6f1ea'
  context.beginPath()
  context.moveTo(214, 86)
  context.lineTo(260, 150)
  context.lineTo(306, 86)
  context.quadraticCurveTo(260, 64, 214, 86)
  context.fill()

  return { canvas: context.canvas, name: '砖红条纹上衣', category: 'top', color: '#9c3b2e' }
}

