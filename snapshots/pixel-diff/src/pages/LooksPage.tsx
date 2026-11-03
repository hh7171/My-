import { useState } from 'react'
import { BlobImg } from '../components.tsx'
import { garmentLabel } from '../garment-name.ts'
import { formatWhen } from '../hooks.ts'
import { useWardrobe } from '../store.tsx'
import type { LookMode } from '../types.ts'

export function LooksPage() {
  const { looks, garments, deleteLook } = useWardrobe()
  const [mode, setMode] = useState<'all' | LookMode>('all')
  const visible = looks.filter((look) => mode === 'all' || look.mode === mode)

  async function remove(id: string) {
    if (!window.confirm('删除这张穿搭记录？')) return
    await deleteLook(id)
  }

  return (
    <div>
      <p className="kicker">存下来的</p>
      <h1>穿搭</h1>
      <p className="lede">日常搭配和试穿记录分开。试穿记录里可能还有当时没买的衣服。</p>
      <div className="chips">
        <button type="button" className={mode === 'all' ? 'chip selected' : 'chip'} onClick={() => setMode('all')}>
          全部
        </button>
        <button type="button" className={mode === 'closet' ? 'chip selected' : 'chip'} onClick={() => setMode('closet')}>
          日常搭配
        </button>
        <button type="button" className={mode === 'tryon' ? 'chip selected' : 'chip'} onClick={() => setMode('tryon')}>
          试穿
        </button>
      </div>
      {visible.length === 0 ? (
        <div className="placeholder">
          <p>还没有保存的穿搭。</p>
        </div>
      ) : (
        <div className="look-grid">
          {visible.map((look) => {
            const names = look.garmentIds
              .map((id) => {
                const name = garments.find((item) => item.id === id)?.name
                return name ? garmentLabel(name) : undefined
              })
              .filter((name): name is string => Boolean(name))
            return (
              <article key={look.id} className="look-card">
                <BlobImg blob={look.imageBlob} alt="穿搭效果" />
                <div className="card-meta">
                  <div>
                    <strong>{look.mode === 'closet' ? '日常搭配' : '试穿'}</strong>
                    <small>{formatWhen(look.createdAt)}</small>
                    {names.length > 0 ? <small>{names.join(' + ')}</small> : null}
                  </div>
                  <button type="button" className="text-button" onClick={() => void remove(look.id)}>
                    删除
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
