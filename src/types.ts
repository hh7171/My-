export type Category =
  | 'top'
  | 'dress'
  | 'skirt'
  | 'pants'
  | 'outer'
  | 'shoes'
  | 'belt'
  | 'bag'
  | 'hat'
  | 'scarf'
  | 'glasses'
  | 'jewelry'
export type BodyType = 'straight' | 'pear' | 'hourglass' | 'apple'
export type GarmentStatus = 'owned' | 'wishlist'
export type Season = 'spring' | 'summer' | 'winter'
export type LookMode = 'closet' | 'tryon'
export type View = 'home' | 'account' | 'body' | 'closet' | 'wishlist' | 'looks'

export type Account = {
  id: string
  name: string
  phone: string
  avatarBlob: Blob
  createdAt: number
}

export type Point = { x: number; y: number }

export type BodyMarks = {
  nose: Point
  neck: Point
  lShoulder: Point
  rShoulder: Point
  lElbow: Point
  rElbow: Point
  lWrist: Point
  rWrist: Point
  lHip: Point
  rHip: Point
  lKnee: Point
  rKnee: Point
  lAnkle: Point
  rAnkle: Point
}

export type Adjustments = {
  shoulder: number
  waist: number
  hip: number
  leg: number
}

export type BodyProfile = {
  heightCm: number
  weightKg: number
  bodyType: BodyType
  adjustments: Adjustments
  sourceBlob: Blob
  normalizedBlob: Blob
  normalizedMarks: BodyMarks
  imageBlob: Blob
  marks: BodyMarks
  demo: boolean
  segmented: boolean
  posed: boolean
  person?: boolean
  updatedAt: number
}

export type StickerPlace = {
  dx: number
  dy: number
  scale: number
}

export type StickerFrame = {
  x: number
  y: number
  width: number
  height: number
}

export type Garment = {
  id: string
  userId?: string
  name: string
  category: Category
  status: GarmentStatus
  season?: Season
  cutoutBlob: Blob
  originalBlob?: Blob
  color: string
  stickerBlob?: Blob
  stickerFor?: number
  stickerVer?: number
  stickerPlace?: StickerPlace
  stickerFrame?: StickerFrame
  createdAt: number
}

export const STICKER_VERSION = 18

export function modelGarmentBlob(item: { cutoutBlob: Blob }): Blob {
  return item.cutoutBlob
}

export function stickerVersionFor(category: Category): number {
  void category
  return STICKER_VERSION
}

export function stickerAligned(
  item: { stickerBlob?: Blob; stickerFor?: number },
  updatedAt: number,
): boolean {
  if (!item.stickerBlob) return false
  return item.stickerFor == null || item.stickerFor === updatedAt
}

export function stickerCurrent(
  item: { stickerBlob?: Blob; stickerFor?: number; stickerVer?: number; category?: Category },
  updatedAt: number,
): boolean {
  if (!stickerAligned(item, updatedAt)) return false
  return item.stickerVer === stickerVersionFor(item.category ?? 'top')
}

export type Look = {
  id: string
  userId?: string
  mode: LookMode
  garmentIds: string[]
  imageBlob: Blob
  createdAt: number
}

export const CATEGORY_ORDER: Category[] = [
  'top',
  'dress',
  'skirt',
  'pants',
  'outer',
  'shoes',
  'belt',
  'bag',
  'hat',
  'scarf',
  'glasses',
  'jewelry',
]

export function canMakeOutfit(categories: Iterable<Category>): boolean {
  const present = new Set(categories)
  if (present.has('dress')) return true
  return present.has('top') && (present.has('pants') || present.has('skirt'))
}

export const CATEGORY_LABEL: Record<Category, string> = {
  top: '上衣',
  dress: '连衣裙',
  skirt: '裙子',
  pants: '裤子',
  outer: '外套',
  shoes: '鞋子',
  belt: '腰带',
  bag: '包',
  hat: '帽子',
  scarf: '围巾',
  glasses: '眼镜',
  jewelry: '珠宝',
}

export const CLOTHING_ORDER: Category[] = ['top', 'dress', 'skirt', 'pants', 'outer', 'shoes']

export const ACCESSORY_ORDER: Category[] = ['belt', 'bag', 'hat', 'scarf', 'glasses', 'jewelry']

export const SEASON_ORDER: Season[] = ['spring', 'summer', 'winter']

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春秋装',
  summer: '夏装',
  winter: '冬装',
}

export const BODY_LABEL: Record<BodyType, string> = {
  straight: '直筒',
  pear: '梨形',
  hourglass: '沙漏',
  apple: '苹果形',
}

export const ZERO_ADJUSTMENTS: Adjustments = {
  shoulder: 0,
  waist: 0,
  hip: 0,
  leg: 0,
}
