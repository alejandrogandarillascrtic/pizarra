import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { nanoid } from 'nanoid'
import { supabase } from './supabase'
import type { Item, Me, Patch, Peer } from './types'

type Broadcast = boolean | 'throttle'
interface ApplyOpts {
  persist?: boolean
  broadcast?: Broadcast
  /** 'auto' = guarda el estado previo; Patch = estado previo explícito; false = sin historial */
  history?: 'auto' | Patch | false
}

export type Status = 'loading' | 'ready' | 'missing' | 'error'

export function useBoard(boardId: string, me: Me) {
  const [items, setItemsState] = useState<Record<string, Item>>({})
  const itemsRef = useRef(items)
  const [status, setStatus] = useState<Status>('loading')
  const [boardName, setBoardName] = useState('')
  const [peers, setPeers] = useState<Record<string, Peer>>({})
  const [saving, setSaving] = useState(false)
  const chRef = useRef<RealtimeChannel | null>(null)
  const undoRef = useRef<{ before: Patch; after: Patch }[]>([])
  const redoRef = useRef<{ before: Patch; after: Patch }[]>([])
  const queue = useRef({ up: new Map<string, Item>(), del: new Set<string>() })
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const throttle = useRef<{ patch: Patch; t: ReturnType<typeof setTimeout> | null }>({ patch: {}, t: null })
  const cursorT = useRef(0)
  const tabId = useRef(`${me.id}-${nanoid(4)}`).current
  const meRef = useRef(me)
  meRef.current = me

  const setItems = (next: Record<string, Item>) => {
    itemsRef.current = next
    setItemsState(next)
  }

  const mergePatch = (patch: Patch) => {
    const next = { ...itemsRef.current }
    for (const k in patch) {
      const v = patch[k]
      if (v) next[k] = v
      else delete next[k]
    }
    setItems(next)
  }

  const flush = useCallback(async () => {
    persistTimer.current = null
    const up = [...queue.current.up.values()]
    const del = [...queue.current.del]
    queue.current = { up: new Map(), del: new Set() }
    if (!up.length && !del.length) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (up.length) {
        const { error } = await supabase
          .from('items')
          .upsert(up.map((d) => ({ id: d.id, board_id: boardId, data: d, updated_at: now })))
        if (error) throw error
      }
      if (del.length) {
        const { error } = await supabase.from('items').delete().in('id', del)
        if (error) throw error
      }
      await supabase.from('boards').update({ updated_at: now }).eq('id', boardId)
    } catch (e) {
      console.error('Error guardando', e)
      // reintento: devolver a la cola
      for (const d of up) if (!queue.current.del.has(d.id)) queue.current.up.set(d.id, d)
      for (const id of del) queue.current.del.add(id)
      persistTimer.current = setTimeout(flush, 2000)
    } finally {
      setSaving(false)
    }
  }, [boardId])

  const schedulePersist = (patch: Patch) => {
    for (const k in patch) {
      const v = patch[k]
      if (v) {
        queue.current.up.set(k, v)
        queue.current.del.delete(k)
      } else {
        queue.current.up.delete(k)
        queue.current.del.add(k)
      }
    }
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(flush, 350)
  }

  const send = (event: string, payload: unknown) => {
    chRef.current?.send({ type: 'broadcast', event, payload })
  }

  const cancelThrottle = () => {
    if (throttle.current.t) clearTimeout(throttle.current.t)
    throttle.current = { patch: {}, t: null }
  }

  const apply = useCallback((patch: Patch, opts: ApplyOpts = {}) => {
    const { persist = true, broadcast = true, history = 'auto' } = opts
    let before: Patch | null = null
    if (history === 'auto') {
      before = {}
      for (const k in patch) before[k] = itemsRef.current[k] ?? null
    } else if (history) before = history
    mergePatch(patch)
    if (before) {
      const after: Patch = {}
      for (const k of new Set([...Object.keys(before), ...Object.keys(patch)])) {
        after[k] = itemsRef.current[k] ?? null
        if (!(k in before)) before[k] = null
      }
      undoRef.current.push({ before, after })
      if (undoRef.current.length > 300) undoRef.current.shift()
      redoRef.current = []
    }
    // Los elementos que aún se están subiendo existen solo en este navegador
    const shared: Patch = {}
    let any = false
    for (const k in patch) {
      if (patch[k]?.uploading) continue
      shared[k] = patch[k]
      any = true
    }
    if (!any) return
    patch = shared
    if (broadcast === 'throttle') {
      Object.assign(throttle.current.patch, patch)
      if (!throttle.current.t) {
        throttle.current.t = setTimeout(() => {
          send('ops', { patch: throttle.current.patch })
          throttle.current = { patch: {}, t: null }
        }, 45)
      }
    } else if (broadcast) {
      const pending = throttle.current.patch
      cancelThrottle()
      send('ops', { patch: { ...pending, ...patch } })
    }
    if (persist) schedulePersist(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const undo = useCallback(() => {
    const e = undoRef.current.pop()
    if (!e) return
    apply(e.before, { history: false })
    redoRef.current.push(e)
  }, [apply])

  const redo = useCallback(() => {
    const e = redoRef.current.pop()
    if (!e) return
    apply(e.after, { history: false })
    undoRef.current.push(e)
  }, [apply])

  const sendCursor = useCallback((x: number, y: number) => {
    const now = performance.now()
    if (now - cursorT.current < 40) return
    cursorT.current = now
    const m = meRef.current
    send('cursor', { id: tabId, name: m.name, color: m.color, x, y })
  }, [])

  const renameBoard = useCallback(
    async (name: string) => {
      setBoardName(name)
      send('meta', { name })
      await supabase.from('boards').update({ name }).eq('id', boardId)
    },
    [boardId],
  )

  // Carga inicial + canal realtime
  useEffect(() => {
    let alive = true
    setStatus('loading')
    ;(async () => {
      const { data: board, error: be } = await supabase.from('boards').select('id,name').eq('id', boardId).maybeSingle()
      if (!alive) return
      if (be) return setStatus(be.code === '22P02' ? 'missing' : 'error')
      if (!board) return setStatus('missing')
      setBoardName(board.name)
      const all: Record<string, Item> = {}
      let from = 0
      for (;;) {
        const { data, error } = await supabase.from('items').select('id,data').eq('board_id', boardId).range(from, from + 999)
        if (error) return alive && setStatus('error')
        for (const r of data) all[r.id] = r.data as Item
        if (data.length < 1000) break
        from += 1000
      }
      if (!alive) return
      setItems({ ...all, ...itemsRef.current })
      setStatus('ready')
    })()

    const ch = supabase.channel(`board:${boardId}`, {
      config: { broadcast: { self: false }, presence: { key: tabId } },
    })
    ch.on('broadcast', { event: 'ops' }, ({ payload }) => mergePatch(payload.patch as Patch))
    ch.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = payload as Peer
      setPeers((prev) => ({ ...prev, [p.id]: { ...prev[p.id], ...p, t: Date.now() } }))
    })
    ch.on('broadcast', { event: 'meta' }, ({ payload }) => setBoardName(payload.name))
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ name: string; color: string }>()
      setPeers((prev) => {
        const next: Record<string, Peer> = {}
        for (const key in state) {
          if (key === tabId) continue
          const s = state[key][0]
          next[key] = { ...prev[key], id: key, name: s.name, color: s.color }
        }
        return next
      })
    })
    ch.subscribe((st) => {
      if (st === 'SUBSCRIBED') ch.track({ name: meRef.current.name, color: meRef.current.color })
    })
    chRef.current = ch

    const onUnload = () => {
      if (persistTimer.current) flush()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      alive = false
      window.removeEventListener('beforeunload', onUnload)
      if (persistTimer.current) flush()
      supabase.removeChannel(ch)
      chRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  // Re-anunciar nombre si cambia
  useEffect(() => {
    chRef.current?.track({ name: me.name, color: me.color })
  }, [me.name, me.color])

  return { items, itemsRef, apply, undo, redo, status, boardName, renameBoard, peers, sendCursor, saving }
}
