export const TAG_LIMIT = 16
export const TAGS_PER_LOOK = 12

export function normalizeTag(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ')
  return [...text].slice(0, TAG_LIMIT).join('')
}

export function uniqueTags(values: readonly string[], limit = TAGS_PER_LOOK): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const tag = normalizeTag(value)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    next.push(tag)
    if (next.length >= limit) break
  }
  return next
}
