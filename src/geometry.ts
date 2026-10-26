import type { End, Item, Rect } from './types'

export const STICKY_COLORS = ['#fff176', '#ffcc80', '#f8bbd0', '#d1c4e9', '#b3e5fc', '#c5e1a5', '#e0e0e0', '#ffffff']
export const SHAPE_COLORS = ['#ffffff', '#fff3b0', '#ffd6a5', '#ffc6d9', '#d7ccf5', '#bde3ff', '#c8efc0', '#1b1f3b']
export const INK_COLORS = ['#1b1f3b', '#5f6577', '#e5484d', '#f76b15', '#e2a700', '#30a46c', '#0090ff', '#8e4ec6']

export const isTextual = (t: Item['type']) =>
  t === 'sticky' || t === 'rect' || t === 'ellipse' || t === 'diamond' || t === 'text' || t === 'frame'

export function center(i: Item) {
  return { x: i.x + i.w / 2, y: i.y + i.h / 2 }
}

export function endPoint(end: End, other: { x: number; y: number }, items: Record<string, Item>) {
  if (end.id && items[end.id]) return edgePoint(items[end.id], other)
  return { x: end.x, y: end.y }
}

export function endAnchor(end: End, items: Record<string, Item>) {
  if (end.id && items[end.id]) return center(items[end.id])
  return { x: end.x, y: end.y }
}

/** Punto del borde de un item en dirección a `toward` (desde su centro). */
export function edgePoint(i: Item, toward: { x: number; y: number }) {
  const c = center(i)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = i.w / 2 + 6
  const hh = i.h / 2 + 6
  if (i.type === 'ellipse') {
    const t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
    return { x: c.x + dx * t, y: c.y + dy * t }
  }
  if (i.type === 'diamond') {
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
    return { x: c.x + dx * t, y: c.y + dy * t }
  }
  const t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9))
  return { x: c.x + dx * t, y: c.y + dy * t }
}

export function connectorPoints(i: Item, items: Record<string, Item>) {
  const a0 = endAnchor(i.from!, items)
  const b0 = endAnchor(i.to!, items)
  const a = endPoint(i.from!, b0, items)
  const b = endPoint(i.to!, a0, items)
  return { a, b }
}

export function bounds(i: Item, items: Record<string, Item>): Rect {
  if (i.type === 'connector' && i.from && i.to) {
    const { a, b } = connectorPoints(i, items)
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
  }
  return { x: i.x, y: i.y, w: i.w, h: i.h }
}

export function unionRect(rs: Rect[]): Rect | null {
  if (!rs.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const r of rs) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

export function normRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function translate(i: Item, dx: number, dy: number): Item {
  if (i.type === 'connector') {
    const mv = (e?: End) => (e ? (e.id ? e : { x: e.x + dx, y: e.y + dy }) : e)
    return { ...i, from: mv(i.from), to: mv(i.to) }
  }
  return { ...i, x: i.x + dx, y: i.y + dy }
}

/** Tamaño de fuente automático (estilo nota adhesiva). */
export function autoFont(i: Item) {
  if (i.fontSize) return i.fontSize
  if (i.type === 'text') return 20
  if (i.type === 'frame') return 14
  const text = i.text || ''
  const area = Math.max(1, (i.w - 24) * (i.h - 24))
  const len = Math.max(8, text.length)
  const size = Math.sqrt(area / (len * 0.62))
  return Math.max(10, Math.min(i.type === 'sticky' ? 32 : 24, Math.floor(size)))
}

export function darken(hex: string, amt = 0.28) {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const n = parseInt(m, 16)
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amt)))
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function isDark(hex: string) {
  const m = hex.replace('#', '')
  if (m.length !== 6) return false
  const n = parseInt(m, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (r * 299 + g * 587 + b * 114) / 1000 < 110
}

export function penPath(points: number[]) {
  if (points.length < 4) return ''
  let d = `M ${points[0]} ${points[1]}`
  for (let k = 2; k < points.length - 2; k += 2) {
    const mx = (points[k] + points[k + 2]) / 2
    const my = (points[k + 1] + points[k + 3]) / 2
    d += ` Q ${points[k]} ${points[k + 1]} ${mx} ${my}`
  }
  const n = points.length
  d += ` L ${points[n - 2]} ${points[n - 1]}`
  return d
}
