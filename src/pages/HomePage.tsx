import { useWardrobe } from '../store.tsx'

export function HomePage() {
  const { body, garments, looks, setNav } = useWardrobe()
  const owned = garments.filter((item) => item.status === 'owned').length
  const wished = garments.filter((item) => item.status === 'wishlist').length

  return (
    <div className="home">
      <p className="kicker">电子衣橱</p>
      <h1>先看上身，再决定穿不穿、买不买。</h1>
      <p className="lede">衣橱里搭配已经买的衣服。想买里试穿还没买的，也可以再贴上衣橱里的衣服一起看。两条路用的是同一个人的基准图。</p>

      <div className="doors">
        <button type="button" className="door" onClick={() => setNav('closet')}>
          <span className="kicker">平常穿</span>
          <strong>搭配衣橱</strong>
          <span>在衣橱里点选上衣和裤子或裙子，再点搭配。只点连衣裙也可以。鞋、包和配饰可以一起选。</span>
        </button>
        <button type="button" className="door" onClick={() => setNav('wishlist')}>
          <span className="kicker">想买的时候</span>
          <strong>试穿网图</strong>
          <span>在想买里点选还没买的单品，再试穿。可以贴上衣橱里的衣服，看它们搭在一起。</span>
        </button>
      </div>
      {!body ? (
        <p className="hint">
          还没有基准图。
          <button type="button" className="text-button" onClick={() => setNav('account')}>
            去我的建立身形
          </button>
        </p>
      ) : null}

      <div className="stats">
        <button type="button" onClick={() => setNav('closet')}>
          衣橱 <strong>{owned}</strong>
        </button>
        <button type="button" onClick={() => setNav('wishlist')}>
          想买 <strong>{wished}</strong>
        </button>
        <button type="button" onClick={() => setNav('looks')}>
          穿搭 <strong>{looks.length}</strong>
        </button>
      </div>
    </div>
  )
}
