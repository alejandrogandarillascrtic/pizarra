import { nanoid } from 'nanoid'
import type { Item } from './types'

export interface Template {
  id: string
  name: string
  desc: string
  build: () => Item[]
}

let z = 0
const it = (p: Partial<Item> & Pick<Item, 'type' | 'x' | 'y' | 'w' | 'h' | 'color'>): Item => ({ id: nanoid(10), z: ++z, text: '', ...p })
const frame = (x: number, y: number, w: number, h: number, text: string, color = '#ffffff') =>
  it({ type: 'frame', x, y, w, h, color, text, z: -100 + ++z })
const note = (x: number, y: number, text: string, color = '#fff176') => it({ type: 'sticky', x, y, w: 180, h: 180, color, text })
const title = (x: number, y: number, w: number, text: string, fontSize = 40) => it({ type: 'text', x, y, w, h: 56, color: '#1b1f3b', text, fontSize })

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'En blanco', desc: 'Lienzo infinito vacío', build: () => [] },
  {
    id: 'brainstorm',
    name: 'Lluvia de ideas',
    desc: 'Tema central y notas alrededor',
    build: () => {
      z = 0
      const c = it({ type: 'ellipse', x: -130, y: -130, w: 260, h: 260, color: '#1b1f3b', text: '¿Cuál es el desafío?', fontSize: 26 })
      const colors = ['#fff176', '#ffcc80', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#d1c4e9']
      const notes = colors.map((col, k) => {
        const a = (k / colors.length) * Math.PI * 2 - Math.PI / 2
        return note(Math.cos(a) * 420 - 90, Math.sin(a) * 340 - 90, 'Idea', col)
      })
      const lines = notes.map((n) =>
        it({ type: 'connector', x: 0, y: 0, w: 0, h: 0, color: '#5f6577', from: { id: c.id, x: 0, y: 0 }, to: { id: n.id, x: 0, y: 0 }, arrow: false }),
      )
      return [title(-300, -560, 600, 'Lluvia de ideas'), c, ...notes, ...lines]
    },
  },
  {
    id: 'retro',
    name: 'Retrospectiva',
    desc: 'Qué salió bien, qué mejorar, acciones',
    build: () => {
      z = 0
      const cols: [string, string, string][] = [
        ['😀 Qué salió bien', '#e8f5e9', '#c5e1a5'],
        ['🤔 Qué podemos mejorar', '#fff8e1', '#ffcc80'],
        ['🚀 Acciones', '#e3f2fd', '#b3e5fc'],
      ]
      const out: Item[] = [title(0, -110, 900, 'Retrospectiva del sprint', 44)]
      cols.forEach(([t, bg, nc], k) => {
        const x = k * 520
        out.push(frame(x, 0, 480, 760, t, bg))
        out.push(note(x + 40, 60, 'Escribe aquí', nc), note(x + 250, 60, '', nc))
      })
      return out
    },
  },
  {
    id: 'kanban',
    name: 'Kanban',
    desc: 'Por hacer · En curso · Hecho',
    build: () => {
      z = 0
      const cols = ['Por hacer', 'En curso', 'Revisión', 'Hecho']
      const out: Item[] = [title(0, -110, 900, 'Tablero Kanban', 44)]
      cols.forEach((t, k) => {
        const x = k * 360
        out.push(frame(x, 0, 330, 900, t, '#f4f5f7'))
      })
      out.push(note(40, 60, 'Tarea 1', '#fff176'), note(40, 270, 'Tarea 2', '#ffcc80'), note(400, 60, 'Tarea 3', '#b3e5fc'), note(1120, 60, 'Tarea 4', '#c5e1a5'))
      return out
    },
  },
  {
    id: 'flow',
    name: 'Diagrama de flujo',
    desc: 'Inicio, decisión y resultados',
    build: () => {
      z = 0
      const a = it({ type: 'ellipse', x: 0, y: 0, w: 200, h: 100, color: '#c8efc0', text: 'Inicio' })
      const b = it({ type: 'rect', x: 0, y: 200, w: 200, h: 110, color: '#ffffff', text: 'Paso' })
      const c = it({ type: 'diamond', x: -10, y: 410, w: 220, h: 160, color: '#fff3b0', text: '¿Decisión?' })
      const d = it({ type: 'rect', x: -320, y: 680, w: 200, h: 110, color: '#bde3ff', text: 'Sí' })
      const e = it({ type: 'rect', x: 320, y: 680, w: 200, h: 110, color: '#ffc6d9', text: 'No' })
      const link = (f: Item, t: Item) =>
        it({ type: 'connector', x: 0, y: 0, w: 0, h: 0, color: '#1b1f3b', from: { id: f.id, x: 0, y: 0 }, to: { id: t.id, x: 0, y: 0 }, arrow: true })
      return [a, b, c, d, e, link(a, b), link(b, c), link(c, d), link(c, e)]
    },
  },
]
