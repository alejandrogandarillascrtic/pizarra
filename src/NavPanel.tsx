import type { NavSettings } from './nav'
import { NAV_DEFAULTS } from './nav'

interface Props {
  value: NavSettings
  onChange: (s: NavSettings) => void
  onClose: () => void
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

export default function NavPanel({ value: s, onChange, onClose }: Props) {
  const set = <K extends keyof NavSettings>(k: K, v: NavSettings[K]) => onChange({ ...s, [k]: v })
  const wheelText =
    s.mode === 'mouse' ? 'La rueda hace zoom. Shift + rueda desplaza en horizontal.' :
    s.mode === 'trackpad' ? 'Dos dedos desplazan el lienzo. Pellizcar (o Ctrl + rueda) hace zoom.' :
    'Detecta solo: con mouse la rueda hace zoom; con trackpad dos dedos desplazan y pellizcar hace zoom.'

  return (
    <div className="nav-panel" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="np-head">
        <strong>Navegación y zoom</strong>
        <button className="ib" onClick={onClose} title="Cerrar">✕</button>
      </div>

      <section>
        <h4>Dispositivo</h4>
        <Seg value={s.mode} onChange={(v) => set('mode', v)} options={[['auto', 'Automático'], ['mouse', 'Mouse'], ['trackpad', 'Trackpad']]} />
        <p className="np-hint">{wheelText}</p>
      </section>

      <section>
        <h4>Zoom con rueda / pellizco</h4>
        <div className="np-row">
          <span>Velocidad</span>
          <input type="range" min={0.25} max={3} step={0.05} value={s.zoomSpeed} onChange={(e) => set('zoomSpeed', Number(e.target.value))} />
          <output>{s.zoomSpeed.toFixed(2)}×</output>
        </div>
        <Check checked={s.invertZoom} onChange={(v) => set('invertZoom', v)}>Invertir dirección del zoom</Check>
        <Check checked={s.invertScroll} onChange={(v) => set('invertScroll', v)}>Invertir dirección del desplazamiento</Check>
        <div className="np-row">
          <span>Límites</span>
          <select value={s.minZoom} onChange={(e) => set('minZoom', Number(e.target.value))}>
            {[1, 2, 5, 10, 25].map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
          <span className="muted">a</span>
          <select value={s.maxZoom} onChange={(e) => set('maxZoom', Number(e.target.value))}>
            {[200, 400, 800, 1600, 3200].map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
      </section>

      <section>
        <h4>Botones de zoom (+ / −)</h4>
        <div className="np-row">
          <span>Cada clic cambia</span>
          <Seg
            value={String(s.buttonStep) as '10'}
            onChange={(v) => set('buttonStep', Number(v))}
            options={[['10', '10%'], ['20', '20%'], ['25', '25%'], ['50', '50%'], ['100', '×2']] as ['10', string][]}
          />
        </div>
        <Check checked={s.plainKeys} onChange={(v) => set('plainKeys', v)}>Teclas + y − hacen zoom (sin Ctrl)</Check>
        <Check checked={s.showZoomBar} onChange={(v) => set('showZoomBar', v)}>Mostrar la barra de zoom</Check>
      </section>

      <section>
        <h4>Mover el lienzo con</h4>
        <Check checked={s.panRight} onChange={(v) => set('panRight', v)}>Botón derecho + arrastrar</Check>
        <Check checked={s.panMiddle} onChange={(v) => set('panMiddle', v)}>Botón central (rueda) + arrastrar</Check>
        <Check checked={s.panSpace} onChange={(v) => set('panSpace', v)}>Espacio + arrastrar</Check>
        <div className="np-row col">
          <span>Botón izquierdo sobre el lienzo vacío</span>
          <Seg value={s.leftDrag} onChange={(v) => set('leftDrag', v)} options={[['select', 'Seleccionar'], ['pan', 'Mover lienzo']]} />
        </div>
        {s.leftDrag === 'pan' && <p className="np-hint">Para seleccionar varios elementos usa Shift + arrastrar.</p>}
      </section>

      <section>
        <h4>Doble clic en el lienzo vacío</h4>
        <Seg value={s.dblClick} onChange={(v) => set('dblClick', v)} options={[['sticky', 'Nueva nota'], ['zoom', 'Acercar'], ['none', 'Nada']]} />
      </section>

      <div className="np-foot">
        <span className="muted small">Se guarda en este navegador.</span>
        <button className="btn" onClick={() => onChange({ ...NAV_DEFAULTS })}>Restablecer</button>
      </div>
    </div>
  )
}
