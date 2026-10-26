// Vista previa de enlaces: lee Open Graph / Twitter Cards / <title> / favicon.
// Valida el destino contra direcciones internas en cada redirección.
import { lookup } from 'node:dns/promises'
import net from 'node:net'

const UA = 'Mozilla/5.0 (compatible; PizarraBot/1.0; +https://pizarra-pi.vercel.app)'

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    )
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7))
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff')
}

async function assertPublic(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo no permitido')
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('puerto no permitido')
  if (u.username || u.password) throw new Error('credenciales no permitidas')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('host no permitido')
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('host no permitido')
}

/** fetch que valida cada salto de redirección contra direcciones internas (SSRF). */
async function safeFetch(raw: string, accept: string, timeoutMs = 8000): Promise<{ res: Response; url: string }> {
  let url = raw
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (let hop = 0; hop < 5; hop++) {
      const u = new URL(url)
      await assertPublic(u)
      const res = await fetch(u, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': UA, accept, 'accept-language': 'es,en;q=0.8' },
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, u).href
        continue
      }
      return { res, url }
    }
    throw new Error('demasiadas redirecciones')
  } finally {
    clearTimeout(timer)
  }
}

async function readLimited(res: Response, max: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}


function decode(s: string) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ').trim()
}

function meta(html: string, keys: string[]): string | undefined {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i')
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${k}["']`, 'i')
    const m = html.match(re1) || html.match(re2)
    if (m && m[1].trim()) return decode(m[1])
  }
  return undefined
}

function abs(u: string | undefined, base: string) {
  if (!u) return undefined
  try {
    const r = new URL(u, base)
    return r.protocol === 'http:' || r.protocol === 'https:' ? r.href : undefined
  } catch {
    return undefined
  }
}

export default async function handler(req: any, res: any) {
  const raw = String(req.query?.url || '')
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return res.status(400).json({ error: 'url inválida' })
  }
  try {
    const { res: r, url } = await safeFetch(target.href, 'text/html,application/xhtml+xml,*/*;q=0.8')
    const type = (r.headers.get('content-type') || '').toLowerCase()
    const len = Number(r.headers.get('content-length') || 0) || undefined
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || undefined
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    if (type.startsWith('image/')) {
      r.body?.cancel()
      return res.json({ kind: 'image', url, mime: type.split(';')[0], name, size: len })
    }
    if (type.startsWith('video/')) {
      r.body?.cancel()
      return res.json({ kind: 'video', url, mime: type.split(';')[0], name, size: len })
    }
    if (!type.includes('html') && !type.includes('xml') && type && !type.startsWith('text/plain')) {
      r.body?.cancel()
      const cd = r.headers.get('content-disposition') || ''
      const fn = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1]
      return res.json({ kind: 'file', url, mime: type.split(';')[0], name: fn ? decodeURIComponent(fn) : name, size: len })
    }
    const buf = await readLimited(r, 1_500_000)
    const html = buf ? new TextDecoder('utf-8').decode(buf) : ''
    const head = html.slice(0, 600_000)
    const title = meta(head, ['og:title', 'twitter:title']) || decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '') || new URL(url).hostname
    const description = meta(head, ['og:description', 'twitter:description', 'description'])
    const image = abs(meta(head, ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image']), url)
    const site = meta(head, ['og:site_name', 'application-name']) || new URL(url).hostname.replace(/^www\./, '')
    const iconHref =
      head.match(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1] ||
      head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/i)?.[1]
    const favicon = abs(iconHref, url) || abs('/favicon.ico', url)
    return res.json({ kind: 'page', url, title: title.slice(0, 300), description: description?.slice(0, 500), image, favicon, site })
  } catch (e: any) {
    return res.status(422).json({ error: String(e?.message || e) })
  }
}
