import type { Me } from './types'
import { nanoid } from 'nanoid'

export interface Recent {
  id: string
  name: string
  ts: number
}

const RKEY = 'pizarra-recent'
const MKEY = 'pizarra-me'

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* almacenamiento no disponible */
  }
}

export const recentBoards = () => read<Recent[]>(RKEY, [])

export function rememberBoard(id: string, name: string) {
  const list = recentBoards().filter((r) => r.id !== id)
  list.unshift({ id, name: name || 'Tablero sin título', ts: Date.now() })
  write(RKEY, list.slice(0, 30))
}

export function forgetBoard(id: string) {
  write(RKEY, recentBoards().filter((r) => r.id !== id))
}

const COLORS = ['#e5484d', '#f76b15', '#d6a000', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f']
const ANIMALS = ['Zorro', 'Puma', 'Cóndor', 'Huemul', 'Pudú', 'Llama', 'Colibrí', 'Pingüino', 'Delfín', 'Búho', 'Nutria', 'Guanaco']

export function loadMe(): Me {
  const m = read<Me | null>(MKEY, null)
  if (m?.id) return m
  const me = {
    id: nanoid(8),
    name: `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]} ${Math.floor(Math.random() * 90 + 10)}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
  write(MKEY, me)
  return me
}

export const saveMe = (m: Me) => write(MKEY, m)
