export type ItemType =
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'text'
  | 'frame'
  | 'connector'
  | 'pen'

export interface End {
  id?: string
  x: number
  y: number
}

export interface Item {
  id: string
  type: ItemType
  x: number
  y: number
  w: number
  h: number
  z: number
  color: string
  text?: string
  fontSize?: number // undefined = automático
  // connector
  from?: End
  to?: End
  arrow?: boolean
  // pen (coordenadas relativas a x,y)
  points?: number[]
  stroke?: number
  author?: string
}

export type Patch = Record<string, Item | null>

export type Tool =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'text'
  | 'frame'
  | 'connector'
  | 'pen'

export interface Me {
  id: string
  name: string
  color: string
}

export interface Peer {
  id: string
  name: string
  color: string
  x?: number
  y?: number
  t?: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
