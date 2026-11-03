import type { Category, GarmentStatus, Season } from './types.ts'

const CLOTHING = new Set<Category>(['top', 'bottom', 'outer', 'shoes'])

export const GARMENT_DIR =
  /^(?:wishlist\/)?(?:spring|summer|winter|accessory)\/(top|bottom|outer|shoes|bag|hat|scarf|necklace|watch|belt)\/\1\d{2,}$/

export function isGarmentDir(value: string): boolean {
  return GARMENT_DIR.test(value)
}

export function garmentLabel(name: string): string {
  const slash = name.lastIndexOf('/')
  return slash === -1 ? name : name.slice(slash + 1)
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
