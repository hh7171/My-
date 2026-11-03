import { useState } from 'react'
import { BlobImg } from '../components.tsx'
import { useWardrobe } from '../store.tsx'
import { BODY_LABEL } from '../types.ts'

const PHONE = /^1[3-9]\d{9}$/

export function AccountPage({ setup = false }: { setup?: boolean }) {
  const { account, body, saveAccount, setNav, notify } = useWardrobe()
  const [name, setName] = useState(account?.name ?? '')
  const [phone, setPhone] = useState(account?.phone ?? '')
  const [avatar, setAvatar] = useState<Blob | null>(account?.avatarBlob ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function takeAvatar(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('头像请用 JPG 或 PNG。')
      return
    }
    setAvatar(file)
    setError('')
  }

  async function save() {
    const nextName = name.trim()
    const nextPhone = phone.trim()
    if (!nextName) {
      setError('请填写名称。')
      return
    }
    if (nextName.length > 20) {
      setError('名称最多 20 个字。')
      return
    }
    if (!PHONE.test(nextPhone)) {
      setError('请填写 11 位大陆手机号。')
      return
    }
    if (!avatar) {
      setError('请上传头像。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveAccount({ name: nextName, phone: nextPhone, avatarBlob: avatar })
      notify(account ? '资料已保存' : '已建立这个用户')
      if (setup) setNav('home')
    } catch {
      setError('资料没有保存，请再试一次。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account">
      <p className="kicker">{setup ? '第一次使用' : '我的'}</p>
      <h1>{setup ? '先留下你是谁。' : account?.name}</h1>
      {setup ? <p className="lede">名称、头像和之后的衣橱都会写进本机的 data 文件夹。清掉浏览器数据后，重新打开就会装回来。</p> : null}

      <section className="identity">
        <label
          className="avatar-pick"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files[0]
            if (file) takeAvatar(file)
          }}
        >
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) takeAvatar(file)
            }}
          />
          {avatar ? <BlobImg blob={avatar} alt="头像" className="avatar-lg" /> : <span className="avatar-lg empty">头像</span>}
          <span>{avatar ? '更换头像' : '上传头像'}</span>
        </label>
        <div className="identity-fields">
          <label>
            名称
            <input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            手机号
            <input value={phone} inputMode="numeric" maxLength={11} onChange={(event) => setPhone(event.target.value)} />
          </label>
          {account ? (
            <p className="hint id-line">
              用户 ID
              <code>{account.id}</code>
            </p>
          ) : (
            <p className="hint">保存后会生成用户 ID。手机号只做格式检查，存在这台电脑上。</p>
          )}
          {error ? <p className="error">{error}</p> : null}
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? '正在保存…' : setup ? '进入衣橱' : '保存资料'}
          </button>
        </div>
      </section>

      {setup ? null : (
        <section className="body-card">
          {body ? <BlobImg blob={body.imageBlob} alt="身形" className="body-thumb" /> : <div className="body-thumb" />}
          <div>
            <p className="kicker">身形</p>
            {body ? (
              <>
                <h2>
                  {body.heightCm} cm · {body.weightKg} kg · {BODY_LABEL[body.bodyType]}
                </h2>
                <p className="hint">
                  {body.person
                    ? '这是按全身照生成的基准图。搭配和试穿都保持这张脸和身材，只换衣服。'
                    : '这还是白模。上传全身照并生成基准图后，搭配会保持本人的脸。'}
                </p>
              </>
            ) : (
              <>
                <h2>还没有基准图</h2>
                <p className="hint">上传全身照，生成一个穿着运动背心和紧身裤的本人。搭配和试穿都用这张图。</p>
              </>
            )}
            <button type="button" className="primary" onClick={() => setNav('body')}>
              {body ? '调整身形' : '建立身形'}
            </button>
          </div>
        </section>
      )}
      {setup ? null : <p className="hint folder-note">衣橱写在这个项目的 data 文件夹里。换浏览器或清掉网站数据后，重新打开会从这里装回来。</p>}
    </div>
  )
}
