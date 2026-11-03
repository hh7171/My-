import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { FRAME_H, FRAME_W } from './imaging.ts'
import type { Adjustments, BodyMarks, Point } from './types.ts'

export type BodyFit = {
  shoulder: number
  bust: number
  waist: number
  hip: number
  thigh: number
  torso: number
  leg: number
}

/** Proportions of the glossy fashion mannequin used as the style reference. */
export const REFERENCE_FIT: BodyFit = {
  shoulder: 0.25,
  bust: 0.188,
  waist: 0.142,
  hip: 0.214,
  thigh: 0.086,
  torso: 0.3,
  leg: 0.468,
}

/** Slim, longer-legged reading of a full-body portrait when joints cannot be read. */
const PORTRAIT_FIT: BodyFit = {
  shoulder: 0.222,
  bust: 0.164,
  waist: 0.128,
  hip: 0.186,
  thigh: 0.08,
  torso: 0.284,
  leg: 0.492,
}

type Measures = {
  heightCm: number
  weightKg: number
  thickness?: number
}

type Layout = {
  h: number
  neckR: number
  chestR: number
  bustR: number
  waistR: number
  hipR: number
  thighR: number
  calfR: number
  armR: number
  shoulderX: number
  hipX: number
  ankleY: number
  kneeY: number
  hipY: number
  waistY: number
  bustY: number
  shoulderY: number
  neckY: number
  headY: number
  headR: number
  upperArm: number
  forearm: number
}

let renderer: THREE.WebGLRenderer | null = null
let environment: THREE.Texture | null = null

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function mixFit(base: BodyFit, toward: BodyFit, amount: number): BodyFit {
  const keys = Object.keys(base) as (keyof BodyFit)[]
  const next = { ...base }
  for (const key of keys) next[key] = base[key] + (toward[key] - base[key]) * amount
  return next
}

export function fitFromMarks(marks: BodyMarks, posed: boolean): BodyFit {
  if (!posed) return { ...PORTRAIT_FIT }
  const shoulderW = Math.hypot(marks.rShoulder.x - marks.lShoulder.x, marks.rShoulder.y - marks.lShoulder.y)
  const hipW = Math.hypot(marks.rHip.x - marks.lHip.x, marks.rHip.y - marks.lHip.y)
  const shoulderY = (marks.lShoulder.y + marks.rShoulder.y) / 2
  const hipY = (marks.lHip.y + marks.rHip.y) / 2
  const ankleY = (marks.lAnkle.y + marks.rAnkle.y) / 2
  const headTop = marks.nose.y - Math.abs(marks.neck.y - marks.nose.y) * 1.35
  const bodyH = Math.max(40, ankleY - headTop)
  const measured: BodyFit = {
    shoulder: clamp(shoulderW / bodyH, 0.18, 0.28),
    bust: clamp((shoulderW / bodyH) * 0.74, 0.14, 0.21),
    waist: clamp(Math.min(shoulderW, hipW) / bodyH * 0.7, 0.11, 0.19),
    hip: clamp(hipW / bodyH, 0.15, 0.25),
    thigh: clamp((hipW / bodyH) * 0.4, 0.06, 0.11),
    torso: clamp((hipY - shoulderY) / bodyH, 0.24, 0.36),
    leg: clamp((ankleY - hipY) / bodyH, 0.4, 0.54),
  }
  return mixFit(REFERENCE_FIT, measured, 0.72)
}

function thicknessOf(measures: Measures) {
  if (measures.thickness) return measures.thickness
  const meters = clamp(measures.heightCm, 120, 220) / 100
  const bmi = measures.weightKg / (meters * meters)
  return clamp(1 + (bmi - 21) * 0.028, 0.84, 1.22)
}

function layoutOf(fit: BodyFit, adjustments: Adjustments, measures: Measures): Layout {
  const thick = thicknessOf(measures)
  const shoulderScale = 1 + adjustments.shoulder / 115
  const waistScale = 1 + adjustments.waist / 115
  const hipScale = 1 + adjustments.hip / 115
  const legScale = 1 + adjustments.leg / 145
  const h = 1.7
  const torso = h * fit.torso
  const leg = h * fit.leg * legScale
  const ankleY = 0.045
  const kneeY = ankleY + leg * 0.46
  const hipY = ankleY + leg
  const shoulderY = hipY + torso
  const waistY = hipY + torso * 0.42
  const bustY = hipY + torso * 0.74
  const headR = h * 0.068
  const neckY = shoulderY + headR * 0.42
  const headY = neckY + headR * 1.05
  const hipR = h * fit.hip * 0.5 * hipScale * thick
  return {
    h,
    neckR: h * 0.032 * (0.85 + thick * 0.15),
    chestR: h * fit.bust * 0.46 * thick,
    bustR: h * fit.bust * 0.5 * thick,
    waistR: h * fit.waist * 0.5 * waistScale * thick,
    hipR,
    thighR: h * fit.thigh * 0.5 * (0.78 + hipScale * 0.22) * thick,
    calfR: h * fit.thigh * 0.36 * thick,
    armR: h * 0.026 * (0.88 + thick * 0.12),
    shoulderX: Math.max(h * fit.bust * 0.5 * thick * 0.78, (h * fit.shoulder * 0.5) * shoulderScale * 0.94),
    hipX: h * fit.thigh * 0.5 * thick * 0.72,
    ankleY,
    kneeY,
    hipY,
    waistY,
    bustY,
    shoulderY,
    neckY,
    headY,
    headR,
    upperArm: h * 0.168,
    forearm: h * 0.15,
  }
}

function limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) {
  const direction = new THREE.Vector3().subVectors(to, from)
  const length = Math.max(radius * 2.15, direction.length())
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 6, 18), material)
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return mesh
}

function joint(position: THREE.Vector3, radius: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), material)
  mesh.position.copy(position)
  return mesh
}

function torso(layout: Layout, material: THREE.Material) {
  const points = [
    new THREE.Vector2(layout.hipR * 0.34, layout.hipY - layout.h * 0.045),
    new THREE.Vector2(layout.hipR * 0.78, layout.hipY - layout.h * 0.012),
    new THREE.Vector2(layout.hipR, layout.hipY + layout.h * 0.018),
    new THREE.Vector2(layout.hipR * 0.84, layout.hipY + (layout.waistY - layout.hipY) * 0.48),
    new THREE.Vector2(layout.waistR, layout.waistY),
    new THREE.Vector2(layout.bustR * 0.94, layout.bustY - layout.h * 0.028),
    new THREE.Vector2(layout.bustR, layout.bustY),
    new THREE.Vector2(layout.chestR * 1.08, layout.shoulderY - layout.h * 0.04),
    new THREE.Vector2(layout.neckR * 2.1, layout.shoulderY + layout.h * 0.004),
    new THREE.Vector2(layout.neckR * 0.82, layout.neckY),
  ]
  return new THREE.Mesh(new THREE.LatheGeometry(points, 56), material)
}

function hand(wrist: THREE.Vector3, outward: number, material: THREE.Material, layout: Layout) {
  const group = new THREE.Group()
  const palm = new THREE.Mesh(new THREE.SphereGeometry(layout.armR * 0.82, 18, 12), material)
  palm.scale.set(0.78, 1.55, 0.48)
  palm.position.copy(wrist)
  palm.position.y -= layout.armR * 1.05
  group.add(palm)
  for (let index = 0; index < 4; index += 1) {
    const root = palm.position.clone()
    root.y -= layout.armR * 1.2
    root.x += outward * (index - 1.5) * layout.armR * 0.2
    const tip = root.clone()
    tip.y -= layout.h * 0.02
    group.add(limb(root, tip, layout.armR * 0.16, material))
  }
  const thumbRoot = palm.position.clone()
  thumbRoot.x += outward * layout.armR * 0.55
  thumbRoot.y -= layout.armR * 0.2
  const thumbTip = thumbRoot.clone()
  thumbTip.y -= layout.h * 0.012
  thumbTip.x += outward * layout.h * 0.01
  group.add(limb(thumbRoot, thumbTip, layout.armR * 0.18, material))
  return group
}

function foot(ankle: THREE.Vector3, material: THREE.Material, layout: Layout) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(layout.calfR * 1.15, 22, 14), material)
  mesh.scale.set(1.2, 0.55, 2.2)
  mesh.position.set(ankle.x, ankle.y - layout.h * 0.01, layout.h * 0.02)
  return mesh
}

function backdrop() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) return new THREE.MeshBasicMaterial({ color: 0x9a9a9a })
  const gradient = context.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, '#5a5a5a')
  gradient.addColorStop(0.38, '#868686')
  gradient.addColorStop(0.72, '#b0b0b0')
  gradient.addColorStop(1, '#c6c6c6')
  context.fillStyle = gradient
  context.fillRect(0, 0, 32, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshBasicMaterial({ map: texture })
}

function shadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return new THREE.CanvasTexture(canvas)
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 60)
  gradient.addColorStop(0, 'rgba(40, 40, 40, 0.28)')
  gradient.addColorStop(1, 'rgba(40, 40, 40, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

function project(point: THREE.Vector3, camera: THREE.Camera): Point {
  const projected = point.clone().project(camera)
  return {
    x: (projected.x * 0.5 + 0.5) * FRAME_W,
    y: (-projected.y * 0.5 + 0.5) * FRAME_H,
  }
}

function ensureRenderer() {
  if (renderer) return renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
  renderer.setSize(FRAME_W, FRAME_H, false)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  const pmrem = new THREE.PMREMGenerator(renderer)
  environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return renderer
}

export function renderFashionBody(
  fit: BodyFit,
  adjustments: Adjustments,
  measures: Measures,
): { canvas: HTMLCanvasElement; marks: BodyMarks } {
  const view = ensureRenderer()
  const scene = new THREE.Scene()
  scene.environment = environment
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20)
  const layout = layoutOf(fit, adjustments, measures)
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf3f3f3,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 0.78,
    clearcoatRoughness: 0.18,
  })
  const figure = new THREE.Group()

  const head = new THREE.Mesh(new THREE.SphereGeometry(layout.headR, 40, 28), material)
  head.scale.set(0.94, 1.18, 0.96)
  head.position.set(0, layout.headY, 0)
  figure.add(head)
  figure.add(limb(
    new THREE.Vector3(0, layout.neckY - layout.headR * 0.15, 0),
    new THREE.Vector3(0, layout.shoulderY + layout.h * 0.012, 0),
    layout.neckR * 0.78,
    material,
  ))
  figure.add(torso(layout, material))

  const buildSide = (sign: number) => {
    const shoulder = new THREE.Vector3(sign * layout.shoulderX, layout.shoulderY - layout.h * 0.016, 0.01)
    const elbow = new THREE.Vector3(sign * (layout.shoulderX + layout.h * 0.04), layout.shoulderY - layout.upperArm, layout.h * 0.012)
    const wrist = new THREE.Vector3(sign * (layout.shoulderX + layout.h * 0.055), elbow.y - layout.forearm, layout.h * 0.016)
    const hip = new THREE.Vector3(sign * layout.hipR * 0.72, layout.hipY + layout.h * 0.02, 0.01)
    const knee = new THREE.Vector3(sign * layout.hipX, layout.kneeY, layout.h * 0.008)
    const ankle = new THREE.Vector3(sign * layout.hipX * 0.98, layout.h * 0.055, layout.h * 0.01)
    figure.add(limb(shoulder, elbow, layout.armR * 1.05, material))
    figure.add(joint(shoulder, layout.armR * 1.15, material))
    figure.add(joint(elbow, layout.armR * 1.2, material))
    figure.add(limb(elbow, wrist, layout.armR * 0.9, material))
    figure.add(joint(wrist, layout.armR * 0.95, material))
    figure.add(hand(wrist, sign, material, layout))
    figure.add(limb(hip, knee, layout.thighR, material))
    figure.add(joint(hip, layout.thighR * 0.82, material))
    figure.add(joint(knee, layout.thighR * 0.72, material))
    figure.add(limb(knee, ankle, layout.calfR * 1.15, material))
    figure.add(foot(ankle, material, layout))
    return { shoulder, elbow, wrist, hip, knee, ankle }
  }

  const left = buildSide(-1)
  const right = buildSide(1)
  scene.add(figure)

  const bounds = new THREE.Box3().setFromObject(figure)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const halfH = (size.y * 1.08) / 2
  const halfW = halfH * (FRAME_W / FRAME_H)
  camera.left = -halfW
  camera.right = halfW
  camera.top = halfH
  camera.bottom = -halfH
  camera.position.set(center.x, center.y, center.z + 5)
  camera.lookAt(center)
  camera.updateProjectionMatrix()

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 4, halfH * 4), backdrop())
  wall.position.set(center.x, center.y, bounds.min.z - 0.35)
  scene.add(wall)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(layout.h * 0.42, layout.h * 0.16), new THREE.MeshBasicMaterial({
    map: shadowTexture(),
    transparent: true,
    depthWrite: false,
  }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.set(0, bounds.min.y + 0.004, layout.h * 0.03)
  scene.add(shadow)

  scene.add(new THREE.AmbientLight(0xffffff, 0.22))
  const key = new THREE.DirectionalLight(0xffffff, 3.1)
  key.position.set(-1.6, 3.6, 4.4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xd5deea, 0.55)
  fill.position.set(2.8, 1.2, 2.6)
  scene.add(fill)

  view.render(scene, camera)
  const copy = document.createElement('canvas')
  copy.width = FRAME_W
  copy.height = FRAME_H
  copy.getContext('2d')?.drawImage(view.domElement, 0, 0)

  const nose = new THREE.Vector3(0, layout.headY - layout.headR * 0.12, layout.headR)
  const neck = new THREE.Vector3(0, layout.neckY, 0)
  const marks: BodyMarks = {
    nose: project(nose, camera),
    neck: project(neck, camera),
    lShoulder: project(left.shoulder, camera),
    rShoulder: project(right.shoulder, camera),
    lElbow: project(left.elbow, camera),
    rElbow: project(right.elbow, camera),
    lWrist: project(left.wrist, camera),
    rWrist: project(right.wrist, camera),
    lHip: project(left.hip, camera),
    rHip: project(right.hip, camera),
    lKnee: project(left.knee, camera),
    rKnee: project(right.knee, camera),
    lAnkle: project(left.ankle, camera),
    rAnkle: project(right.ankle, camera),
  }

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
  })
  material.dispose()
  return { canvas: copy, marks }
}
