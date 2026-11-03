import { useWardrobe, WardrobeProvider } from './store.tsx'
import type { View } from './types.ts'
import { BlobImg } from './components.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { AccountPage } from './pages/AccountPage.tsx'
import { BodyPage } from './pages/BodyPage.tsx'
import { ClosetPage } from './pages/ClosetPage.tsx'
import { WishlistPage } from './pages/WishlistPage.tsx'
import { LooksPage } from './pages/LooksPage.tsx'

const NAV: { id: View; label: string }[] = [
  { id: 'home', label: '首页' },
  { id: 'closet', label: '衣橱' },
  { id: 'wishlist', label: '想买' },
  { id: 'looks', label: '穿搭' },
]

function Shell() {
  const { ready, bootText, nav, setNav, toast, account, body } = useWardrobe()
  if (!ready) {
    return (
      <div className="boot">
        <span className="chop">衣</span>
        <p>{bootText}</p>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="shell">
        <header className="topbar">
          <button className="brand" type="button">
            <span className="chop">衣</span>
            <span>电子衣橱</span>
          </button>
        </header>
        <main className="page">
          <AccountPage setup />
        </main>
      </div>
    )
  }

  const onAccount = nav === 'account' || nav === 'body'

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setNav('home')}>
          <span className="chop">衣</span>
          <span>电子衣橱</span>
        </button>
        <div className="top-end">
          <nav className="nav">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={nav === item.id ? 'active' : undefined}
                onClick={() => setNav(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className={onAccount ? 'avatar-btn active' : 'avatar-btn'}
            aria-label="我的"
            onClick={() => setNav('account')}
          >
            <BlobImg blob={account.avatarBlob} alt="" />
            {!body ? <i className="dot" /> : null}
          </button>
        </div>
      </header>
      <main className="page">
        {nav === 'home' && <HomePage />}
        {nav === 'account' && <AccountPage />}
        {nav === 'body' && <BodyPage />}
        <div hidden={nav !== 'closet'}>
          <ClosetPage />
        </div>
        <div hidden={nav !== 'wishlist'}>
          <WishlistPage />
        </div>
        {nav === 'looks' && <LooksPage />}
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

export default function App() {
  return (
    <WardrobeProvider>
      <Shell />
    </WardrobeProvider>
  )
}
