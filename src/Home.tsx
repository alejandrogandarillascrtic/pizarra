import { useState } from 'react'
import { supabase } from './supabase'
import { TEMPLATES } from './templates'
import { forgetBoard, recentBoards } from './recent'
import { Icon } from './icons'

function ago(ts: number) {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  return `hace ${Math.floor(s / 86400)} d`
}

export default function Home() {
  const [busy, setBusy] = useState<string | null>(null)
  const [recent, setRecent] = useState(recentBoards())
  const [link, setLink] = useState('')
  const [err, setErr] = useState('')

  const create = async (tplId: string) => {
    setBusy(tplId)
    setErr('')
    try {
      const tpl = TEMPLATES.find((t) => t.id === tplId)!
      const { data, error } = await supabase
        .from('boards')
        .insert({ name: tplId === 'blank' ? 'Tablero sin título' : tpl.name })
        .select('id')
        .single()
      if (error) throw error
      const items = tpl.build()
      if (items.length) {
        const { error: e2 } = await supabase.from('items').insert(items.map((d) => ({ id: d.id, board_id: data.id, data: d })))
        if (e2) throw e2
      }
      location.href = `/b/${data.id}`
    } catch (e) {
      console.error(e)
      setErr('No se pudo crear el tablero. Revisa tu conexión.')
      setBusy(null)
    }
  }

  const open = (e: React.FormEvent) => {
    e.preventDefault()
    const m = link.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    if (m) location.href = `/b/${m[0]}`
    else setErr('Ese enlace no parece de un tablero de Pizarra.')
  }

  return (
    <div className="home">
      <header>
        <span className="logo"><img src="/favicon.svg" alt="" />Pizarra</span>
        <a className="gh" href="https://github.com/alejandrogandarillascrtic/pizarra" target="_blank" rel="noreferrer">Código abierto · MIT ↗</a>
      </header>

      <section className="hero">
        <h1>Piensa en grande,<br /><span>juntos.</span></h1>
        <p>Un tablero infinito para tu equipo: notas adhesivas, formas, conectores, marcos y lápiz, con cursores en vivo. Sin cuentas: comparte el enlace y listo.</p>
      </section>

      <section>
        <h2>Crear un tablero</h2>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className={`tpl tpl-${t.id}`} onClick={() => create(t.id)} disabled={!!busy}>
              <div className="tpl-art">{t.id === 'blank' ? <Icon name="plus" size={34} /> : <TplArt id={t.id} />}</div>
              <strong>{busy === t.id ? 'Creando…' : t.name}</strong>
              <small>{t.desc}</small>
            </button>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
      </section>

      <section className="two">
        <div>
          <h2>Tus tableros recientes</h2>
          {recent.length === 0 ? (
            <p className="muted">Aún no abres ningún tablero en este navegador.</p>
          ) : (
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <a href={`/b/${r.id}`}>
                    <span className="dot" />
                    <span className="rn">{r.name}</span>
                    <span className="muted">{ago(r.ts)}</span>
                  </a>
                  <button
                    className="x"
                    title="Quitar de la lista"
                    onClick={() => {
                      forgetBoard(r.id)
                      setRecent(recentBoards())
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2>Abrir con un enlace</h2>
          <form className="open" onSubmit={open}>
            <input placeholder="Pega el enlace que te compartieron" value={link} onChange={(e) => setLink(e.target.value)} />
            <button className="btn">Abrir</button>
          </form>
          <p className="muted small">Cualquiera con el enlace puede ver y editar el tablero.</p>
        </div>
      </section>
      <footer className="muted small">Pizarra es software libre (MIT). Inspirado en las pizarras colaborativas; no está afiliado a Miro.</footer>
    </div>
  )
}

function TplArt({ id }: { id: string }) {
  if (id === 'brainstorm')
    return (
      <svg viewBox="0 0 120 70"><circle cx="60" cy="35" r="13" fill="#1b1f3b" />{[0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2; const x = 60 + Math.cos(a) * 40, y = 35 + Math.sin(a) * 24; return <g key={k}><line x1="60" y1="35" x2={x} y2={y} stroke="#9aa0b0" /><rect x={x - 7} y={y - 7} width="14" height="14" rx="2" fill={['#fff176', '#ffcc80', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#d1c4e9'][k]} /></g> })}</svg>
    )
  if (id === 'retro')
    return <svg viewBox="0 0 120 70">{['#e8f5e9', '#fff8e1', '#e3f2fd'].map((c, k) => <g key={k}><rect x={6 + k * 38} y="6" width="32" height="58" rx="3" fill={c} stroke="#d0d4dc" /><rect x={11 + k * 38} y="14" width="10" height="10" fill={['#c5e1a5', '#ffcc80', '#b3e5fc'][k]} /></g>)}</svg>
  if (id === 'kanban')
    return <svg viewBox="0 0 120 70">{[0, 1, 2, 3].map((k) => <g key={k}><rect x={5 + k * 28.5} y="6" width="25" height="58" rx="3" fill="#f4f5f7" stroke="#d0d4dc" />{k < 3 && <rect x={9 + k * 28.5} y="14" width="17" height="11" rx="1.5" fill={['#fff176', '#b3e5fc', '#ffcc80'][k]} />}</g>)}</svg>
  return (
    <svg viewBox="0 0 120 70"><ellipse cx="60" cy="10" rx="14" ry="6" fill="#c8efc0" /><rect x="47" y="22" width="26" height="12" rx="2" fill="#fff" stroke="#9aa0b0" /><path d="M60 40l11 9-11 9-11-9z" fill="#fff3b0" /><line x1="60" y1="16" x2="60" y2="22" stroke="#1b1f3b" /><line x1="60" y1="34" x2="60" y2="40" stroke="#1b1f3b" /></svg>
  )
}
