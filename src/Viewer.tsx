import { useEffect, useState } from 'react'
import type { Item } from './types'
import { PdfCanvas, useHtmlCode } from './MediaView'
import { HTML_SANDBOX, downloadUrl, fmtSize, isOfficeViewable, isTextLike, loadPdf, extOf } from './media'
import { Icon } from './icons'

export default function Viewer({ item, onClose }: { item: Item; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const src = item.src || item.url || ''
  return (
    <div className="viewer-bg" onPointerDown={onClose}>
      <div className="viewer" onPointerDown={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <strong title={item.name || item.title}>{item.name || item.title || 'Archivo'}</strong>
          {item.size ? <span className="muted small">{fmtSize(item.size)}</span> : null}
          <span style={{ flex: 1 }} />
          {item.src && (
            <a className="btn" href={downloadUrl(item.src, item.name)} target="_blank" rel="noreferrer">
              Descargar
            </a>
          )}
          {src && (
            <a className="btn" href={item.url || item.src} target="_blank" rel="noreferrer">
              Abrir en pestaña ↗
            </a>
          )}
          <button className="ib" onClick={onClose} title="Cerrar (Esc)">✕</button>
        </div>
        <div className="viewer-body">
          <Body item={item} />
        </div>
      </div>
    </div>
  )
}

function Body({ item }: { item: Item }) {
  if (item.type === 'image')
    return (
      <div className="v-img">
        <img src={item.src} alt="" style={{ transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined }} />
      </div>
    )
  if (item.type === 'html') return <HtmlFull item={item} />
  if (item.type === 'video') return <video className="v-video" src={item.src} poster={item.thumb} controls autoPlay />
  if (item.type === 'embed') return <iframe className="v-frame" src={item.embed} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
  if (item.fileKind === 'pdf' && item.src) return <PdfPages src={item.src} start={item.page || 1} />
  if (item.fileKind === 'audio') return <div className="v-center"><audio src={item.src} controls autoPlay /></div>
  if (item.src && isOfficeViewable(item.name)) return <OfficeFrame item={item} />
  if (item.src && isTextLike(item.name)) return <TextView src={item.src} csv={['csv', 'tsv'].includes(extOf(item.name || ''))} />
  return (
    <div className="v-center">
      <p>No hay vista previa para este tipo de archivo.</p>
      {item.src && <a className="btn primary" href={downloadUrl(item.src, item.name)}>Descargar {item.name}</a>}
    </div>
  )
}

function OfficeFrame({ item }: { item: Item }) {
  const [loaded, setLoaded] = useState(false)
  const url = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(item.src!)}`
  return (
    <div className="v-office">
      {!loaded && (
        <div className="v-loading">
          <span className="spinner" /> Abriendo vista previa…
          {item.snippet && <pre className="snippet">{item.snippet}</pre>}
        </div>
      )}
      <iframe className="v-frame" src={url} onLoad={() => setLoaded(true)} title={item.name} />
    </div>
  )
}

function PdfPages({ src, start }: { src: string; start: number }) {
  const [n, setN] = useState(0)
  const [err, setErr] = useState(false)
  useEffect(() => {
    loadPdf(src).then((d) => setN(d.numPages)).catch(() => setErr(true))
  }, [src])
  useEffect(() => {
    if (n && start > 1) setTimeout(() => document.getElementById(`pdfp-${start}`)?.scrollIntoView(), 50)
  }, [n, start])
  if (err) return <div className="v-center">No se pudo abrir el PDF.</div>
  if (!n) return <div className="v-center"><span className="spinner" /></div>
  return (
    <div className="v-pdf">
      {Array.from({ length: Math.min(n, 300) }, (_, k) => (
        <LazyPage key={k} src={src} page={k + 1} />
      ))}
    </div>
  )
}

function LazyPage({ src, page }: { src: string; page: number }) {
  const [show, setShow] = useState(page <= 2)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!el || show) return
    const io = new IntersectionObserver((es) => es[0].isIntersecting && setShow(true), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [el, show])
  return (
    <div ref={setEl} id={`pdfp-${page}`} className="v-page">
      {show ? <PdfCanvas src={src} page={page} width={900} /> : <div className="v-page-ph" />}
      <span className="v-pnum">{page}</span>
    </div>
  )
}

function TextView({ src, csv }: { src: string; csv: boolean }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    fetch(src)
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 400_000)))
      .catch(() => setText('No se pudo cargar el archivo.'))
  }, [src])
  if (text === null) return <div className="v-center"><span className="spinner" /></div>
  if (csv) {
    const sep = text.includes('\t') && !text.includes(',') ? '\t' : text.split('\n')[0].includes(';') ? ';' : ','
    const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 2000).map((l) => l.split(sep))
    return (
      <div className="v-table">
        <table>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k}>{r.map((c, j) => (k === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <pre className="v-text">{text}</pre>
}

export function UrlDialog({ onSubmit, onClose }: { onSubmit: (url: string) => void; onClose: () => void }) {
  const [v, setV] = useState('')
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <form
        className="modal"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (v.trim()) onSubmit(v.trim())
        }}
      >
        <h3><Icon name="link" /> Insertar desde una URL</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Pega un enlace a una página, imagen, PDF, documento o video. YouTube, Vimeo, Loom, Figma, Google Docs/Sheets/Slides/Maps,
          Spotify, X, TikTok, Instagram, Canva, CodePen y más se incrustan para verse en el tablero. También puedes pegar un código
          &lt;iframe&gt;.
        </p>
        <input
          autoFocus
          className="url-input"
          placeholder="https://…"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!v.trim()}>Insertar</button>
        </div>
      </form>
    </div>
  )
}

function HtmlFull({ item }: { item: Item }) {
  const code = useHtmlCode(item)
  if (code == null) return <div className="v-center"><span className="spinner" /></div>
  return <iframe className="v-frame" srcDoc={code} sandbox={HTML_SANDBOX} title={item.title || 'HTML'} />
}

const HTML_STARTER = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Mi página</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh;
           background: linear-gradient(135deg, #e6ecff, #fff3c4); color: #1b1f3b; }
    button { font: inherit; padding: 10px 18px; border-radius: 10px; border: 0; background: #3e63dd; color: #fff; cursor: pointer; }
  </style>
</head>
<body>
  <main style="text-align:center">
    <h1>Hola equipo 👋</h1>
    <p>Este HTML corre dentro del tablero.</p>
    <button onclick="this.textContent = 'Clics: ' + (++window.n || (window.n = 1))">Haz clic</button>
  </main>
</body>
</html>`

/** Editor de código HTML con vista previa en vivo (aislada). */
export function HtmlDialog({ initial, title, onSave, onClose }: { initial?: string; title: string; onSave: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState(initial ?? HTML_STARTER)
  const [preview, setPreview] = useState(code)
  useEffect(() => {
    const t = setTimeout(() => setPreview(code), 350)
    return () => clearTimeout(t)
  }, [code])
  return (
    <div className="viewer-bg" onPointerDown={onClose}>
      <div className="viewer html-editor" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <strong><Icon name="code" /> {title}</strong>
          <span className="muted small">{(code.length / 1024).toFixed(1)} KB</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!code.trim()} onClick={() => onSave(code)}>Guardar en el tablero</button>
        </div>
        <div className="html-split">
          <textarea
            className="code"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const a = el.selectionStart, b = el.selectionEnd
                const next = code.slice(0, a) + '  ' + code.slice(b)
                setCode(next)
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
              }
              if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSave(code)
              }
            }}
          />
          <iframe className="html-preview" srcDoc={preview} sandbox={HTML_SANDBOX} title="Vista previa" />
        </div>
      </div>
    </div>
  )
}
