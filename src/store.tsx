import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { deleteBody, putGarment, putLook, removeGarment, removeLook, saveAccount as persistAccount, saveBody as persistBody } from './db.ts'
import { forgetBody, forgetGarment, forgetLook, openLibrary, rememberAccount, rememberBody, rememberGarment, rememberLook } from './disk.ts'
import { isGarmentDir } from './garment-name.ts'
import type { Account, BodyProfile, Garment, Look, View } from './types.ts'

type NewGarment = Omit<Garment, 'id' | 'createdAt'>
type NewLook = Omit<Look, 'id' | 'createdAt'>

type WardrobeValue = {
  ready: boolean
  bootText: string
  account: Account | null
  body: BodyProfile | null
  garments: Garment[]
  looks: Look[]
  nav: View
  setNav: (view: View) => void
  toast: string | null
  notify: (message: string) => void
  saveAccount: (input: { name: string; phone: string; avatarBlob: Blob }) => Promise<void>
  saveBody: (profile: BodyProfile) => Promise<void>
  clearBody: () => Promise<void>
  addGarment: (garment: NewGarment) => Promise<Garment>
  updateGarment: (id: string, patch: Partial<Garment>) => Promise<Garment | null>
  deleteGarment: (id: string) => Promise<void>
  addLook: (look: NewLook) => Promise<void>
  deleteLook: (id: string) => Promise<void>
}

const WardrobeContext = createContext<WardrobeValue | null>(null)

export function WardrobeProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [bootText, setBootText] = useState('正在打开衣橱')
  const [account, setAccount] = useState<Account | null>(null)
  const [body, setBody] = useState<BodyProfile | null>(null)
  const [garments, setGarments] = useState<Garment[]>([])
  const [looks, setLooks] = useState<Look[]>([])
  const [nav, setNav] = useState<View>('home')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef(0)
  const garmentsRef = useRef(garments)
  const looksRef = useRef(looks)
  const accountRef = useRef(account)
  garmentsRef.current = garments
  looksRef.current = looks
  accountRef.current = account

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const snapshot = await openLibrary((text) => {
        if (!cancelled) setBootText(text)
      })
      if (cancelled) return
      setAccount(snapshot.account)
      setBody(snapshot.body)
      setGarments(snapshot.garments)
      setLooks(snapshot.looks)
      setReady(true)
      const pending = sessionStorage.getItem('wardrobe-disk-note')
      if (pending === 'restored' || pending === 'copied') {
        sessionStorage.removeItem('wardrobe-disk-note')
        setToast(pending === 'restored' ? '已从本机文件夹装回衣橱' : '衣橱已写入本机文件夹')
        toastTimer.current = window.setTimeout(() => setToast(null), 3200)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const notify = (message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  const value = useMemo<WardrobeValue>(
    () => ({
      ready,
      bootText,
      account,
      body,
      garments,
      looks,
      nav,
      setNav,
      toast,
      notify,
      saveAccount: async (input) => {
        const next: Account = account
          ? { ...account, name: input.name, phone: input.phone, avatarBlob: input.avatarBlob }
          : { id: crypto.randomUUID(), name: input.name, phone: input.phone, avatarBlob: input.avatarBlob, createdAt: Date.now() }
        await persistAccount(next)
        await rememberAccount(next)
        const ownedGarments = garmentsRef.current.filter((item) => item.userId !== next.id)
        const ownedLooks = looksRef.current.filter((item) => item.userId !== next.id)
        for (const item of ownedGarments) {
          const updated = { ...item, userId: next.id }
          await putGarment(updated)
          await rememberGarment(updated)
        }
        for (const item of ownedLooks) {
          const updated = { ...item, userId: next.id }
          await putLook(updated)
          await rememberLook(updated)
        }
        accountRef.current = next
        setAccount(next)
        if (ownedGarments.length > 0) {
          const nextGarments = garmentsRef.current.map((item) => (item.userId === next.id ? item : { ...item, userId: next.id }))
          garmentsRef.current = nextGarments
          setGarments(nextGarments)
        }
        if (ownedLooks.length > 0) {
          const nextLooks = looksRef.current.map((item) => (item.userId === next.id ? item : { ...item, userId: next.id }))
          looksRef.current = nextLooks
          setLooks(nextLooks)
        }
      },
      saveBody: async (profile) => {
        await persistBody(profile)
        await rememberBody(profile)
        setBody(profile)
      },
      clearBody: async () => {
        await deleteBody()
        await forgetBody()
        setBody(null)
      },
      addGarment: async (garment) => {
        const id = isGarmentDir(garment.name) ? garment.name : crypto.randomUUID()
        const next: Garment = { ...garment, id, userId: accountRef.current?.id, createdAt: Date.now() }
        await putGarment(next)
        const disk = await rememberGarment(next)
        if (disk === 'deleted') return next
        const list = [next, ...garmentsRef.current.filter((item) => item.id !== next.id)]
        garmentsRef.current = list
        setGarments(list)
        return next
      },
      updateGarment: async (id, patch) => {
        const current = garmentsRef.current.find((item) => item.id === id)
        if (!current) return null
        const name = patch.name ?? current.name
        const nextId = isGarmentDir(name) ? name : id
        const next = { ...current, ...patch, id: nextId, name }
        if (nextId !== id) {
          await putGarment(next)
          const disk = await rememberGarment(next)
          await removeGarment(id)
          await forgetGarment(id)
          if (disk === 'deleted') {
            const list = garmentsRef.current.filter((item) => item.id !== id)
            garmentsRef.current = list
            setGarments(list)
            return null
          }
          const rewritten = looksRef.current
            .filter((look) => look.garmentIds.includes(id))
            .map((look) => ({ ...look, garmentIds: look.garmentIds.map((item) => (item === id ? nextId : item)) }))
          for (const look of rewritten) {
            await putLook(look)
            await rememberLook(look)
          }
          const list = garmentsRef.current.map((item) => (item.id === id ? next : item))
          garmentsRef.current = list
          setGarments(list)
          if (rewritten.length > 0) {
            const replaced = new Map(rewritten.map((look) => [look.id, look]))
            const nextLooks = looksRef.current.map((look) => replaced.get(look.id) ?? look)
            looksRef.current = nextLooks
            setLooks(nextLooks)
          }
          return next
        }
        await putGarment(next)
        const disk = await rememberGarment(next)
        if (disk === 'deleted') {
          const list = garmentsRef.current.filter((item) => item.id !== id)
          garmentsRef.current = list
          setGarments(list)
          return null
        }
        const list = garmentsRef.current.map((item) => (item.id === id ? next : item))
        garmentsRef.current = list
        setGarments(list)
        return next
      },
      deleteGarment: async (id) => {
        await removeGarment(id)
        await forgetGarment(id)
        const list = garmentsRef.current.filter((item) => item.id !== id)
        garmentsRef.current = list
        setGarments(list)
      },
      addLook: async (look) => {
        const next: Look = { ...look, id: crypto.randomUUID(), userId: account?.id, createdAt: Date.now() }
        await putLook(next)
        await rememberLook(next)
        setLooks((current) => [next, ...current])
      },
      deleteLook: async (id) => {
        await removeLook(id)
        await forgetLook(id)
        setLooks((list) => list.filter((item) => item.id !== id))
      },
    }),
    [ready, bootText, account, body, garments, looks, nav, toast],
  )

  return <WardrobeContext.Provider value={value}>{children}</WardrobeContext.Provider>
}

export function useWardrobe(): WardrobeValue {
  const value = useContext(WardrobeContext)
  if (!value) throw new Error('衣橱尚未就绪')
  return value
}
