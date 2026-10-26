import { nanoid } from 'nanoid'
import { supabase } from './supabase'
import type { FileKind, Item } from './types'

export const MAX_BYTES = 50 * 1024 * 1024
const BUCKET = 'uploads'

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

const ext = (name: string) => (name.split('.').pop() || '').toLowerCase()

/** Imágenes que el navegador dibuja directamente. */
const WEB_IMAGES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'jfif', 'pjpeg']
const HEIC = ['heic', 'heif']
const VIDEO = ['mp4', 'mov', 'webm', 'm4v', 'ogv']
const AUDIO = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac']

const KIND_BY_EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  txt: 'text', md: 'text', json: 'text', xml: 'text', html: 'text', log: 'text', yml: 'text', yaml: 'text',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive',
  psd: 'design', ai: 'design', sketch: 'design', fig: 'design', tif: 'design', tiff: 'design', eps: 'design', dwg: 'design', dxf: 'design',
}

export type MediaClass = 'image' | 'heic' | 'video' | 'file'

export function classify(file: File): { cls: MediaClass; kind?: FileKind } {
  const e = ext(file.name)
  const t = file.type
  if (HEIC.includes(e) || t === 'image/heic' || t === 'image/heif') return { cls: 'heic' }
  if (WEB_IMAGES.includes(e) || (t.startsWith('image/') && !['image/tiff', 'image/vnd.adobe.photoshop'].includes(t) && !KIND_BY_EXT[e]))
    return { cls: 'image' }
  if (VIDEO.includes(e) || t.startsWith('video/')) return { cls: 'video' }
  if (AUDIO.includes(e) || t.startsWith('audio/')) return { cls: 'file', kind: 'audio' }
  if (t === 'application/pdf') return { cls: 'file', kind: 'pdf' }
  return { cls: 'file', kind: KIND_BY_EXT[e] || 'other' }
}

export const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF', doc: 'Documento', sheet: 'Hoja de cálculo', slides: 'Presentación', text: 'Texto',
  archive: 'Archivo comprimido', audio: 'Audio', design: 'Diseño', other: 'Archivo',
}
export const KIND_COLOR: Record<FileKind, string> = {
  pdf: '#e5484d', doc: '#2b6cdf', sheet: '#1f9d55', slides: '#e8590c', text: '#5f6577',
  archive: '#8a6d3b', audio: '#8e4ec6', design: '#d6409f', other: '#5f6577',
}

/** Formatos que el visor de Office Online puede mostrar. */
export const OFFICE_VIEWABLE = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']
export const isOfficeViewable = (name = '') => OFFICE_VIEWABLE.includes(ext(name))
export const isTextLike = (name = '') => ['txt', 'md', 'json', 'xml', 'log', 'yml', 'yaml', 'csv', 'tsv', 'html'].includes(ext(name))
export const isSheetImportable = (name = '') => ['csv', 'tsv', 'xls', 'xlsx', 'ods'].includes(ext(name))
export const extOf = ext

export function fmtSize(n?: number) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const downloadUrl = (src: string, name?: string) =>
  src.includes('/storage/v1/object/public/') ? `${src}?download=${encodeURIComponent(name || '')}` : src

// ---------------------------------------------------------------------------
// Subida a Supabase Storage
// ---------------------------------------------------------------------------

const safeName = (n: string) =>
  n.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'archivo'

export async function uploadBlob(boardId: string, blob: Blob, name: string, contentType?: string): Promise<string> {
  const path = `${boardId}/${nanoid(10)}/${safeName(name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: contentType || blob.type || 'application/octet-stream',
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 })
    img.onerror = () => resolve({ w: 400, h: 300 })
    img.src = src
  })
}

export async function heicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')
  const out = (await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })) as Blob
  return new File([out], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
}

/** Reduce imágenes enormes (como Miro: máx. 8192 px) para que el tablero siga fluido. */
export async function limitImage(file: File, max = 8192): Promise<File> {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale >= 1) {
      bmp.close()
      return file
    }
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

// ---------------------------------------------------------------------------
// PDF (pdf.js, cargado bajo demanda)
// ---------------------------------------------------------------------------

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy
let pdfjsP: Promise<typeof import('pdfjs-dist')> | null = null
const docCache = new Map<string, Promise<PdfDoc>>()

export function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })
  }
  return pdfjsP
}

export function loadPdf(src: string | ArrayBuffer, key?: string): Promise<PdfDoc> {
  const k = key || (typeof src === 'string' ? src : nanoid())
  let p = docCache.get(k)
  if (!p) {
    p = pdfjs().then((lib) => lib.getDocument(typeof src === 'string' ? { url: src } : { data: new Uint8Array(src) }).promise)
    p.catch(() => docCache.delete(k))
    docCache.set(k, p)
  }
  return p
}

export async function renderPdfPage(doc: PdfDoc, n: number, canvas: HTMLCanvasElement, targetWidth: number) {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(4, targetWidth / base.width)
  const viewport = page.getViewport({ scale })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport }).promise
  return { w: base.width, h: base.height }
}

export async function pdfPageBlob(doc: PdfDoc, n: number, width: number) {
  const c = document.createElement('canvas')
  const size = await renderPdfPage(doc, n, c, width)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  return { blob: blob!, ...size }
}

// ---------------------------------------------------------------------------
// Miniaturas y vistas previas de documentos
// ---------------------------------------------------------------------------

/** Office (OOXML) y OpenDocument guardan una portada dentro del zip. */
export async function officeThumbnail(file: File): Promise<Blob | null> {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(file)
    const entry = zip.file(/^docProps\/thumbnail\.(jpe?g|png|emf|wmf)$/i).find((f) => /jpe?g|png$/i.test(f.name)) || zip.file('Thumbnails/thumbnail.png')
    if (!entry) return null
    const data = await entry.async('blob')
    return new Blob([data], { type: /png$/i.test(entry.name) ? 'image/png' : 'image/jpeg' })
  } catch {
    return null
  }
}

/** Texto de muestra para la tarjeta (docx, pptx, txt, csv…). */
export async function textSnippet(file: File): Promise<string> {
  const e = ext(file.name)
  try {
    if (isTextLike(file.name)) return (await file.slice(0, 4000).text()).slice(0, 600)
    if (e === 'docx' || e === 'pptx' || e === 'odt' || e === 'odp') {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(file)
      const files =
        e === 'docx' ? ['word/document.xml'] :
        e === 'pptx' ? Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0])).slice(0, 3) :
        ['content.xml']
      let out = ''
      for (const f of files) {
        const xml = await zip.file(f)?.async('string')
        if (!xml) continue
        out += xml
          .replace(/<\/(w:p|a:p|text:p|text:h)>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        if (out.length > 800) break
      }
      return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, 600)
    }
    if (e === 'xlsx' || e === 'xls' || e === 'ods') {
      const rows = await sheetRows(file, 8)
      return rows.map((r) => r.join('  ·  ')).join('\n').slice(0, 600)
    }
  } catch {
    /* sin vista previa */
  }
  return ''
}

export async function sheetRows(file: Blob, limit = 500): Promise<string[][]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, blankrows: false }) as unknown[][]
  return rows.slice(0, limit).map((r) => r.map((c) => (c == null ? '' : String(c)).trim())).filter((r) => r.some(Boolean))
}

export async function videoPoster(file: Blob): Promise<{ blob: Blob | null; w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    let done = false
    const finish = (blob: Blob | null, w = 640, h = 360) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      resolve({ blob, w, h })
    }
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 4)
    }
    v.onseeked = () => {
      const c = document.createElement('canvas')
      c.width = v.videoWidth || 640
      c.height = v.videoHeight || 360
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
      c.toBlob((b) => finish(b, c.width, c.height), 'image/jpeg', 0.82)
    }
    v.onerror = () => finish(null)
    setTimeout(() => finish(null), 8000)
  })
}

// ---------------------------------------------------------------------------
// URLs: embeds conocidos (iframe) y vista previa de enlaces
// ---------------------------------------------------------------------------

export interface EmbedInfo {
  embed: string
  provider: string
  w: number
  h: number
}

export function embedFor(raw: string): EmbedInfo | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  const path = u.pathname
  const enc = encodeURIComponent(raw)
  let m: RegExpMatchArray | null

  // YouTube
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    let id = ''
    let short = false
    if (host === 'youtu.be') id = path.slice(1)
    else if (u.searchParams.get('v')) id = u.searchParams.get('v')!
    else if ((m = path.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/))) {
      id = m[2]
      short = m[1] === 'shorts'
    }
    if (id) {
      const t = u.searchParams.get('t') || u.searchParams.get('start')
      const start = t ? `?start=${parseInt(t)}` : ''
      return short
        ? { embed: `https://www.youtube.com/embed/${id}`, provider: 'YouTube', w: 360, h: 640 }
        : { embed: `https://www.youtube.com/embed/${id}${start}`, provider: 'YouTube', w: 640, h: 360 }
    }
    if ((m = raw.match(/[?&]list=([\w-]+)/))) return { embed: `https://www.youtube.com/embed/videoseries?list=${m[1]}`, provider: 'YouTube', w: 640, h: 360 }
  }
  if (host === 'vimeo.com' && (m = path.match(/^\/(?:.*\/)?(\d+)(?:\/(\w+))?/)))
    return { embed: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}`, provider: 'Vimeo', w: 640, h: 360 }
  if (host === 'player.vimeo.com') return { embed: raw, provider: 'Vimeo', w: 640, h: 360 }
  if (host === 'loom.com' && (m = path.match(/^\/(share|embed)\/([\w]+)/)))
    return { embed: `https://www.loom.com/embed/${m[2]}`, provider: 'Loom', w: 640, h: 400 }
  if (host === 'figma.com' && /^\/(file|design|proto|board|slides|deck)\//.test(path))
    return { embed: `https://www.figma.com/embed?embed_host=pizarra&url=${enc}`, provider: 'Figma', w: 800, h: 500 }
  if (host === 'open.spotify.com' && (m = path.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/)))
    return { embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, provider: 'Spotify', w: 420, h: m[1] === 'track' || m[1] === 'episode' ? 152 : 380 }
  if (host === 'soundcloud.com' && path.split('/').filter(Boolean).length >= 2)
    return { embed: `https://w.soundcloud.com/player/?url=${enc}&visual=true`, provider: 'SoundCloud', w: 480, h: 300 }
  if (host === 'docs.google.com' && (m = path.match(/^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([\w-]+)/))) {
    const kind = m[1]
    const id = m[3]
    const label = { document: 'Google Docs', spreadsheets: 'Google Sheets', presentation: 'Google Slides', forms: 'Google Forms' }[kind]!
    const embed =
      kind === 'forms' ? `https://docs.google.com/forms/d/${m[2] || ''}${id}/viewform?embedded=true` :
      kind === 'presentation' ? `https://docs.google.com/presentation/d/${m[2] || ''}${id}/${m[2] ? 'pub' : 'preview'}` :
      `https://docs.google.com/${kind}/d/${m[2] || ''}${id}/${m[2] ? 'pubhtml?widget=true' : 'preview'}`
    return { embed, provider: label, w: kind === 'presentation' ? 720 : 640, h: kind === 'presentation' ? 432 : 800 }
  }
  if (host === 'drive.google.com' && (m = path.match(/^\/file\/d\/([\w-]+)/)))
    return { embed: `https://drive.google.com/file/d/${m[1]}/preview`, provider: 'Google Drive', w: 640, h: 480 }
  if ((host === 'google.com' || host.startsWith('google.') || host === 'maps.google.com') && path.startsWith('/maps')) {
    let q = ''
    if ((m = path.match(/\/place\/([^/]+)/))) q = decodeURIComponent(m[1].replace(/\+/g, ' '))
    else if ((m = path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) q = `${m[1]},${m[2]}`
    else q = u.searchParams.get('q') || u.searchParams.get('query') || ''
    if (q) return { embed: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, provider: 'Google Maps', w: 640, h: 440 }
  }
  if (host === 'codepen.io' && (m = path.match(/^\/([\w-]+)\/(?:pen|full|details)\/(\w+)/)))
    return { embed: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, provider: 'CodePen', w: 640, h: 420 }
  if ((host === 'twitter.com' || host === 'x.com') && (m = path.match(/\/status\/(\d+)/)))
    return { embed: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}`, provider: 'X', w: 460, h: 560 }
  if (host === 'tiktok.com' && (m = path.match(/\/video\/(\d+)/)))
    return { embed: `https://www.tiktok.com/embed/v2/${m[1]}`, provider: 'TikTok', w: 340, h: 740 }
  if (host === 'instagram.com' && (m = path.match(/^\/(p|reel|tv)\/([\w-]+)/)))
    return { embed: `https://www.instagram.com/${m[1]}/${m[2]}/embed`, provider: 'Instagram', w: 400, h: 620 }
  if (host === 'canva.com' && /^\/design\/[\w-]+\/[\w-]+\/view/.test(path))
    return { embed: `https://www.canva.com${path}?embed`, provider: 'Canva', w: 720, h: 420 }
  if (host === 'miro.com' && (m = path.match(/^\/app\/board\/([\w=-]+)/)))
    return { embed: `https://miro.com/app/live-embed/${m[1]}/`, provider: 'Miro', w: 720, h: 460 }
  if (host === 'airtable.com' && (m = path.match(/^\/(?:embed\/)?((?:app\w+\/)?shr\w+)/)))
    return { embed: `https://airtable.com/embed/${m[1]}`, provider: 'Airtable', w: 720, h: 520 }
  if (host.endsWith('typeform.com') && path.startsWith('/to/')) return { embed: raw, provider: 'Typeform', w: 640, h: 520 }
  if (host === 'giphy.com' && (m = path.match(/-(\w+)$/))) return { embed: `https://giphy.com/embed/${m[1]}`, provider: 'GIPHY', w: 480, h: 360 }
  if (host === 'excalidraw.com') return { embed: raw, provider: 'Excalidraw', w: 800, h: 500 }
  if (host === 'calendly.com' && path.split('/').filter(Boolean).length) return { embed: `${raw}${raw.includes('?') ? '&' : '?'}embed_type=Inline`, provider: 'Calendly', w: 640, h: 700 }
  return null
}

/** Extrae el src de un código <iframe …> pegado. */
export function iframeSrc(text: string): EmbedInfo | null {
  const m = text.match(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>/i)
  if (!m) return null
  const w = parseInt(text.match(/\swidth=["']?(\d+)/i)?.[1] || '640')
  const h = parseInt(text.match(/\sheight=["']?(\d+)/i)?.[1] || '400')
  let provider = 'Incrustado'
  try {
    provider = new URL(m[1]).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  if (!/^https:/i.test(m[1])) return null
  return { embed: m[1], provider, w: Math.min(Math.max(w, 200), 1200), h: Math.min(Math.max(h, 120), 1200) }
}

export function asUrl(text: string): string | null {
  const t = text.trim()
  if (!t || /\s/.test(t) || t.length > 2048) return null
  const withProto = /^https?:\/\//i.test(t) ? t : /^www\.[^\s]+\.[a-z]{2,}/i.test(t) ? `https://${t}` : null
  if (!withProto) return null
  try {
    const u = new URL(withProto)
    return u.hostname.includes('.') ? u.href : null
  } catch {
    return null
  }
}

export interface Preview {
  kind: 'page' | 'image' | 'video' | 'file'
  url: string
  title?: string
  description?: string
  image?: string
  favicon?: string
  site?: string
  mime?: string
  name?: string
  size?: number
}

export async function fetchPreview(url: string): Promise<Preview> {
  try {
    const r = await fetch(`/api/preview?url=${encodeURIComponent(url)}`)
    if (r.ok) return (await r.json()) as Preview
  } catch {
    /* sin API (desarrollo local) */
  }
  const u = new URL(url)
  const e = ext(u.pathname)
  if (WEB_IMAGES.includes(e)) return { kind: 'image', url }
  if (VIDEO.includes(e)) return { kind: 'video', url }
  if (KIND_BY_EXT[e]) return { kind: 'file', url, name: decodeURIComponent(u.pathname.split('/').pop() || 'archivo') }
  return { kind: 'page', url, title: u.hostname.replace(/^www\./, ''), favicon: `${u.origin}/favicon.ico`, site: u.hostname.replace(/^www\./, '') }
}

/** Descarga un archivo remoto a través del proxy (máx. ~4 MB por límite de Vercel). */
export async function fetchRemoteFile(url: string, fallbackName: string): Promise<File | null> {
  try {
    const r = await fetch(`/api/file?url=${encodeURIComponent(url)}`)
    if (!r.ok) return null
    const blob = await r.blob()
    const cd = r.headers.get('content-disposition') || ''
    const name = decodeURIComponent(cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || fallbackName)
    return new File([blob], name, { type: blob.type })
  } catch {
    return null
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function isMedia(i: Item) {
  return i.type === 'image' || i.type === 'file' || i.type === 'video' || i.type === 'link' || i.type === 'embed'
}

/** Tipos que conservan su proporción al redimensionar. */
export const keepsAspect = (i: Item) => i.type === 'image' || i.type === 'video' || (i.type === 'file' && i.fileKind === 'pdf' && !!i.thumb)
