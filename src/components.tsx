import type { ReactNode } from 'react'
import { useObjectUrl } from './hooks.ts'

export function BlobImg({
  blob,
  alt,
  className,
}: {
  blob?: Blob | null
  alt: string
  className?: string
}) {
  const url = useObjectUrl(blob)
  if (!url) return <div className={className} />
  return <img src={url} alt={alt} className={className} />
}

export function Slider({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string
  left: string
  right: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="slider">
      <span className="slider-name">
        {label}
        <em>{value === 0 ? '按当前' : value > 0 ? right : left}</em>
      </span>
      <span className="slider-ends">
        <span>{left}</span>
        <span>{right}</span>
      </span>
      <input
        type="range"
        min={-40}
        max={40}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export function AdjustNote({
  value,
  busy,
  onChange,
  onSubmit,
}: {
  value: string
  busy: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="adjust"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && value.trim()) onSubmit()
      }}
    >
      <label>
        这张哪里要改
        <textarea
          value={value}
          rows={3}
          placeholder="例如：上衣下摆放在裤子外面，不要塞进裤腰。"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <p className="hint">脸和身材仍按基准图。衣服仍按点选的单品。这句话只规定这些衣服怎么穿。</p>
      <button type="submit" className="ghost" disabled={busy || !value.trim()}>
        {busy ? '正在按这些单品重新生成…' : '按这个穿法重新生成'}
      </button>
    </form>
  )
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
