import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Item } from './types'
import { KIND_COLOR, KIND_LABEL, extOf, fmtSize, hostOf, loadPdf, renderPdfPage } from './media'

export interface MediaApi {
  activeId: string | null
  setPage: (id: string, page: number) => void
}
export const MediaCtx = createContext<MediaApi>({ activeId: null, setPage: () => {} })

const style = (i: Item): React.CSSProperties => ({ left: i.x, top: i.y, width: i.w, height: i.h, zIndex: i.z })

function Uploading() {
  return (
    <div className="uploading">
      <span className="spinner" />
      Subiendo…
    </div>
  )
}

export function MediaView({ item, hover }: { item: Item; hover: boolean }) {
  const cls = `item item-${item.type}${hover ? ' hover' : ''}`
  switch (item.type) {
    case 'image':
      return (
        <div className={cls} data-id={item.id} style={style(item)}>
          <RotatedImage item={item} />
          {item.uploading && <Uploading />}
        </div>
      )
    case 'video':
      return <VideoView item={item} cls={cls} />
    case 'embed':
      return <EmbedView item={item} cls={cls} />
    case 'link':
      return <LinkView item={item} cls={cls} />
    case 'file':
      return item.fileKind === 'pdf' ? <PdfView item={item} cls={cls} /> : <FileView item={item} cls={cls} />
    default:
      return null
  }
}

function RotatedImage({ item }: { item: Item }) {
  const r = ((item.rotation || 0) % 360 + 360) % 360
  const sideways = r === 90 || r === 270
  const st: React.CSSProperties = sideways
    ? { width: item.h, height: item.w, left: (item.w - item.h) / 2, top: (item.h - item.w) / 2, transform: `rotate(${r}deg)` }
    : { width: '100%', height: '100%', left: 0, top: 0, transform: r ? `rotate(${r}deg)` : undefined }
  return <img className="media-img" src={item.src} alt={item.name || ''} draggable={false} decoding="async" style={st} />
}

function VideoView({ item, cls }: { item: Item; cls: string }) {
  const { activeId } = useContext(MediaCtx)
  const active = activeId === item.id
  return (
    <div className={`${cls}${active ? ' active' : ''}`} data-id={active ? undefined : item.id} style={style(item)}>
      {item.src && (
        <video
          className="media-video"
          src={item.src}
          poster={item.thumb}
          preload="metadata"
          controls={active}
          autoPlay={active}
          playsInline
        />
      )}
      {!active && !item.uploading && (
        <div className="play-overlay" data-id={item.id}>
          <span className="play-btn">▶</span>
          <span className="hint">Doble clic para reproducir</span>
        </div>
      )}
      {active && <div className="drag-bar" data-id={item.id}>⠿ {item.name}</div>}
      {item.uploading && <Uploading />}
    </div>
  )
}

function EmbedView({ item, cls }: { item: Item; cls: string }) {
  const { activeId } = useContext(MediaCtx)
  const active = activeId === item.id
  return (
    <div className={`${cls}${active ? ' active' : ''}`} style={style(item)}>
      <div className="embed-head" data-id={item.id}>
        {item.favicon && <img src={item.favicon} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        <span className="prov">{item.provider}</span>
        <span className="t">{item.title || hostOf(item.url || '')}</span>
      </div>
      <div className="embed-body">
        <iframe
          src={item.embed}
          title={item.title || item.provider}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ pointerEvents: active ? 'auto' : 'none' }}
        />
        {!active && (
          <div className="embed-cover" data-id={item.id}>
            <span className="hint">Doble clic para interactuar</span>
          </div>
        )}
      </div>
    </div>
  )
}

function LinkView({ item, cls }: { item: Item; cls: string }) {
  const [imgOk, setImgOk] = useState(true)
  const host = hostOf(item.url || '')
  return (
    <div className={cls} data-id={item.id} style={style(item)}>
      {item.thumb && imgOk && (
        <div className="link-img">
          <img src={item.thumb} alt="" draggable={false} onError={() => setImgOk(false)} />
        </div>
      )}
      <div className="link-body">
        <div className="link-title">{item.title || host}</div>
        {item.desc && <div className="link-desc">{item.desc}</div>}
        <div className="link-host">
          {item.favicon && <img src={item.favicon} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
          <span>{host}</span>
        </div>
      </div>
      {item.uploading && <Uploading />}
    </div>
  )
}

function Badge({ item }: { item: Item }) {
  const kind = item.fileKind || 'other'
  const e = extOf(item.name || '').slice(0, 4).toUpperCase() || KIND_LABEL[kind]
  return (
    <span className="badge" style={{ background: KIND_COLOR[kind] }}>
      {e}
    </span>
  )
}

function FileFoot({ item, extra }: { item: Item; extra?: React.ReactNode }) {
  return (
    <div className="file-foot">
      <Badge item={item} />
      <div className="file-meta">
        <div className="file-name" title={item.name}>{item.name}</div>
        <div className="file-sub">
          {KIND_LABEL[item.fileKind || 'other']}
          {item.size ? ` · ${fmtSize(item.size)}` : ''}
        </div>
      </div>
      {extra}
    </div>
  )
}

function FileView({ item, cls }: { item: Item; cls: string }) {
  const { activeId } = useContext(MediaCtx)
  const kind = item.fileKind || 'other'
  return (
    <div className={`${cls} file-${kind}`} data-id={item.id} style={style(item)}>
      <div className="file-preview" data-id={item.id}>
        {item.thumb ? (
          <img src={item.thumb} alt="" draggable={false} />
        ) : item.snippet ? (
          <pre className={`snippet${kind === 'sheet' ? ' sheet' : ''}`}>{item.snippet}</pre>
        ) : (
          <div className="file-icon" style={{ color: KIND_COLOR[kind] }}>
            <FileGlyph />
            <span>{extOf(item.name || '').toUpperCase()}</span>
          </div>
        )}
        {kind === 'audio' && item.src && (
          <audio className={`ctl audio${activeId === item.id ? ' on' : ''}`} src={item.src} controls preload="none" />
        )}
      </div>
      <FileFoot item={item} />
      {item.uploading && <Uploading />}
    </div>
  )
}

function PdfView({ item, cls }: { item: Item; cls: string }) {
  const { setPage } = useContext(MediaCtx)
  const page = item.page || 1
  const pages = item.pages || 1
  const go = (d: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setPage(item.id, Math.min(pages, Math.max(1, page + d)))
  }
  return (
    <div className={`${cls} file-pdf`} data-id={item.id} style={style(item)}>
      <div className="file-preview pdf" data-id={item.id}>
        {page === 1 && item.thumb ? (
          <img src={item.thumb} alt="" draggable={false} />
        ) : item.src && !item.uploading ? (
          <PdfCanvas src={item.src} page={page} width={item.w} />
        ) : null}
      </div>
      <FileFoot
        item={item}
        extra={
          pages > 1 ? (
            <div className="pager ctl">
              <button className="ctl" disabled={page <= 1} onClick={go(-1)} onDoubleClick={(e) => e.stopPropagation()} title="Página anterior">‹</button>
              <span>{page}/{pages}</span>
              <button className="ctl" disabled={page >= pages} onClick={go(1)} onDoubleClick={(e) => e.stopPropagation()} title="Página siguiente">›</button>
            </div>
          ) : null
        }
      />
      {item.uploading && <Uploading />}
    </div>
  )
}

export function PdfCanvas({ src, page, width }: { src: string; page: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    setErr(false)
    loadPdf(src)
      .then(async (doc) => {
        if (alive && ref.current) await renderPdfPage(doc, page, ref.current, Math.min(1800, width * (window.devicePixelRatio || 1) * 1.5))
      })
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [src, page, width])
  if (err) return <div className="pdf-err">No se pudo mostrar esta página</div>
  return <canvas ref={ref} className="pdf-canvas" />
}

function FileGlyph() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M6 2.5h8l4.5 4.5v14.5H6z" />
      <path d="M14 2.5V7h4.5" />
    </svg>
  )
}
