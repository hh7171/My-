import { useState } from 'react'
import { TAG_LIMIT, uniqueTags } from './tags.ts'

export function TagPicker({
  selected,
  history,
  onChange,
  onInputChange,
}: {
  selected: string[]
  history: string[]
  onChange: (tags: string[]) => void
  onInputChange: (value: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const chosen = uniqueTags(selected)

  function setInput(value: string) {
    setDraft(value)
    onInputChange(value)
  }

  return (
    <div className="tag-box">
      <span className="tag-label">标签</span>
      <input
        type="text"
        value={draft}
        maxLength={TAG_LIMIT}
        placeholder="输入标签"
        aria-label="输入标签"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => setInput(event.target.value)}
      />
      {chosen.length > 0 ? (
        <div className="tag-row" aria-label="这套的标签">
          {chosen.map((tag) => (
            <span key={tag} className="tag-chip">
              <span>{tag}</span>
              <button
                type="button"
                className="tag-x"
                aria-label={`删除标签${tag}`}
                onClick={() => onChange(chosen.filter((item) => item !== tag))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {open && history.length > 0 ? (
        <div className="tag-row tag-history" aria-label="用过的标签">
          {history.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-used"
              onMouseDown={(event) => {
                event.preventDefault()
                setInput(tag)
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
