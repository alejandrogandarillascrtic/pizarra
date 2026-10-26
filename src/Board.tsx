import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import type { End, Item, Me, Patch, Rect, Tool } from './types'
import { useBoard } from './useBoard'
import { ItemView } from './ItemView'
import {
  INK_COLORS, SHAPE_COLORS, STICKY_COLORS, bounds, center, contains, intersects, isTextual, normRect,
  translate, unionRect,
} from './geometry'
import { Icon } from './icons'
import { rememberBoard } from './recent'

const DEFAULTS: Record<string, { w: number; h: number; color: string }> = {
  sticky: { w: 200, h: 200, color: STICKY_COLORS[0] },
  rect: { w: 220, h: 140, color: SHAPE_COLORS[0] },
  ellipse: { w: 180, h: 180, color: SHAPE_COLORS[0] },
  diamond: { w: 200, h: 160, color: SHAPE_COLORS[0] },
  text: { w: 260, h: 44, color: INK_COLORS[0] },
  frame: { w: 800, h: 520, color: '#ffffff' },
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Seleccionar', key: 'V' },
  { id: 'hand', label: 'Mover lienzo', key: 'H' },
  { id: 'sticky', label: 'Nota adhesiva', key: 'N' },
  { id: 'text', label: 'Texto', key: 'T' },
  { id: 'rect', label: 'Rectángulo', key: 'R' },
  { id: 'ellipse', label: 'Círculo', key: 'O' },
  { id: 'diamond', label: 'Rombo', key: 'D' },
  { id: 'connector', label: 'Conector', key: 'L' },
  { id: 'pen', label: 'Lápiz', key: 'P' },
  { id: 'frame', label: 'Marco', key: 'F' },
]

type Drag =
  | { mode: 'pan'; sx: number; sy: number; cam: Cam }
  | { mode: 'pinch'; d0: number; c0: { x: number; y: number }; cam: Cam }
  | { mode: 'move'; start: Pt; sx: number; sy: number; orig: Record<string, Item>; moved: boolean }
  | { mode: 'resize'; id: string; handle: string; start: Pt; orig: Item }
  | { mode: 'marquee'; start: Pt; base: string[] }
  | { mode: 'create'; type: Tool; start: Pt }
  | { mode: 'pen'; pts: number[] }
  | { mode: 'connector'; from: End }

type Pt = { x: number; y: number }
type Cam = { x: number; y: number; z: number }

const CLIP_KEY = 'pizarra-clip'

export default function Board({ boardId, me, setMe }: { boardId: string; me: Me; setMe: (m: Me) => void }) {
  const { items, itemsRef, apply, undo, redo, status, boardName, renameBoard, peers, sendCursor, saving } = useBoard(boardId, me)
  const [cam, setCamState] = useState<Cam>({ x: 0, y: 0, z: 1 })
  const camRef = useRef(cam)
  const setCam = (c: Cam) => {
    camRef.current = c
    setCamState(c)
  }
  const [tool, setTool] = useState<Tool>('select')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const [selected, setSelectedState] = useState<string[]>([])
  const selRef = useRef<string[]>([])
  const setSelected = (s: string[]) => {
    selRef.current = s
    setSelectedState(s)
  }
  const [editing, setEditing] = useState<string | null>(null)
  const editBefore = useRef<Patch>({})
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [penColor, setPenColor] = useState(INK_COLORS[0])
  const [spaceDown, setSpaceDown] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [help, setHelp] = useState(false)
  const vpRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, Pt>())
  const fitted = useRef(false)

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1800)
  }

  useEffect(() => {
    if (status === 'ready') rememberBoard(boardId, boardName)
  }, [status, boardName, boardId])

  useEffect(() => {
    document.title = boardName ? `${boardName} · Pizarra` : 'Pizarra'
  }, [boardName])

  // ---------- cámara ----------
  const screenToWorld = useCallback((sx: number, sy: number): Pt => {
    const c = camRef.current
    return { x: (sx - c.x) / c.z, y: (sy - c.y) / c.z }
  }, [])

  const evToWorld = (e: { clientX: number; clientY: number }) => {
    const r = vpRef.current!.getBoundingClientRect()
    return screenToWorld(e.clientX - r.left, e.clientY - r.top)
  }

  const zoomAt = (sx: number, sy: number, z: number) => {
    z = Math.min(8, Math.max(0.05, z))
    const w = screenToWorld(sx, sy)
    setCam({ x: sx - w.x * z, y: sy - w.y * z, z })
  }

  const zoomBy = (f: number) => {
    const r = vpRef.current!.getBoundingClientRect()
    zoomAt(r.width / 2, r.height / 2, camRef.current.z * f)
  }

  const fitTo = useCallback((rect: Rect | null) => {
    const vp = vpRef.current
    if (!vp) return
    const r = vp.getBoundingClientRect()
    if (!rect) {
      setCam({ x: r.width / 2, y: r.height / 2, z: 1 })
      return
    }
    const pad = 80
    const z = Math.min(2, Math.max(0.05, Math.min((r.width - pad * 2) / Math.max(rect.w, 1), (r.height - pad * 2) / Math.max(rect.h, 1))))
    setCam({ x: r.width / 2 - (rect.x + rect.w / 2) * z, y: r.height / 2 - (rect.y + rect.h / 2) * z, z })
  }, [])

  const fitAll = useCallback(() => {
    const it = itemsRef.current
    fitTo(unionRect(Object.values(it).map((i) => bounds(i, it))))
  }, [fitTo, itemsRef])

  useEffect(() => {
    if (status === 'ready' && !fitted.current) {
      fitted.current = true
      fitAll()
    }
  }, [status, fitAll])

  // rueda: ctrl/cmd (o pellizco del trackpad) = zoom, si no = desplazar
  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = vp.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, camRef.current.z * Math.exp(-e.deltaY * 0.0085))
      } else {
        const c = camRef.current
        const k = e.deltaMode === 1 ? 16 : 1
        setCam({ ...c, x: c.x - e.deltaX * k, y: c.y - e.deltaY * k })
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // ---------- helpers ----------
  const zRange = () => {
    let min = 0, max = 0
    for (const i of Object.values(itemsRef.current)) {
      min = Math.min(min, i.z)
      max = Math.max(max, i.z)
    }
    return { min, max }
  }

  const makeItem = (type: Tool, r: Rect): Item => {
    const d = DEFAULTS[type]
    const { min, max } = zRange()
    return {
      id: nanoid(10), type: type as Item['type'], x: r.x, y: r.y, w: Math.max(r.w, 20), h: Math.max(r.h, 20),
      z: type === 'frame' ? min - 1 : max + 1, color: d.color, text: type === 'frame' ? 'Marco' : '', author: me.name,
    }
  }

  const itemAt = (clientX: number, clientY: number, exclude?: string) => {
    const els = document.elementsFromPoint(clientX, clientY)
    for (const el of els) {
      const id = (el as HTMLElement).closest?.('[data-id]')?.getAttribute('data-id')
      if (id && id !== exclude) {
        const it = itemsRef.current[id]
        if (it && it.type !== 'connector' && it.type !== 'pen') return id
      }
    }
    return null
  }

  const frameChildren = (frame: Item, all: Record<string, Item>) => {
    const fr = bounds(frame, all)
    return Object.values(all).filter((i) => i.id !== frame.id && i.z > frame.z && contains(fr, bounds(i, all))).map((i) => i.id)
  }

  const deleteSelection = () => {
    const sel = selRef.current
    if (!sel.length) return
    const all = itemsRef.current
    const dead = new Set(sel)
    for (const i of Object.values(all)) {
      if (i.type === 'connector' && ((i.from?.id && dead.has(i.from.id)) || (i.to?.id && dead.has(i.to.id)))) dead.add(i.id)
    }
    const patch: Patch = {}
    for (const id of dead) patch[id] = null
    apply(patch)
    setSelected([])
  }

  const cloneItems = (src: Item[], dx: number, dy: number) => {
    const idMap: Record<string, string> = {}
    for (const i of src) idMap[i.id] = nanoid(10)
    const { max } = zRange()
    const patch: Patch = {}
    src.forEach((i, k) => {
      const n: Item = { ...i, id: idMap[i.id], z: i.type === 'frame' ? i.z : max + 1 + k }
      if (i.type === 'connector') {
        const fix = (e?: End) => (e ? (e.id && idMap[e.id] ? { ...e, id: idMap[e.id] } : { x: e.x + dx, y: e.y + dy }) : e)
        n.from = fix(i.from)
        n.to = fix(i.to)
      } else {
        n.x += dx
        n.y += dy
      }
      patch[n.id] = n
    })
    apply(patch)
    setSelected(Object.keys(patch))
  }

  const selectedItems = () => selRef.current.map((id) => itemsRef.current[id]).filter(Boolean)

  // ---------- puntero ----------
  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, input, .ctx')) return
    vpRef.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const r = vpRef.current!.getBoundingClientRect()
      drag.current = {
        mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y),
        c0: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, cam: { ...camRef.current },
      }
      setDraft(null)
      setMarquee(null)
      return
    }

    const p = evToWorld(e)
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle')
    const hitId = target.closest('[data-id]')?.getAttribute('data-id') || null
    const t = toolRef.current

    if (e.button === 1 || spaceDown || t === 'hand') {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...camRef.current } }
      return
    }
    if (e.button !== 0) return

    if (t === 'select') {
      const all = itemsRef.current
      if (handle && selRef.current.length === 1) {
        const it = all[selRef.current[0]]
        drag.current = { mode: 'resize', id: it.id, handle, start: p, orig: it }
        return
      }
      if (hitId && all[hitId]) {
        let sel = selRef.current
        if (e.shiftKey) {
          sel = sel.includes(hitId) ? sel.filter((s) => s !== hitId) : [...sel, hitId]
          setSelected(sel)
          if (!sel.includes(hitId)) return
        } else if (!sel.includes(hitId)) {
          sel = [hitId]
          setSelected(sel)
        }
        const ids = new Set(sel)
        for (const id of sel) if (all[id]?.type === 'frame') frameChildren(all[id], all).forEach((c) => ids.add(c))
        const orig: Record<string, Item> = {}
        for (const id of ids) if (all[id]) orig[id] = all[id]
        drag.current = { mode: 'move', start: p, sx: e.clientX, sy: e.clientY, orig, moved: false }
        return
      }
      if (!e.shiftKey) setSelected([])
      drag.current = { mode: 'marquee', start: p, base: e.shiftKey ? selRef.current : [] }
      return
    }

    if (t === 'pen') {
      drag.current = { mode: 'pen', pts: [p.x, p.y] }
      return
    }

    if (t === 'connector') {
      const fromId = hitId && itemsRef.current[hitId] && !['connector', 'pen'].includes(itemsRef.current[hitId].type) ? hitId : null
      const from: End = fromId ? { id: fromId, ...center(itemsRef.current[fromId]) } : { x: p.x, y: p.y }
      drag.current = { mode: 'connector', from }
      return
    }

    drag.current = { mode: 'create', type: t, start: p }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = evToWorld(e)
    sendCursor(p.x, p.y)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = drag.current
    if (!d) return

    switch (d.mode) {
      case 'pan':
        setCam({ ...d.cam, x: d.cam.x + e.clientX - d.sx, y: d.cam.y + e.clientY - d.sy })
        break
      case 'pinch': {
        if (pointers.current.size < 2) return
        const [a, b] = [...pointers.current.values()]
        const r = vpRef.current!.getBoundingClientRect()
        const c = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }
        const z = Math.min(8, Math.max(0.05, d.cam.z * (Math.hypot(a.x - b.x, a.y - b.y) / d.d0)))
        const w = { x: (d.c0.x - d.cam.x) / d.cam.z, y: (d.c0.y - d.cam.y) / d.cam.z }
        setCam({ x: c.x - w.x * z, y: c.y - w.y * z, z })
        break
      }
      case 'move': {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return
        d.moved = true
        const dx = p.x - d.start.x, dy = p.y - d.start.y
        const patch: Patch = {}
        for (const id in d.orig) patch[id] = translate(d.orig[id], dx, dy)
        apply(patch, { persist: false, broadcast: 'throttle', history: false })
        break
      }
      case 'resize': {
        const o = d.orig
        let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h
        const dx = p.x - d.start.x, dy = p.y - d.start.y
        if (d.handle.includes('w')) x1 += dx
        if (d.handle.includes('e')) x2 += dx
        if (d.handle.includes('n')) y1 += dy
        if (d.handle.includes('s')) y2 += dy
        let w = Math.max(30, x2 - x1), h = Math.max(24, y2 - y1)
        if (e.shiftKey || o.type === 'sticky') {
          const ratio = o.w / o.h
          if (w / h > ratio) h = w / ratio
          else w = h * ratio
        }
        const x = d.handle.includes('w') ? o.x + o.w - w : o.x
        const y = d.handle.includes('n') ? o.y + o.h - h : o.y
        let next: Item = { ...o, x, y, w, h }
        if (o.type === 'pen' && o.points) {
          const sx = w / o.w, sy = h / o.h
          next = { ...next, points: o.points.map((v, k) => (k % 2 === 0 ? v * sx : v * sy)) }
        }
        apply({ [o.id]: next }, { persist: false, broadcast: 'throttle', history: false })
        break
      }
      case 'marquee': {
        const r = normRect(d.start, p)
        setMarquee(r)
        const all = itemsRef.current
        const hit = Object.values(all)
          .filter((i) => {
            const b = bounds(i, all)
            return i.type === 'frame' ? contains(r, b) : intersects(r, b)
          })
          .map((i) => i.id)
        setSelected([...new Set([...d.base, ...hit])])
        break
      }
      case 'create': {
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * camRef.current.z < 6) return
        setDraft({ ...makeItem(d.type, normRect(d.start, p)), id: 'draft' })
        break
      }
      case 'pen': {
        const n = d.pts.length
        if (Math.hypot(p.x - d.pts[n - 2], p.y - d.pts[n - 1]) * camRef.current.z < 2) return
        d.pts.push(p.x, p.y)
        setDraft(penItem(d.pts, 'draft'))
        break
      }
      case 'connector': {
        const over = itemAt(e.clientX, e.clientY, d.from.id)
        setHoverId(over)
        const to: End = over ? { id: over, ...center(itemsRef.current[over]) } : { x: p.x, y: p.y }
        setDraft({ id: 'draft', type: 'connector', x: 0, y: 0, w: 0, h: 0, z: 1e9, color: INK_COLORS[0], from: d.from, to, arrow: true })
        break
      }
    }
  }

  const penItem = (pts: number[], id: string): Item => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (let k = 0; k < pts.length; k += 2) {
      x1 = Math.min(x1, pts[k]); y1 = Math.min(y1, pts[k + 1])
      x2 = Math.max(x2, pts[k]); y2 = Math.max(y2, pts[k + 1])
    }
    return {
      id, type: 'pen', x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1), z: zRange().max + 1, color: penColor,
      stroke: 3, points: pts.map((v, k) => (k % 2 === 0 ? v - x1 : v - y1)), author: me.name,
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const d = drag.current
    if (!d) return
    if (d.mode === 'pinch') {
      if (pointers.current.size === 0) drag.current = null
      return
    }
    drag.current = null
    const p = evToWorld(e)

    switch (d.mode) {
      case 'move':
        if (d.moved) {
          const dx = p.x - d.start.x, dy = p.y - d.start.y
          const patch: Patch = {}
          for (const id in d.orig) patch[id] = translate(d.orig[id], dx, dy)
          apply(patch, { history: d.orig })
        }
        break
      case 'resize': {
        const cur = itemsRef.current[d.id]
        if (cur) apply({ [d.id]: cur }, { history: { [d.id]: d.orig } })
        break
      }
      case 'marquee':
        setMarquee(null)
        break
      case 'create': {
        const def = DEFAULTS[d.type]
        const item = draft
          ? { ...draft, id: nanoid(10) }
          : makeItem(d.type, { x: d.start.x - def.w / 2, y: d.start.y - def.h / 2, w: def.w, h: def.h })
        setDraft(null)
        apply({ [item.id]: item })
        setSelected([item.id])
        setTool('select')
        if (item.type !== 'frame') startEdit(item.id, item)
        break
      }
      case 'pen': {
        setDraft(null)
        if (d.pts.length >= 4) {
          const it = penItem(d.pts, nanoid(10))
          apply({ [it.id]: it })
        }
        break
      }
      case 'connector': {
        setDraft(null)
        setHoverId(null)
        const over = itemAt(e.clientX, e.clientY, d.from.id)
        const to: End = over ? { id: over, ...center(itemsRef.current[over]) } : { x: p.x, y: p.y }
        const fromPt = d.from
        if (!over && Math.hypot(to.x - fromPt.x, to.y - fromPt.y) * camRef.current.z < 10) break
        const it: Item = {
          id: nanoid(10), type: 'connector', x: 0, y: 0, w: 0, h: 0, z: zRange().max + 1, color: INK_COLORS[0],
          from: d.from, to, arrow: true, author: me.name,
        }
        apply({ [it.id]: it })
        setSelected([it.id])
        setTool('select')
        break
      }
    }
  }

  const startEdit = (id: string, item?: Item) => {
    const it = item || itemsRef.current[id]
    if (!it || !isTextual(it.type)) return
    editBefore.current = { [id]: item ? null : it }
    setEditing(id)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, input, .ctx')) return
    const id = target.closest('[data-id]')?.getAttribute('data-id')
    if (id && itemsRef.current[id]) {
      setSelected([id])
      startEdit(id)
    } else if (toolRef.current === 'select') {
      const p = evToWorld(e)
      const def = DEFAULTS.sticky
      const it = makeItem('sticky', { x: p.x - def.w / 2, y: p.y - def.h / 2, w: def.w, h: def.h })
      apply({ [it.id]: it })
      setSelected([it.id])
      startEdit(it.id, it)
    }
  }

  const onText = useCallback(
    (text: string, h?: number) => {
      const id = editing
      if (!id) return
      const it = itemsRef.current[id]
      if (!it) return
      apply({ [id]: { ...it, text, h: h ?? it.h } }, { persist: false, broadcast: 'throttle', history: false })
    },
    [editing, apply, itemsRef],
  )

  const onDone = useCallback(() => {
    const id = editing
    setEditing(null)
    if (!id) return
    const it = itemsRef.current[id]
    if (!it) return
    if (it.type === 'text' && !it.text?.trim()) {
      apply({ [id]: null }, { history: editBefore.current[id] ? { [id]: editBefore.current[id] } : false })
      setSelected([])
      return
    }
    // si el item es nuevo, el historial ya registró su creación
    apply({ [id]: it }, { history: editBefore.current[id] ? editBefore.current : false })
  }, [editing, apply, itemsRef])

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space') {
        setSpaceDown(true)
        e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(Object.keys(itemsRef.current))
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const s = selectedItems()
        if (s.length) cloneItems(s, 30, 30)
        return
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomBy(1.2)
        return
      }
      if (mod && e.key === '-') {
        e.preventDefault()
        zoomBy(1 / 1.2)
        return
      }
      if (mod && e.key === '0') {
        e.preventDefault()
        const r = vpRef.current!.getBoundingClientRect()
        zoomAt(r.width / 2, r.height / 2, 1)
        return
      }
      if (e.shiftKey && e.key === '!') {
        fitAll()
        return
      }
      if (mod) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
        return
      }
      if (e.key === 'Escape') {
        setSelected([])
        setTool('select')
        return
      }
      if (e.key === 'Enter' && selRef.current.length === 1) {
        e.preventDefault()
        startEdit(selRef.current[0])
        return
      }
      if (e.key.startsWith('Arrow') && selRef.current.length) {
        e.preventDefault()
        const step = e.shiftKey ? 20 : 2
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const patch: Patch = {}
        for (const i of selectedItems()) patch[i.id] = translate(i, dx, dy)
        apply(patch)
        return
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t.id)
      if (e.key === '?') setHelp((h) => !h)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    const onCopy = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const s = selectedItems()
      if (!s.length) return
      const json = JSON.stringify({ pizarra: 1, items: s })
      e.clipboardData?.setData('text/plain', json)
      e.preventDefault()
      try { localStorage.setItem(CLIP_KEY, json) } catch { /* sin almacenamiento */ }
    }
    const onCut = (e: ClipboardEvent) => {
      onCopy(e)
      if (e.defaultPrevented) deleteSelection()
    }
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const text = e.clipboardData?.getData('text/plain') || ''
      e.preventDefault()
      const r = vpRef.current!.getBoundingClientRect()
      const mid = screenToWorld(r.width / 2, r.height / 2)
      try {
        const data = JSON.parse(text)
        if (data?.pizarra && Array.isArray(data.items)) {
          const src = data.items as Item[]
          const u = unionRect(src.filter((i) => i.type !== 'connector').map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })))
          const visible = u && intersects(u, { x: mid.x - r.width / 2 / camRef.current.z, y: mid.y - r.height / 2 / camRef.current.z, w: r.width / camRef.current.z, h: r.height / camRef.current.z })
          const dx = u && !visible ? mid.x - (u.x + u.w / 2) : 30
          const dy = u && !visible ? mid.y - (u.y + u.h / 2) : 30
          cloneItems(src, dx, dy)
          return
        }
      } catch { /* no es JSON */ }
      if (!text.trim()) return
      const lines = text.split(/\n{2,}|\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 60)
      const patch: Patch = {}
      const cols = Math.ceil(Math.sqrt(lines.length))
      let { max } = zRange()
      lines.forEach((line, k) => {
        const id = nanoid(10)
        patch[id] = {
          id, type: 'sticky', x: mid.x - (cols * 220) / 2 + (k % cols) * 220, y: mid.y - 100 + Math.floor(k / cols) * 220,
          w: 200, h: 200, z: ++max, color: STICKY_COLORS[0], text: line, author: me.name,
        }
      })
      apply(patch)
      setSelected(Object.keys(patch))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  })

  // ---------- derivados ----------
  const sorted = useMemo(() => Object.values(items).sort((a, b) => a.z - b.z), [items])
  const selRect = useMemo(() => {
    const s = selected.map((id) => items[id]).filter(Boolean)
    return unionRect(s.map((i) => bounds(i, items)))
  }, [selected, items])
  const selItems = selected.map((id) => items[id]).filter(Boolean)
  const single = selItems.length === 1 ? selItems[0] : null

  const toScreen = (r: Rect) => ({ x: r.x * cam.z + cam.x, y: r.y * cam.z + cam.y, w: r.w * cam.z, h: r.h * cam.z })

  // ---------- acciones de la barra contextual ----------
  const recolor = (color: string) => {
    const patch: Patch = {}
    for (const i of selItems) patch[i.id] = { ...i, color }
    apply(patch)
  }
  const fontStep = (f: number) => {
    const patch: Patch = {}
    for (const i of selItems) if (isTextual(i.type)) {
      const cur = i.fontSize || (i.type === 'text' ? 20 : 18)
      patch[i.id] = { ...i, fontSize: Math.max(8, Math.min(120, Math.round(cur * f))) }
    }
    apply(patch)
  }
  const reorder = (front: boolean) => {
    const { min, max } = zRange()
    const patch: Patch = {}
    selItems.forEach((i, k) => (patch[i.id] = { ...i, z: front ? max + 1 + k : min - selItems.length + k }))
    apply(patch)
  }
  const toggleArrow = () => {
    const patch: Patch = {}
    for (const i of selItems) if (i.type === 'connector') patch[i.id] = { ...i, arrow: i.arrow === false }
    apply(patch)
  }

  const palette = (() => {
    if (!selItems.length) return []
    const t = selItems[0].type
    if (t === 'sticky') return STICKY_COLORS
    if (t === 'text' || t === 'connector' || t === 'pen') return INK_COLORS
    if (t === 'frame') return ['#ffffff', '#f4f5f7', '#fff8e1', '#e8f5e9', '#e3f2fd', '#fce4ec', '#ede7f6', '#1b1f3b']
    return SHAPE_COLORS
  })()

  // ---------- exportar / importar ----------
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ pizarra: 1, name: boardName, items: Object.values(items) }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(boardName || 'tablero').replace(/[^\w\- ]+/g, '')}.pizarra.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setMenu(false)
  }
  const importJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const data = JSON.parse(await f.text())
        if (!Array.isArray(data.items)) throw new Error('formato')
        cloneItems(data.items, 0, 0)
        setTimeout(fitAll, 50)
        flash(`Importados ${data.items.length} elementos`)
      } catch {
        flash('Archivo no válido')
      }
    }
    input.click()
    setMenu(false)
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      flash('Enlace copiado: compártelo con tu equipo')
    } catch {
      prompt('Copia este enlace', location.href)
    }
  }

  const renameMe = () => {
    const name = prompt('¿Cómo te llamas?', me.name)?.trim()
    if (name) setMe({ ...me, name: name.slice(0, 32) })
  }

  // ---------- render ----------
  if (status === 'missing' || status === 'error') {
    return (
      <div className="center-msg">
        <h2>{status === 'missing' ? 'Este tablero no existe' : 'No se pudo cargar el tablero'}</h2>
        <p>{status === 'missing' ? 'Revisa el enlace o crea uno nuevo.' : 'Revisa tu conexión e inténtalo otra vez.'}</p>
        <a className="btn primary" href="/">Ir al inicio</a>
      </div>
    )
  }

  const peerList = Object.values(peers)
  const cursorClass = spaceDown || tool === 'hand' ? 'grab' : tool === 'select' ? '' : 'crosshair'
  const gridSize = 24 * cam.z

  return (
    <div className="board">
      <div
        ref={vpRef}
        className={`viewport ${cursorClass}`}
        style={{
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
          backgroundImage: cam.z > 0.3 ? undefined : 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          {sorted.map((i) => (
            <ItemView
              key={i.id}
              item={i}
              items={i.type === 'connector' ? items : EMPTY}
              editing={editing === i.id}
              hover={hoverId === i.id}
              onText={onText}
              onDone={onDone}
            />
          ))}
          {draft && <ItemView item={draft} items={items} editing={false} hover={false} onText={noop} onDone={noop} />}
        </div>

        {/* capa de selección en coordenadas de pantalla */}
        <div className="overlay">
          {selItems.length > 1 &&
            selItems.map((i) => {
              const r = toScreen(bounds(i, items))
              return <div key={i.id} className="sel-box thin" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
            })}
          {selRect && !editing && (() => {
            const r = toScreen(selRect)
            const canResize = single && single.type !== 'connector'
            return (
              <div className="sel-box" style={{ left: r.x - 1, top: r.y - 1, width: r.w + 2, height: r.h + 2 }}>
                {canResize &&
                  ['nw', 'ne', 'sw', 'se'].map((h) => <div key={h} data-handle={h} className={`handle h-${h}`} />)}
              </div>
            )
          })()}
          {marquee && (() => {
            const r = toScreen(marquee)
            return <div className="marquee" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
          })()}
          {peerList.map((p) =>
            p.x === undefined || p.y === undefined ? null : (
              <div key={p.id} className="peer-cursor" style={{ transform: `translate(${p.x * cam.z + cam.x}px, ${p.y * cam.z + cam.y}px)` }}>
                <svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1l15 9-7 1.5L5.5 20z" fill={p.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                <span style={{ background: p.color }}>{p.name}</span>
              </div>
            ),
          )}

          {selRect && !editing && !drag.current && selItems.length > 0 && (() => {
            const r = toScreen(selRect)
            const top = Math.max(64, r.y - 58)
            const left = Math.min(Math.max(12, r.x + r.w / 2), (vpRef.current?.clientWidth || 800) - 12)
            const textual = selItems.some((i) => isTextual(i.type) && i.type !== 'frame')
            return (
              <div className="ctx" style={{ top, left }} onPointerDown={(e) => e.stopPropagation()}>
                <div className="swatches">
                  {palette.map((c) => (
                    <button key={c} className={`sw${selItems[0].color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => recolor(c)} title={c} />
                  ))}
                </div>
                {textual && (
                  <>
                    <span className="sep" />
                    <button className="ib" title="Texto más pequeño" onClick={() => fontStep(1 / 1.15)}><small>A</small></button>
                    <button className="ib" title="Texto más grande" onClick={() => fontStep(1.15)}>A</button>
                  </>
                )}
                {selItems.some((i) => i.type === 'connector') && (
                  <>
                    <span className="sep" />
                    <button className="ib" title="Punta de flecha" onClick={toggleArrow}><Icon name="arrow" /></button>
                  </>
                )}
                <span className="sep" />
                <button className="ib" title="Traer al frente" onClick={() => reorder(true)}><Icon name="front" /></button>
                <button className="ib" title="Enviar atrás" onClick={() => reorder(false)}><Icon name="back" /></button>
                <button className="ib" title="Duplicar (Ctrl+D)" onClick={() => cloneItems(selItems, 30, 30)}><Icon name="copy" /></button>
                <button className="ib danger" title="Eliminar (Supr)" onClick={deleteSelection}><Icon name="trash" /></button>
              </div>
            )
          })()}
        </div>
      </div>

      {/* barra superior */}
      <div className="topbar left">
        <a href="/" className="logo" title="Inicio"><img src="/favicon.svg" alt="" />Pizarra</a>
        <span className="vsep" />
        <input
          className="board-name"
          value={boardName}
          placeholder="Tablero sin título"
          onChange={(e) => renameBoard(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          size={Math.max(10, boardName.length + 1)}
        />
        <span className={`save ${saving ? 'on' : ''}`} title={saving ? 'Guardando…' : 'Guardado'}>{saving ? 'Guardando…' : 'Guardado'}</span>
        <div className="menu-wrap">
          <button className="ib" onClick={() => setMenu((m) => !m)} title="Más"><Icon name="dots" /></button>
          {menu && (
            <div className="menu" onPointerLeave={() => setMenu(false)}>
              <button onClick={() => { fitAll(); setMenu(false) }}>Ajustar a la pantalla <kbd>⇧1</kbd></button>
              <button onClick={exportJson}>Exportar (.json)</button>
              <button onClick={importJson}>Importar (.json)</button>
              <button onClick={() => { setHelp(true); setMenu(false) }}>Atajos de teclado <kbd>?</kbd></button>
              <a href="/" target="_blank" rel="noreferrer">Nuevo tablero ↗</a>
            </div>
          )}
        </div>
      </div>

      <div className="topbar right">
        <div className="avatars">
          {peerList.slice(0, 6).map((p) => (
            <span key={p.id} className="avatar" style={{ background: p.color }} title={p.name}>{initials(p.name)}</span>
          ))}
          {peerList.length > 6 && <span className="avatar more">+{peerList.length - 6}</span>}
          <button className="avatar me" style={{ background: me.color }} title={`Tú: ${me.name} (cambiar nombre)`} onClick={renameMe}>{initials(me.name)}</button>
        </div>
        <button className="btn primary" onClick={share}><Icon name="share" /> Compartir</button>
      </div>

      {/* herramientas */}
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool${tool === t.id ? ' on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
            <Icon name={t.id} />
          </button>
        ))}
        <span className="hsep" />
        <button className="tool" title="Deshacer (Ctrl+Z)" onClick={undo}><Icon name="undo" /></button>
        <button className="tool" title="Rehacer (Ctrl+Shift+Z)" onClick={redo}><Icon name="redo" /></button>
      </div>

      {tool === 'pen' && (
        <div className="pen-colors">
          {INK_COLORS.map((c) => (
            <button key={c} className={`sw${penColor === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setPenColor(c)} />
          ))}
        </div>
      )}

      <div className="zoom">
        <button className="ib" onClick={() => zoomBy(1 / 1.2)} title="Alejar">−</button>
        <button className="zv" onClick={() => { const r = vpRef.current!.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1) }} title="100%">
          {Math.round(cam.z * 100)}%
        </button>
        <button className="ib" onClick={() => zoomBy(1.2)} title="Acercar">+</button>
        <span className="sep" />
        <button className="ib" onClick={fitAll} title="Ajustar a la pantalla (Shift+1)"><Icon name="fit" /></button>
        <button className="ib" onClick={() => setHelp(true)} title="Ayuda (?)">?</button>
      </div>

      {status === 'loading' && <div className="loading">Cargando tablero…</div>}
      {status === 'ready' && sorted.length === 0 && (
        <div className="empty-hint">
          <strong>Tablero vacío</strong>
          Doble clic para una nota · elige una herramienta a la izquierda · pega texto con Ctrl+V
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  )
}

const EMPTY: Record<string, Item> = {}
const noop = () => {}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?'
}

function Help({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['V / H', 'Seleccionar / mover lienzo'],
    ['N  T  R  O  D', 'Nota, texto, rectángulo, círculo, rombo'],
    ['L  P  F', 'Conector, lápiz, marco'],
    ['Doble clic', 'Nueva nota o editar texto'],
    ['Espacio + arrastrar', 'Mover lienzo'],
    ['Ctrl + rueda / pellizco', 'Zoom'],
    ['Rueda / dos dedos', 'Desplazar'],
    ['Shift + clic / arrastrar', 'Selección múltiple'],
    ['Ctrl+C / X / V', 'Copiar, cortar, pegar (también entre tableros)'],
    ['Ctrl+D', 'Duplicar'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Deshacer / rehacer'],
    ['Flechas (Shift)', 'Mover selección'],
    ['Supr / Retroceso', 'Eliminar'],
    ['Shift+1 · Ctrl+0', 'Ajustar a la pantalla · zoom 100%'],
    ['Pegar texto', 'Crea una nota por línea'],
  ]
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>Atajos de teclado</h3>
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}
