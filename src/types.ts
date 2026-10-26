export type ItemType =
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'text'
  | 'frame'
  | 'connector'
  | 'pen'
  | 'image'
  | 'file'
  | 'video'
  | 'link'
  | 'embed'

/** Subtipo de archivo para tarjetas de documento */
export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'text' | 'archive' | 'audio' | 'design' | 'other'

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
  // medios (image / file / video / link / embed)
  src?: string // URL pública del archivo
  thumb?: string // miniatura (primera página de PDF, portada de Office, fotograma de video)
  name?: string
  mime?: string
  size?: number
  fileKind?: FileKind
  pages?: number // PDF: total de páginas
  page?: number // PDF: página visible (1..pages)
  rotation?: number // 0 | 90 | 180 | 270 (imágenes)
  snippet?: string // texto de vista previa (txt, csv, docx…)
  url?: string // link / embed: URL original
  embed?: string // embed: URL del iframe
  provider?: string
  title?: string
  desc?: string
  favicon?: string
  uploading?: boolean // solo local, mientras sube
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
