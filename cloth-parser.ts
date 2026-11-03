import { join } from 'node:path'
import * as ort from 'onnxruntime-node'

const WIDTH = 384
const HEIGHT = 576
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const LABEL_NAMES = [
  'background',
  'face',
  'hair',
  'top',
  'dress',
  'skirt',
  'pants',
  'belt',
  'bag',
  'hat',
  'scarf',
  'glasses',
  'arms',
  'hands',
  'legs',
  'feet',
  'torso',
  'jewelry',
]

let sessionPromise: Promise<ort.InferenceSession> | null = null

function loadSession() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(join(process.cwd(), 'models/fashn-human-parser/model_quantized.onnx'), {
      executionProviders: ['cpu'],
    }).catch((error: unknown) => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

function argmaxLabels(data: Float32Array | number[], dims: readonly number[]): Uint8Array {
  const labels = new Uint8Array(HEIGHT * WIDTH)
  const channels = dims.length === 4 && dims[1] > 1 && dims[1] <= 32 ? dims[1] : dims[dims.length - 1]
  const channelsFirst = dims.length === 4 && dims[1] === channels
  const srcH = channelsFirst ? dims[2] : dims[1]
  const srcW = channelsFirst ? dims[3] : dims[2]
  const plane = srcH * srcW
  for (let y = 0; y < HEIGHT; y += 1) {
    const sy = ((y + 0.5) * srcH) / HEIGHT - 0.5
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = Math.min(1, Math.max(0, sy - y0))
    for (let x = 0; x < WIDTH; x += 1) {
      const sx = ((x + 0.5) * srcW) / WIDTH - 0.5
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = Math.min(1, Math.max(0, sx - x0))
      let best = 0
      let bestValue = Number.NEGATIVE_INFINITY
      for (let channel = 0; channel < channels; channel += 1) {
        const at = (yy: number, xx: number) => {
          if (channelsFirst) return Number(data[channel * plane + yy * srcW + xx])
          return Number(data[(yy * srcW + xx) * channels + channel])
        }
        const value =
          at(y0, x0) * (1 - fx) * (1 - fy) +
          at(y0, x1) * fx * (1 - fy) +
          at(y1, x0) * (1 - fx) * fy +
          at(y1, x1) * fx * fy
        if (value > bestValue) {
          bestValue = value
          best = channel
        }
      }
      labels[y * WIDTH + x] = best
    }
  }
  return labels
}

export async function parseClothRgb(rgb: Buffer): Promise<{ width: number; height: number; labels: Buffer }> {
  if (rgb.length !== WIDTH * HEIGHT * 3) throw new Error('服饰分割收到的图片尺寸不对')
  const session = await loadSession()
  const inputName = session.inputNames[0]
  if (!inputName) throw new Error('服饰分割模型没有输入')
  const normalized = new Float32Array(3 * HEIGHT * WIDTH)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const pixel = (y * WIDTH + x) * 3
      for (let channel = 0; channel < 3; channel += 1) {
        normalized[channel * HEIGHT * WIDTH + y * WIDTH + x] = (rgb[pixel + channel] / 255 - MEAN[channel]) / STD[channel]
      }
    }
  }
  const tensor = new ort.Tensor('float32', normalized, [1, 3, HEIGHT, WIDTH])
  const output = await session.run({ [inputName]: tensor })
  const outputName = session.outputNames[0]
  const logits = outputName ? output[outputName] : undefined
  if (!logits) throw new Error('服饰分割没有返回衣服区域')
  const labels = argmaxLabels(logits.data as Float32Array, logits.dims)
  const counts = new Map<string, number>()
  for (let index = 0; index < labels.length; index += 1) {
    const name = LABEL_NAMES[labels[index]] ?? String(labels[index])
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const summary = [...counts.entries()]
    .filter(([, count]) => count > labels.length * 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}:${Math.round((count / labels.length) * 100)}%`)
    .join(' ')
  console.log('cloth parser', summary)
  return { width: WIDTH, height: HEIGHT, labels: Buffer.from(labels) }
}
