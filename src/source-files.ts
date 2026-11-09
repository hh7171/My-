export type SourceName = 'generated' | 'video' | 'real' | 'realVideo'
export type SourcePage = 'closet' | 'tryon'

export type SourceMeta = {
  id: string
  page: SourcePage
  garmentIds: string[]
  kept: boolean
  updatedAt: number
}

export async function writeSource(
  id: string,
  name: SourceName,
  blob: Blob,
  meta?: { page: SourcePage; garmentIds: string[] },
): Promise<void> {
  const data = await blobToBase64(blob)
  const response = await fetch('/api/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      op: 'put',
      id,
      name,
      type: blob.type || (name === 'video' || name === 'realVideo' ? 'video/mp4' : 'image/jpeg'),
      data,
      ...(meta ? { page: meta.page, garmentIds: meta.garmentIds } : {}),
    }),
  })
  if (!response.ok) throw new Error((await response.text()) || '文件没有写下来')
}

export async function readSource(id: string, name: SourceName): Promise<Blob | null> {
  const response = await fetch(`/api/source/file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, { cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error((await response.text()) || '文件没有读出来')
  return response.blob()
}

export async function dropSource(id: string, name: SourceName): Promise<void> {
  const response = await fetch('/api/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'drop', id, name }),
  })
  if (!response.ok) throw new Error((await response.text()) || '文件没有去掉')
}

export async function keepSource(id: string): Promise<void> {
  const response = await fetch('/api/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'keep', id }),
  })
  if (!response.ok) throw new Error((await response.text()) || '这套原片没有留住')
}

export async function latestOpenSource(page: SourcePage): Promise<SourceMeta | null> {
  const response = await fetch('/api/source', { cache: 'no-store' })
  if (!response.ok) return null
  const body = (await response.json()) as { items?: SourceMeta[] }
  const open = (body.items ?? []).filter((item) => item.page === page && !item.kept)
  open.sort((a, b) => b.updatedAt - a.updatedAt)
  for (const item of open) {
    const still = await readSource(item.id, 'generated')
    if (still) return item
  }
  return null
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result)
      const comma = value.indexOf(',')
      resolve(comma === -1 ? value : value.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('文件没有准备好'))
    reader.readAsDataURL(blob)
  })
}
