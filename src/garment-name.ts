import type { Category, GarmentStatus, Season } from './types.ts'

const CLOTHING = new Set<Category>(['top', 'dress', 'skirt', 'pants', 'shoes'])

export const GARMENT_DIR =
  /^(?:wishlist\/)?(?:spring|summer|winter|accessory)\/(top|dress|skirt|pants|outer|shoes|belt|bag|hat|scarf|glasses|jewelry|bottom|necklace|earrings|bracelet|watch)\/\1\d{2,}$/

export function isClothingCategory(category: Category): boolean {
  return CLOTHING.has(category)
}

export function isGarmentDir(value: string): boolean {
  return GARMENT_DIR.test(value)
}

export function garmentLabel(name: string, title?: string): string {
  const shown = title?.trim()
  if (shown) return shown
  const slash = name.lastIndexOf('/')
  return slash === -1 ? name : name.slice(slash + 1)
}

export function garmentNamePrompt(categoryLabel: string): string {
  return [
    `图中是一件已经选定类别的单品，类别是「${categoryLabel}」。`,
    '只给这一件起一个 2 到 6 个字的中文名字，风格类似「豹纹裤」「JK裙」「微喇裤」「卡其色短裤」「做旧色短裙」。',
    '名字要让人看出颜色、花纹或版型。不要只写类别。',
    '不要解释，不要标点，只返回名字。',
  ].join('\n')
}

export function acceptGarmentTitle(raw: string, categoryLabel?: string): string {
  const compact = raw
    .trim()
    .replace(/^名字[:：]?/, '')
    .replace(/[\s「」"'“”‘’。，、！？!?,.：:（）()【】[\]\-—]/g, '')
  if (!/^[\u4e00-\u9fffA-Za-z0-9]{2,8}$/.test(compact)) return ''
  if (categoryLabel && compact === categoryLabel) return ''
  return compact
}

export function addedOrder<T extends { id: string; createdAt: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function garmentGroup(category: Category, season?: Season): 'spring' | 'summer' | 'winter' | 'accessory' {
  if (!CLOTHING.has(category)) return 'accessory'
  return season ?? 'summer'
}

export function garmentName(status: GarmentStatus, category: Category, season: Season | undefined, index: number): string {
  const leaf = `${category}${String(index).padStart(2, '0')}`
  const path = `${garmentGroup(category, season)}/${category}/${leaf}`
  return status === 'wishlist' ? `wishlist/${path}` : path
}

export function nextGarmentName(
  items: Array<{ name: string; category: Category; status: GarmentStatus; season?: Season }>,
  status: GarmentStatus,
  category: Category,
  season?: Season,
): string {
  const group = garmentGroup(category, season)
  let max = 0
  for (const item of items) {
    if (item.status !== status || item.category !== category) continue
    if (garmentGroup(item.category, item.season) !== group) continue
    const match = GARMENT_DIR.exec(item.name)
    if (!match || match[1] !== category) continue
    max = Math.max(max, Number(item.name.slice(item.name.lastIndexOf(category) + category.length)))
  }
  return garmentName(status, category, season, max + 1)
}

function garmentIndex(name: string, category: Category): number {
  const match = GARMENT_DIR.exec(name)
  if (!match || match[1] !== category) return 0
  const leaf = name.slice(name.lastIndexOf('/') + 1)
  if (!leaf.startsWith(category)) return 0
  const index = Number(leaf.slice(category.length))
  return Number.isInteger(index) && index > 0 ? index : 0
}

export function relocatedGarmentName(
  items: Array<{ name: string; category: Category; status: GarmentStatus; season?: Season }>,
  item: { name: string; category: Category; status: GarmentStatus; season?: Season },
  season: Season,
): string | null {
  if (!CLOTHING.has(item.category) || (item.season ?? 'summer') === season) return null
  const used = new Set<number>()
  for (const other of items) {
    if (other.status !== item.status || other.category !== item.category || (other.season ?? 'summer') !== season) continue
    const index = garmentIndex(other.name, item.category)
    if (index > 0) used.add(index)
  }
  const current = garmentIndex(item.name, item.category)
  let index = current > 0 && !used.has(current) ? current : 1
  while (used.has(index)) index += 1
  return garmentName(item.status, item.category, season, index)
}
