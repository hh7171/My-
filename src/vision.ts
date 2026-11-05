import type { BodyMarks, Point } from './types.ts'

export function jewelryPoints(
  nose: Point,
  neck: Point,
  lShoulder: Point,
  rShoulder: Point,
  rawLeft?: Point,
  rawRight?: Point,
): { lEar: Point; rEar: Point; neckLeft: Point; neckRight: Point } {
  const face = Math.max(28, neck.y - nose.y)
  const shoulderW = Math.hypot(rShoulder.x - lShoulder.x, rShoulder.y - lShoulder.y)
  const lobe = (ear: Point): Point => {
    const outward = ear.x >= nose.x ? 1 : -1
    return { x: ear.x + outward * face * 0.04, y: ear.y + face * 0.12 }
  }
  const spread = shoulderW * 0.5
  const lobeY = nose.y + face * 0.18
  let left = rawLeft ? lobe(rawLeft) : { x: nose.x - spread / 2, y: lobeY }
  let right = rawRight ? lobe(rawRight) : { x: nose.x + spread / 2, y: lobeY }
  if (left.x > right.x) [left, right] = [right, left]
  const shoulderY = (lShoulder.y + rShoulder.y) / 2
  const neckHalf = shoulderW * 0.132
  const drop = Math.max(0, shoulderY - neck.y) * 0.17
  const y = neck.y + drop
  return {
    lEar: left,
    rEar: right,
    neckLeft: { x: neck.x - neckHalf, y },
    neckRight: { x: neck.x + neckHalf, y },
  }
}

export function wristWearPoint(marks: BodyMarks): Point {
  const shoulderW = Math.hypot(marks.rShoulder.x - marks.lShoulder.x, marks.rShoulder.y - marks.lShoulder.y)
  const hipY = (marks.lHip.y + marks.rHip.y) / 2
  return {
    x: marks.rShoulder.x - shoulderW * 0.03,
    y: hipY + shoulderW * 0.132,
  }
}

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const SELFIE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

type Fileset = unknown

type PoseLandmark = { x: number; y: number; visibility?: number }

type PoseLandmarker = {
  detect: (image: CanvasImageSource) => { landmarks: PoseLandmark[][] }
}

type Mask = {
  width: number
  height: number
  getAsUint8Array: () => Uint8Array
  close: () => void
}

type ImageSegmenter = {
  segment: (image: CanvasImageSource) => { categoryMask?: Mask | null }
}

type VisionModule = {
  FilesetResolver: { forVisionTasks: (base: string) => Promise<Fileset> }
  PoseLandmarker: {
    createFromOptions: (fileset: Fileset, options: unknown) => Promise<PoseLandmarker>
  }
  ImageSegmenter: {
    createFromOptions: (fileset: Fileset, options: unknown) => Promise<ImageSegmenter>
  }
}

let modulePromise: Promise<VisionModule> | null = null
let filesetPromise: Promise<Fileset> | null = null
let posePromise: Promise<PoseLandmarker> | null = null
let segmentPromise: Promise<ImageSegmenter> | null = null

function visionModule(): Promise<VisionModule> {
  if (!modulePromise) {
    const load = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<VisionModule>
    modulePromise = load('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm')
  }
  return modulePromise
}

async function fileset(): Promise<Fileset> {
  if (!filesetPromise) {
    filesetPromise = visionModule().then((mod) => mod.FilesetResolver.forVisionTasks(WASM_BASE))
  }
  return filesetPromise
}

async function poseLandmarker(): Promise<PoseLandmarker> {
  if (!posePromise) {
    posePromise = (async () => {
      const [mod, resolved] = await Promise.all([visionModule(), fileset()])
      return mod.PoseLandmarker.createFromOptions(resolved, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      })
    })()
  }
  return posePromise
}

async function imageSegmenter(): Promise<ImageSegmenter> {
  if (!segmentPromise) {
    segmentPromise = (async () => {
      const [mod, resolved] = await Promise.all([visionModule(), fileset()])
      return mod.ImageSegmenter.createFromOptions(resolved, {
        baseOptions: { modelAssetPath: SELFIE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      })
    })()
  }
  return segmentPromise
}

function pointFrom(landmark: PoseLandmark, width: number, height: number): Point {
  return { x: landmark.x * width, y: landmark.y * height }
}

function orderPair(first: PoseLandmark, second: PoseLandmark, width: number, height: number): [Point, Point] {
  const a = pointFrom(first, width, height)
  const b = pointFrom(second, width, height)
  return a.x <= b.x ? [a, b] : [b, a]
}

export async function segmentPerson(source: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  const segmenter = await imageSegmenter()
  const result = segmenter.segment(source)
  const mask = result.categoryMask
  if (!mask) return null

  const categories = mask.getAsUint8Array()
  const maskWidth = mask.width
  const maskHeight = mask.height
  mask.close()

  let personPixels = 0
  for (let i = 0; i < categories.length; i += 1) {
    if (categories[i] === 1) personPixels += 1
  }
  const ratio = personPixels / categories.length
  if (ratio < 0.04 || ratio > 0.94) return null

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  const scaleX = maskWidth / canvas.width
  const scaleY = maskHeight / canvas.height

  for (let y = 0; y < canvas.height; y += 1) {
    const maskY = Math.min(maskHeight - 1, Math.floor(y * scaleY))
    for (let x = 0; x < canvas.width; x += 1) {
      const maskX = Math.min(maskWidth - 1, Math.floor(x * scaleX))
      if (categories[maskY * maskWidth + maskX] !== 1) {
        pixels[(y * canvas.width + x) * 4 + 3] = 0
      }
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

export async function detectMarks(source: HTMLCanvasElement): Promise<BodyMarks | null> {
  const landmarker = await poseLandmarker()
  const result = landmarker.detect(source)
  const landmarks = result.landmarks[0]
  if (!landmarks || landmarks.length < 29) return null

  const visible = (index: number) => (landmarks[index]?.visibility ?? 1) > 0.35
  if (!visible(11) || !visible(12) || !visible(23) || !visible(24)) return null

  const width = source.width
  const height = source.height
  const [lShoulder, rShoulder] = orderPair(landmarks[11], landmarks[12], width, height)
  const [lElbow, rElbow] = orderPair(landmarks[13], landmarks[14], width, height)
  const [lWrist, rWrist] = orderPair(landmarks[15], landmarks[16], width, height)
  const [lHip, rHip] = orderPair(landmarks[23], landmarks[24], width, height)
  const [lKnee, rKnee] = orderPair(landmarks[25], landmarks[26], width, height)
  const [lAnkle, rAnkle] = orderPair(landmarks[27], landmarks[28], width, height)
  const nose = pointFrom(landmarks[0], width, height)
  const shoulderMid = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
  }
  const neck = {
    x: shoulderMid.x,
    y: shoulderMid.y - (shoulderMid.y - nose.y) * 0.38,
  }
  const ears: Point[] = []
  for (const index of [7, 8]) {
    const landmark = landmarks[index]
    if (!landmark || (landmark.visibility ?? 1) < 0.15) continue
    ears.push(pointFrom(landmark, width, height))
  }
  let rawLeft: Point | undefined
  let rawRight: Point | undefined
  if (ears.length >= 2) {
    ears.sort((a, b) => a.x - b.x)
    rawLeft = ears[0]
    rawRight = ears[1]
  } else if (ears.length === 1) {
    const ear = ears[0]
    const mirror = { x: nose.x * 2 - ear.x, y: ear.y }
    if (ear.x <= nose.x) {
      rawLeft = ear
      rawRight = mirror
    } else {
      rawLeft = mirror
      rawRight = ear
    }
  }

  return {
    nose,
    neck,
    lShoulder,
    rShoulder,
    lElbow,
    rElbow,
    lWrist,
    rWrist,
    lHip,
    rHip,
    lKnee,
    rKnee,
    lAnkle,
    rAnkle,
    ...jewelryPoints(nose, neck, lShoulder, rShoulder, rawLeft, rawRight),
  }
}
