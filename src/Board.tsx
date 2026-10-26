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
import { interpretWheel, loadNav, saveNav, type NavSettings } from './nav'
import NavPanel from './NavPanel'
import { MediaCtx } from './MediaView'
import Viewer, { HtmlDialog, UrlDialog } from './Viewer'
import {
  MAX_BYTES, asUrl, classify, downloadUrl, embedFor, fetchPreview, fetchRemoteFile, heicToJpeg, hostOf, iframeSrc,
  HTML_INLINE_MAX, htmlText, htmlTitle, looksLikeHtml, imageSize, isMedia, isOfficeViewable, isSheetImportable, keepsAspect, limitImage, loadPdf, officeThumbnail, pdfPageBlob,
  sheetRows, textSnippet, uploadBlob, videoPoster, type EmbedInfo,
} from './media'

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
  const [nav, setNavState] = useState<NavSettings>(loadNav)
  const navRef = useRef(nav)
  navRef.current = nav
  const setNav = (n: NavSettings) => {
    saveNav(n)
    setNavState(n)
  }
  const [navOpen, setNavOpen] = useState(false)
  const rightPan = useRef(false)
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [help, setHelp] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [urlDialog, setUrlDialog] = useState(false)
  const [htmlDialog, setHtmlDialog] = useState<{ id?: string; code?: string } | null>(null)
  const [uploadMenu, setUploadMenu] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
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

  const clampZ = (z: number) => Math.min(navRef.current.maxZoom / 100, Math.max(navRef.current.minZoom / 100, z))
  const zoomAt = (sx: number, sy: number, z: number) => {
    z = clampZ(z)
    const w = screenToWorld(sx, sy)
    setCam({ x: sx - w.x * z, y: sy - w.y * z, z })
  }

  const stepFactor = () => 1 + navRef.current.buttonStep / 100
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
      // dentro de un iframe/video activo la rueda le pertenece a ese contenido
      if ((e.target as HTMLElement).closest?.('.item.active, .nav-panel, .viewer, .modal')) return
      e.preventDefault()
      const r = vp.getBoundingClientRect()
      const a = interpretWheel(e, navRef.current)
      if (a.kind === 'zoom') zoomAt(e.clientX - r.left, e.clientY - r.top, camRef.current.z * a.factor)
      else {
        const c = camRef.current
        setCam({ ...c, x: c.x - a.dx, y: c.y - a.dy })
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

  // ---------- medios: archivos, imágenes, URLs ----------
  const viewCenter = () => {
    const r = vpRef.current!.getBoundingClientRect()
    return screenToWorld(r.width / 2, r.height / 2)
  }

  /** Tamaño en el tablero: se ajusta a lo que se ve en pantalla, como Miro. */
  const fitSize = (w: number, h: number, cap = 640) => {
    const r = vpRef.current!.getBoundingClientRect()
    const max = Math.max(160, Math.min(cap / Math.max(camRef.current.z, 0.35), (Math.min(r.width, r.height) * 0.55) / camRef.current.z))
    const s = Math.min(1, max / Math.max(w, h, 1))
    return { w: Math.max(40, Math.round(w * s)), h: Math.max(30, Math.round(h * s)) }
  }

  /** Reparte varios elementos en una grilla centrada en `at`. */
  const layout = (at: Pt, sizes: { w: number; h: number }[]) => {
    const gap = 24
    const cols = Math.min(sizes.length, sizes.length <= 4 ? 4 : Math.ceil(Math.sqrt(sizes.length)))
    const rows: { w: number; h: number }[][] = []
    sizes.forEach((s, k) => (rows[Math.floor(k / cols)] ||= []).push(s))
    const rowW = rows.map((r) => r.reduce((a, s) => a + s.w, 0) + gap * (r.length - 1))
    const rowH = rows.map((r) => Math.max(...r.map((s) => s.h)))
    const totalH = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1)
    const out: Pt[] = []
    let y = at.y - totalH / 2
    rows.forEach((r, ri) => {
      let x = at.x - rowW[ri] / 2
      r.forEach((s) => {
        out.push({ x, y: y + (rowH[ri] - s.h) / 2 })
        x += s.w + gap
      })
      y += rowH[ri] + gap
    })
    return out
  }

  /** Busca, en espiral alrededor de `at`, un hueco libre para un bloque de w×h (centro devuelto). */
  const freeSpot = (at: Pt, w: number, h: number): Pt => {
    const all = Object.values(itemsRef.current).filter((i) => !i.uploading).map((i) => bounds(i, itemsRef.current))
    const pad = 32
    const hits = (c: Pt) => {
      const r = { x: c.x - w / 2 - pad, y: c.y - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 }
      return all.some((b) => intersects(r, b))
    }
    if (!hits(at)) return at
    const sx = w + pad, sy = h + pad
    for (let ring = 1; ring <= 6; ring++) {
      const cands: Pt[] = []
      for (let i = -ring; i <= ring; i++)
        for (let j = -ring; j <= ring; j++)
          if (Math.max(Math.abs(i), Math.abs(j)) === ring) cands.push({ x: at.x + i * sx, y: at.y + j * sy })
      cands.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))
      const ok = cands.find((c) => !hits(c))
      if (ok) return ok
    }
    return at
  }

  /** Lleva la cámara a un punto si quedó fuera de la vista. */
  const reveal = (c: Pt) => {
    const r = vpRef.current!.getBoundingClientRect()
    const cam = camRef.current
    const sx = c.x * cam.z + cam.x, sy = c.y * cam.z + cam.y
    if (sx < 80 || sy < 80 || sx > r.width - 80 || sy > r.height - 80) setCam({ ...cam, x: r.width / 2 - c.x * cam.z, y: r.height / 2 - c.y * cam.z })
  }

  const finishItem = (id: string, updates: Partial<Item>) => {
    const cur = itemsRef.current[id]
    if (!cur) return // lo borraron mientras subía
    const done: Item = { ...cur, ...updates }
    delete done.uploading
    apply({ [id]: done }, { history: { [id]: null } })
  }
  const dropItem = (id: string) => apply({ [id]: null }, { persist: false, broadcast: false, history: false })

  const addFiles = async (files: File[], at: Pt, free = false) => {
    const ok = files.filter((f) => {
      if (f.size > MAX_BYTES) {
        flash(`"${f.name}" supera el límite de 50 MB`)
        return false
      }
      return true
    }).slice(0, 40)
    if (!ok.length) return

    // 1) marcadores inmediatos con vista previa local
    const plans = await Promise.all(
      ok.map(async (file) => {
        const c = classify(file)
        let size = { w: 300, h: 220 }
        let local: string | undefined
        if (c.cls === 'image') {
          local = URL.createObjectURL(file)
          const d = await imageSize(local)
          size = fitSize(d.w, d.h)
        } else if (c.cls === 'heic') size = fitSize(800, 600)
        else if (c.cls === 'video') size = fitSize(640, 360)
        else if (c.cls === 'html') size = fitSize(800, 596, 900)
        else if (c.kind === 'pdf') size = { w: 320, h: 500 }
        else if (c.kind === 'audio') size = { w: 300, h: 190 }
        else size = { w: 280, h: 300 }
        return { file, c, size, local }
      }),
    )
    if (free) {
      const tmp = layout({ x: 0, y: 0 }, plans.map((p) => p.size))
      const b = unionRect(tmp.map((q, k) => ({ x: q.x, y: q.y, w: plans[k].size.w, h: plans[k].size.h })))!
      at = freeSpot(at, b.w, b.h)
      reveal(at)
    }
    const pos = layout(at, plans.map((p) => p.size))
    let { max } = zRange()
    const patch: Patch = {}
    const ids: string[] = []
    plans.forEach((p, k) => {
      const id = nanoid(10)
      ids.push(id)
      const type: Item['type'] = p.c.cls === 'image' || p.c.cls === 'heic' ? 'image' : p.c.cls === 'video' ? 'video' : p.c.cls === 'html' ? 'html' : 'file'
      patch[id] = {
        id, type, x: pos[k].x, y: pos[k].y, w: p.size.w, h: p.size.h, z: ++max, color: '#ffffff',
        name: p.file.name, mime: p.file.type, size: p.file.size, fileKind: p.c.kind, src: p.local, uploading: true, author: me.name,
      }
    })
    apply(patch, { persist: false, broadcast: false, history: false })
    setSelected(ids)
    setTool('select')

    // 2) subida y miniaturas en paralelo
    let failed = 0
    await Promise.all(
      plans.map(async (p, k) => {
        const id = ids[k]
        try {
          const up = await processFile(p.file, p.c, id)
          finishItem(id, up)
        } catch (err) {
          console.error(err)
          failed++
          dropItem(id)
        } finally {
          if (p.local) setTimeout(() => URL.revokeObjectURL(p.local!), 30000)
        }
      }),
    )
    if (failed) flash(`No se pudo${failed > 1 ? `ieron subir ${failed} archivos` : ' subir un archivo'}`)
    else flash(ok.length === 1 ? 'Archivo agregado' : `${ok.length} archivos agregados`)
  }

  const processFile = async (input: File, c: ReturnType<typeof classify>, id: string): Promise<Partial<Item>> => {
    let file = input
    if (c.cls === 'heic') {
      file = await heicToJpeg(file)
      c = { cls: 'image' }
    }
    if (c.cls === 'image') {
      file = await limitImage(file)
      const src = await uploadBlob(boardId, file, file.name)
      if (file !== input) {
        // convertida (HEIC) o reducida: recalcular proporción conservando el ancho actual
        const d = await imageSize(src)
        const cur = itemsRef.current[id]
        const w = cur?.w || fitSize(d.w, d.h).w
        return { src, name: file.name, mime: file.type, size: file.size, w, h: Math.round((w * d.h) / Math.max(d.w, 1)) }
      }
      return { src, mime: file.type, size: file.size }
    }
    if (c.cls === 'html') {
      const code = await file.text()
      const src = await uploadBlob(boardId, file, file.name, 'text/html')
      return { src, html: code.length <= HTML_INLINE_MAX ? code : undefined, title: htmlTitle(code) || file.name.replace(/\.x?html?$/i, '') }
    }
    if (c.cls === 'video') {
      const poster = await videoPoster(file)
      const [src, thumb] = await Promise.all([
        uploadBlob(boardId, file, file.name),
        poster.blob ? uploadBlob(boardId, poster.blob, `${file.name}.jpg`, 'image/jpeg') : Promise.resolve(undefined),
      ])
      const s = fitSize(poster.w, poster.h)
      return { src, thumb, w: s.w, h: s.h }
    }
    // documentos
    const out: Partial<Item> = {}
    const srcP = uploadBlob(boardId, file, file.name)
    if (c.kind === 'pdf') {
      const doc = await loadPdf(await file.arrayBuffer(), `local-${id}`)
      const first = await pdfPageBlob(doc, 1, 900)
      out.pages = doc.numPages
      out.page = 1
      out.thumb = await uploadBlob(boardId, first.blob, `${file.name}-p1.png`, 'image/png')
      const w = 320
      out.w = w
      out.h = Math.round(Math.min(w * 2.2, (w * first.h) / first.w)) + 52
    } else {
      const [cover, snippet] = await Promise.all([officeThumbnail(file), textSnippet(file)])
      if (snippet) out.snippet = snippet
      // Word: el texto real es mejor vista previa; presentaciones y hojas: la portada del archivo
      if (cover && !(c.kind === 'doc' && snippet)) {
        const local = URL.createObjectURL(cover)
        const d = await imageSize(local)
        URL.revokeObjectURL(local)
        out.thumb = await uploadBlob(boardId, cover, `${file.name}-cover.${cover.type === 'image/png' ? 'png' : 'jpg'}`, cover.type)
        out.w = 280
        out.h = Math.round(Math.min(380, (280 * d.h) / Math.max(d.w, 1))) + 52
      }
    }
    out.src = await srcP
    return out
  }

  const addEmbed = (info: EmbedInfo, url: string, at: Pt, free = false) => {
    const s = fitSize(info.w, info.h + 36, 900)
    if (free) {
      at = freeSpot(at, s.w, s.h)
      reveal(at)
    }
    const id = nanoid(10)
    const it: Item = {
      id, type: 'embed', x: at.x - s.w / 2, y: at.y - s.h / 2, w: s.w, h: s.h, z: zRange().max + 1, color: '#ffffff',
      url, embed: info.embed, provider: info.provider, favicon: faviconFor(url), author: me.name,
    }
    apply({ [id]: it })
    setSelected([id])
    setTool('select')
    // título real en segundo plano
    fetchPreview(url).then((p) => {
      const cur = itemsRef.current[id]
      if (cur && p.title) apply({ [id]: { ...cur, title: p.title, favicon: p.favicon || cur.favicon } }, { history: false })
    })
    return true
  }

  const addUrl = async (raw: string, at: Pt, free = false): Promise<boolean> => {
    const ifr = iframeSrc(raw)
    if (ifr) return addEmbed(ifr, ifr.embed, at, free)
    const url = asUrl(raw)
    if (!url) return false
    const emb = embedFor(url)
    if (emb) return addEmbed(emb, url, at, free)
    if (free) {
      at = freeSpot(at, 360, 320)
      reveal(at)
    }

    // tarjeta provisoria mientras se obtiene la vista previa
    const id = nanoid(10)
    const host = hostOf(url)
    apply(
      { [id]: { id, type: 'link', x: at.x - 180, y: at.y - 64, w: 360, h: 128, z: zRange().max + 1, color: '#ffffff', url, title: host, favicon: faviconFor(url), uploading: true } },
      { persist: false, broadcast: false, history: false },
    )
    setSelected([id])
    setTool('select')
    const p = await fetchPreview(url)
    const cur = itemsRef.current[id]
    if (!cur) return true
    const center = { x: cur.x + cur.w / 2, y: cur.y + cur.h / 2 }

    if (p.kind === 'image' || p.kind === 'file') {
      const name = p.name || decodeURIComponent(new URL(p.url || url).pathname.split('/').pop() || 'archivo')
      const f = await fetchRemoteFile(p.url || url, name)
      if (f) {
        dropItem(id)
        await addFiles([f], center)
        return true
      }
      if (p.kind === 'image') {
        const d = await imageSize(p.url || url)
        const s = fitSize(d.w, d.h)
        finishItem(id, { type: 'image', src: p.url || url, name, x: center.x - s.w / 2, y: center.y - s.h / 2, w: s.w, h: s.h })
        return true
      }
      finishItem(id, { title: name, desc: 'Archivo externo · doble clic para abrir', favicon: p.favicon || cur.favicon })
      return true
    }
    if (p.kind === 'video') {
      const s = fitSize(640, 360)
      finishItem(id, { type: 'video', src: p.url || url, name: hostOf(url), x: center.x - s.w / 2, y: center.y - s.h / 2, w: s.w, h: s.h })
      return true
    }
    const hasImg = !!p.image
    const h = (hasImg ? 188 : 0) + (p.description ? 128 : 96)
    finishItem(id, {
      title: p.title || host, desc: p.description, thumb: p.image, favicon: p.favicon || cur.favicon, provider: p.site,
      url: p.url || url, h, y: center.y - h / 2,
    })
    return true
  }

  const faviconFor = (url: string) => {
    try {
      return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`
    } catch {
      return undefined
    }
  }

  /** Crea (o actualiza) un elemento HTML a partir de código. */
  const saveHtml = async (code: string, id?: string) => {
    const big = code.length > HTML_INLINE_MAX
    const title = htmlTitle(code) || 'Página HTML'
    if (id && itemsRef.current[id]) {
      const cur = itemsRef.current[id]
      const upd: Item = { ...cur, title: cur.title && cur.name ? cur.title : title, html: big ? undefined : code }
      if (big) {
        setProgress('Guardando HTML…')
        try {
          upd.src = await uploadBlob(boardId, new Blob([code], { type: 'text/html' }), `${cur.name || 'pagina'}.html`, 'text/html')
        } finally {
          setProgress(null)
        }
      }
      apply({ [id]: upd })
      return
    }
    const s = fitSize(800, 596, 900)
    const at = freeSpot(viewCenter(), s.w, s.h)
    reveal(at)
    const nid = nanoid(10)
    const it: Item = { id: nid, type: 'html', x: at.x - s.w / 2, y: at.y - s.h / 2, w: s.w, h: s.h, z: zRange().max + 1, color: '#ffffff', title, author: me.name }
    if (big) {
      setProgress('Guardando HTML…')
      try {
        it.src = await uploadBlob(boardId, new Blob([code], { type: 'text/html' }), 'pagina.html', 'text/html')
        it.name = 'pagina.html'
      } finally {
        setProgress(null)
      }
    } else it.html = code
    apply({ [nid]: it })
    setSelected([nid])
    setTool('select')
  }

  const editHtml = async (it: Item) => {
    let code = it.html
    if (code == null && it.src) {
      try {
        code = await htmlText(it.src)
      } catch {
        return flash('No se pudo abrir el código')
      }
    }
    setHtmlDialog({ id: it.id, code: code || '' })
  }

  const downloadHtml = (it: Item) => {
    if (it.src && it.html == null) return window.open(downloadUrl(it.src, it.name || 'pagina.html'), '_blank')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([it.html || ''], { type: 'text/html' }))
    a.download = `${(it.title || 'pagina').replace(/[^\w\- ]+/g, '').trim() || 'pagina'}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  /** Convierte una tarjeta de enlace en la página web incrustada (si el sitio lo permite). */
  const embedLink = (it: Item) => {
    if (!it.url) return
    const s = fitSize(960, 640, 1000)
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2
    apply({
      [it.id]: { ...it, type: 'embed', embed: it.url, provider: hostOf(it.url), x: cx - s.w / 2, y: cy - s.h / 2, w: s.w, h: s.h },
    })
    flash('Si la página queda en blanco, ese sitio no permite incrustarse')
  }

  const rotateImage = (it: Item) => {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2
    apply({ [it.id]: { ...it, rotation: ((it.rotation || 0) + 90) % 360, w: it.h, h: it.w, x: cx - it.h / 2, y: cy - it.w / 2 } })
  }

  const extractPages = async (it: Item) => {
    if (!it.src) return
    try {
      setProgress('Preparando páginas…')
      const doc = await loadPdf(it.src)
      const n = Math.min(doc.numPages, 80)
      const cols = Math.min(n, 5)
      const gap = 24
      const w = it.w
      let { max } = zRange()
      const base = (it.name || 'pagina').replace(/\.pdf$/i, '')
      const ids: string[] = []
      let x = it.x, y = it.y + it.h + 40, rowH = 0
      for (let k = 1; k <= n; k++) {
        setProgress(`Extrayendo página ${k} de ${n}…`)
        const pg = await pdfPageBlob(doc, k, 1400)
        const src = await uploadBlob(boardId, pg.blob, `${base}-p${k}.png`, 'image/png')
        const h = Math.round((w * pg.h) / pg.w)
        const id = nanoid(10)
        ids.push(id)
        apply({ [id]: { id, type: 'image', x, y, w, h, z: ++max, color: '#ffffff', src, name: `${base} · p. ${k}`, mime: 'image/png', author: me.name } })
        rowH = Math.max(rowH, h)
        if (k % cols === 0) {
          x = it.x
          y += rowH + gap
          rowH = 0
        } else x += w + gap
      }
      setSelected(ids)
      flash(`${n} páginas extraídas${doc.numPages > n ? ` (de ${doc.numPages})` : ''}`)
    } catch (e) {
      console.error(e)
      flash('No se pudieron extraer las páginas')
    } finally {
      setProgress(null)
    }
  }

  const sheetToStickies = async (it: Item) => {
    if (!it.src) return
    try {
      setProgress('Leyendo la hoja…')
      const blob = await (await fetch(it.src)).blob()
      const rows = (await sheetRows(blob, 200)).map((r) => r.filter(Boolean).join('\n')).filter(Boolean)
      if (!rows.length) return flash('La hoja está vacía')
      const cols = Math.min(6, rows.length)
      let { max } = zRange()
      const patch: Patch = {}
      rows.forEach((text, k) => {
        const id = nanoid(10)
        patch[id] = {
          id, type: 'sticky', x: it.x + (k % cols) * 220, y: it.y + it.h + 40 + Math.floor(k / cols) * 220, w: 200, h: 200,
          z: ++max, color: STICKY_COLORS[k % 6], text, author: me.name,
        }
      })
      apply(patch)
      setSelected(Object.keys(patch))
      flash(`${rows.length} notas creadas`)
    } catch (e) {
      console.error(e)
      flash('No se pudo leer la hoja de cálculo')
    } finally {
      setProgress(null)
    }
  }

  const openItem = (it: Item) => {
    if (it.type === 'link') window.open(it.url, '_blank', 'noopener')
    else if (it.type === 'embed' || it.type === 'html' || it.type === 'video' || (it.type === 'file' && it.fileKind === 'audio')) setActiveId(it.id)
    else if (it.type === 'image' || it.type === 'file') setViewerId(it.id)
  }

  const setPage = useCallback(
    (id: string, page: number) => {
      const it = itemsRef.current[id]
      if (it) apply({ [id]: { ...it, page } })
    },
    [apply, itemsRef],
  )
  const mediaApi = useMemo(() => ({ activeId, setPage }), [activeId, setPage])

  const onDragOver = (e: React.DragEvent) => {
    const types = [...e.dataTransfer.types]
    if (!types.includes('Files') && !types.includes('text/uri-list') && !types.includes('text/plain')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dragOver) setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.relatedTarget || !vpRef.current!.contains(e.relatedTarget as Node)) setDragOver(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const at = evToWorld(e)
    const files = [...e.dataTransfer.files]
    if (files.length) {
      addFiles(files, at)
      return
    }
    const html = e.dataTransfer.getData('text/html')
    const imgSrc = html.match(/<img[^>]+src=["'](https?:[^"']+)["']/i)?.[1]
    const uri = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'))
    const text = e.dataTransfer.getData('text/plain')
    const target = imgSrc || uri || text
    if (target) addUrl(target, at).then((ok) => !ok && text && flash('Solo se pueden soltar archivos o enlaces'))
  }

  // ---------- puntero ----------
  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('textarea, input, .ctx, .ctl')) return
    const activeEl = target.closest('.item.active')
    if (activeEl && !target.closest('[data-id]')) return // controles del video / iframe activo
    if (activeId && !activeEl) setActiveId(null)
    if (uploadMenu) setUploadMenu(false)
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

    const n = navRef.current
    const emptyCanvas = !hitId && !handle
    if (
      t === 'hand' ||
      (e.button === 1 && n.panMiddle) ||
      (e.button === 2 && n.panRight) ||
      (spaceDown && n.panSpace) ||
      (e.button === 0 && t === 'select' && emptyCanvas && n.leftDrag === 'pan' && !e.shiftKey)
    ) {
      if (e.button === 1) e.preventDefault()
      if (e.button === 0 && t === 'select' && emptyCanvas && !e.shiftKey) setSelected([])
      rightPan.current = e.button === 2
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
        const z = clampZ(d.cam.z * (Math.hypot(a.x - b.x, a.y - b.y) / d.d0))
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
        if (e.shiftKey || o.type === 'sticky' || keepsAspect(o)) {
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
    // con pointer capture el navegador entrega el dblclick al lienzo: buscamos el elemento real bajo el cursor
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement) || (e.target as HTMLElement)
    if (target.closest('textarea, input, .ctx, .ctl')) return
    const id = target.closest('[data-id]')?.getAttribute('data-id')
    if (id && itemsRef.current[id]) {
      setSelected([id])
      const it = itemsRef.current[id]
      if (isMedia(it)) {
        if (!it.uploading) openItem(it)
        return
      }
      startEdit(id)
    } else if (toolRef.current === 'select') {
      const mode = navRef.current.dblClick
      if (mode === 'none') return
      if (mode === 'zoom') {
        const r = vpRef.current!.getBoundingClientRect()
        zoomAt(e.clientX - r.left, e.clientY - r.top, camRef.current.z * stepFactor() * stepFactor())
        return
      }
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
      const plain = !mod && navRef.current.plainKeys
      if ((mod || plain) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomBy(stepFactor())
        return
      }
      if ((mod || plain) && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        zoomBy(1 / stepFactor())
        return
      }
      if (mod && e.key === '0') {
        e.preventDefault()
        const r = vpRef.current!.getBoundingClientRect()
        zoomAt(r.width / 2, r.height / 2, 1)
        return
      }
      if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) {
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
        if (activeId) setActiveId(null)
        else setSelected([])
        setTool('select')
        setUploadMenu(false)
        return
      }
      if (e.key === 'Enter' && selRef.current.length === 1) {
        e.preventDefault()
        const it = itemsRef.current[selRef.current[0]]
        if (it && isMedia(it)) openItem(it)
        else startEdit(selRef.current[0])
        return
      }
      if (e.key.toLowerCase() === 'u') {
        fileInput.current?.click()
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
      // capturas de pantalla, imágenes copiadas y archivos copiados del explorador
      const files = [...(e.clipboardData?.files || [])]
      if (files.length) {
        addFiles(files, mid, true)
        return
      }
      if (looksLikeHtml(text)) {
        saveHtml(text)
        return
      }
      if (!text.trim().startsWith('{') && (iframeSrc(text) || asUrl(text))) {
        addUrl(text, mid, true)
        return
      }
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
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <MediaCtx.Provider value={mediaApi}>
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
        </MediaCtx.Provider>
        {dragOver && (
          <div className="drop-zone">
            <div>
              <Icon name="upload" size={34} />
              <strong>Suelta para agregar al tablero</strong>
              <span>Imágenes, PDF, Word, Excel, PowerPoint, videos, audio, enlaces…</span>
            </div>
          </div>
        )}

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
            const media = selItems.some(isMedia)
            const m = single && isMedia(single) && !single.uploading ? single : null
            return (
              <div className="ctx" style={{ top, left }} onPointerDown={(e) => e.stopPropagation()}>
                {m && (
                  <>
                    {(m.type === 'image' || (m.type === 'file' && m.fileKind !== 'audio')) && (
                      <button className="ib wide" title="Ver (doble clic)" onClick={() => openItem(m)}><Icon name="eye" /> Ver</button>
                    )}
                    {(m.type === 'video' || m.fileKind === 'audio') && (
                      <button className="ib wide" title="Reproducir (doble clic)" onClick={() => openItem(m)}><Icon name="play" size={16} /> Reproducir</button>
                    )}
                    {(m.type === 'embed' || m.type === 'html') && (
                      <button className="ib wide" title="Interactuar (doble clic)" onClick={() => openItem(m)}>Interactuar</button>
                    )}
                    {m.type === 'html' && (
                      <>
                        <button className="ib" title="Pantalla completa" onClick={() => setViewerId(m.id)}><Icon name="eye" /></button>
                        <button className="ib wide" title="Editar el código HTML" onClick={() => editHtml(m)}><Icon name="code" /> Código</button>
                        <button className="ib" title="Descargar .html" onClick={() => downloadHtml(m)}><Icon name="download" /></button>
                      </>
                    )}
                    {m.type === 'link' && (
                      <button className="ib wide" title="Mostrar la página dentro del tablero" onClick={() => embedLink(m)}><Icon name="code" /> Incrustar página</button>
                    )}
                    {m.type === 'image' && (
                      <button className="ib" title="Rotar 90°" onClick={() => rotateImage(m)}><Icon name="rotate" /></button>
                    )}
                    {m.fileKind === 'pdf' && (m.pages || 1) > 1 && (
                      <button className="ib wide" title="Extraer páginas como imágenes" onClick={() => extractPages(m)}><Icon name="pages" /> Extraer páginas</button>
                    )}
                    {m.type === 'file' && isSheetImportable(m.name) && (
                      <button className="ib wide" title="Crear una nota por fila" onClick={() => sheetToStickies(m)}><Icon name="notes" /> A notas</button>
                    )}
                    {(m.type === 'link' || m.type === 'embed') && (
                      <a className="ib" title="Abrir en una pestaña nueva" href={m.url} target="_blank" rel="noreferrer"><Icon name="open" /></a>
                    )}
                    {m.src && m.type !== 'link' && m.type !== 'embed' && m.type !== 'html' && (
                      <a className="ib" title="Descargar" href={downloadUrl(m.src, m.name)} target="_blank" rel="noreferrer"><Icon name="download" /></a>
                    )}
                    <span className="sep" />
                  </>
                )}
                {!media && <div className="swatches">
                  {palette.map((c) => (
                    <button key={c} className={`sw${selItems[0].color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => recolor(c)} title={c} />
                  ))}
                </div>}
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
              <button onClick={() => { setNavOpen(true); setMenu(false) }}>Navegación y zoom…</button>
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
        <div className="upload-wrap">
          <button className={`tool${uploadMenu ? ' on' : ''}`} title="Subir archivo o enlace (U)" onClick={() => setUploadMenu((v) => !v)}>
            <Icon name="upload" />
          </button>
          {uploadMenu && (
            <div className="upload-menu">
              <button onClick={() => { setUploadMenu(false); fileInput.current?.click() }}>
                <Icon name="file" /> <span><strong>Desde tu dispositivo</strong><small>Imágenes, PDF, Office, video, audio… (máx. 50 MB)</small></span>
              </button>
              <button onClick={() => { setUploadMenu(false); setUrlDialog(true) }}>
                <Icon name="link" /> <span><strong>Desde una URL</strong><small>Páginas, YouTube, Figma, Google Docs, Maps, archivos…</small></span>
              </button>
              <button onClick={() => { setUploadMenu(false); setHtmlDialog({}) }}>
                <Icon name="code" /> <span><strong>Código HTML</strong><small>Pega o escribe una página; se ejecuta aislada en el tablero</small></span>
              </button>
              <button onClick={() => { setUploadMenu(false); cameraInput.current?.click() }}>
                <Icon name="camera" /> <span><strong>Tomar una foto</strong><small>Con la cámara del teléfono o tablet</small></span>
              </button>
              <p>También puedes <b>arrastrar</b> archivos (incluidos <b>.html</b>) al tablero o <b>pegar</b> (Ctrl+V) imágenes, enlaces y código HTML.</p>
            </div>
          )}
        </div>
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

      {nav.showZoomBar ? (
      <div className="zoom">
        <button className="ib" onClick={() => zoomBy(1 / stepFactor())} title={`Alejar ${nav.buttonStep}%`}>−</button>
        <button className="zv" onClick={() => { const r = vpRef.current!.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1) }} title="100%">
          {Math.round(cam.z * 100)}%
        </button>
        <button className="ib" onClick={() => zoomBy(stepFactor())} title={`Acercar ${nav.buttonStep}%`}>+</button>
        <span className="sep" />
        <button className="ib" onClick={fitAll} title="Ajustar a la pantalla (Shift+1)"><Icon name="fit" /></button>
        <button className={`ib${navOpen ? ' on' : ''}`} onClick={() => setNavOpen((v) => !v)} title="Navegación y zoom"><Icon name="gear" /></button>
        <button className="ib" onClick={() => setHelp(true)} title="Ayuda (?)">?</button>
      </div>
      ) : (
        <button className="zoom zoom-mini ib" onClick={() => setNavOpen((v) => !v)} title="Navegación y zoom"><Icon name="gear" /></button>
      )}
      {navOpen && <NavPanel value={nav} onChange={setNav} onClose={() => setNavOpen(false)} />}

      {status === 'loading' && <div className="loading">Cargando tablero…</div>}
      {status === 'ready' && sorted.length === 0 && (
        <div className="empty-hint">
          <strong>Tablero vacío</strong>
          Doble clic para una nota · arrastra imágenes, PDF o documentos · pega enlaces con Ctrl+V
        </div>
      )}
      {progress && <div className="toast progress"><span className="spinner light" /> {progress}</div>}
      {!progress && toast && <div className="toast">{toast}</div>}
      {help && <Help onClose={() => setHelp(false)} />}
      {viewerId && items[viewerId] && <Viewer item={items[viewerId]} onClose={() => setViewerId(null)} />}
      {htmlDialog && (
        <HtmlDialog
          title={htmlDialog.id ? 'Editar HTML' : 'Nuevo HTML'}
          initial={htmlDialog.code}
          onClose={() => setHtmlDialog(null)}
          onSave={(code) => {
            const id = htmlDialog.id
            setHtmlDialog(null)
            saveHtml(code, id)
          }}
        />
      )}
      {urlDialog && (
        <UrlDialog
          onClose={() => setUrlDialog(false)}
          onSubmit={(u) => {
            setUrlDialog(false)
            addUrl(u, viewCenter(), true).then((ok) => !ok && flash('Ese texto no parece un enlace válido'))
          }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const f = [...(e.target.files || [])]
          e.target.value = ''
          if (f.length) addFiles(f, viewCenter(), true)
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = [...(e.target.files || [])]
          e.target.value = ''
          if (f.length) addFiles(f, viewCenter(), true)
        }}
      />
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
    ['Rueda / pellizco', 'Zoom o desplazar según ⚙ Navegación'],
    ['Botón derecho o central + arrastrar', 'Mover lienzo (configurable)'],
    ['+ / −', 'Acercar / alejar'],
    ['Shift + clic / arrastrar', 'Selección múltiple'],
    ['Ctrl+C / X / V', 'Copiar, cortar, pegar (también entre tableros)'],
    ['Ctrl+D', 'Duplicar'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Deshacer / rehacer'],
    ['Flechas (Shift)', 'Mover selección'],
    ['Supr / Retroceso', 'Eliminar'],
    ['Shift+1 · Ctrl+0', 'Ajustar a la pantalla · zoom 100%'],
    ['Pegar texto', 'Crea una nota por línea'],
    ['Arrastrar archivos', 'Imágenes, PDF, Office, video, audio…'],
    ['Pegar imagen / enlace / HTML', 'Captura, URL, código <iframe> o página HTML'],
    ['U', 'Subir archivo desde el dispositivo'],
    ['Doble clic en archivo', 'Ver, reproducir o interactuar'],
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
