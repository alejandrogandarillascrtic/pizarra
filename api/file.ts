// Proxy de descarga para "insertar desde URL": trae archivos públicos (máx. 4 MB,
// límite de respuesta de Vercel) para subirlos al tablero. Bloquea destinos internos.
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


const MAX = 4 * 1024 * 1024

export default async function handler(req: any, res: any) {
  const raw = String(req.query?.url || '')
  try {
    new URL(raw)
  } catch {
    return res.status(400).json({ error: 'url inválida' })
  }
  try {
    const { res: r, url } = await safeFetch(raw, '*/*', 15000)
    if (!r.ok) return res.status(502).json({ error: `origen respondió ${r.status}` })
    const len = Number(r.headers.get('content-length') || 0)
    if (len > MAX) {
      r.body?.cancel()
      return res.status(413).json({ error: 'archivo demasiado grande' })
    }
    const type = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0]
    if (type.includes('html')) {
      r.body?.cancel()
      return res.status(415).json({ error: 'es una página, no un archivo' })
    }
    const buf = await readLimited(r, MAX)
    if (!buf) return res.status(413).json({ error: 'archivo demasiado grande' })
    const cd = r.headers.get('content-disposition') || ''
    const name = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || new URL(url).pathname.split('/').pop() || 'archivo'
    res.setHeader('content-type', type)
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(decodeURIComponent(name))}`)
    res.setHeader('cache-control', 'public, s-maxage=3600')
    res.setHeader('x-content-type-options', 'nosniff')
    return res.status(200).send(Buffer.from(buf))
  } catch (e: any) {
    return res.status(422).json({ error: String(e?.message || e) })
  }
}
