/** Preferencias de navegación (por persona, guardadas en este navegador). */
export interface NavSettings {
  /** auto: detecta mouse o trackpad · mouse: la rueda hace zoom · trackpad: dos dedos mueven, pellizco hace zoom */
  mode: 'auto' | 'mouse' | 'trackpad'
  /** Multiplicador de velocidad del zoom con rueda / pellizco (0.25 – 3) */
  zoomSpeed: number
  /** Invierte la dirección de la rueda al hacer zoom */
  invertZoom: boolean
  /** Invierte la dirección al desplazar con la rueda o el trackpad */
  invertScroll: boolean
  /** Botones del mouse que arrastran el lienzo */
  panMiddle: boolean
  panRight: boolean
  panSpace: boolean
  /** Arrastrar con el botón izquierdo sobre el lienzo vacío */
  leftDrag: 'select' | 'pan'
  /** Paso de los botones + / − y de las teclas (porcentaje) */
  buttonStep: number
  /** Doble clic en el lienzo vacío */
  dblClick: 'sticky' | 'zoom' | 'none'
  /** Zoom con las teclas + y − sin Ctrl */
  plainKeys: boolean
  /** Límites de zoom en % */
  minZoom: number
  maxZoom: number
  /** Mostrar la barra de zoom */
  showZoomBar: boolean
}

export const NAV_DEFAULTS: NavSettings = {
  mode: 'auto',
  zoomSpeed: 1,
  invertZoom: false,
  invertScroll: false,
  panMiddle: true,
  panRight: true,
  panSpace: true,
  leftDrag: 'select',
  buttonStep: 20,
  dblClick: 'sticky',
  plainKeys: true,
  minZoom: 5,
  maxZoom: 800,
  showZoomBar: true,
}

const KEY = 'pizarra-nav'

export function loadNav(): NavSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...NAV_DEFAULTS, ...v }
  } catch {
    return { ...NAV_DEFAULTS }
  }
}

export function saveNav(s: NavSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Detecta si un evento de rueda viene de un mouse con rueda (pasos discretos)
 * o de un trackpad (deltas pequeños, continuos, a menudo con desplazamiento horizontal).
 */
let lastWheelKind: 'mouse' | 'trackpad' = 'mouse'
let lastWheelT = 0
export function wheelKind(e: WheelEvent): 'mouse' | 'trackpad' {
  const now = performance.now()
  // dentro de un mismo gesto conservamos la decisión para que no "salte"
  if (now - lastWheelT < 120) {
    lastWheelT = now
    return lastWheelKind
  }
  lastWheelT = now
  const ay = Math.abs(e.deltaY), ax = Math.abs(e.deltaX)
  let kind: 'mouse' | 'trackpad'
  if (e.deltaMode === 1 || e.deltaMode === 2) kind = 'mouse'
  else if (ax > 0.5) kind = 'trackpad'
  else if (ay >= 40 && Number.isInteger(e.deltaY)) kind = 'mouse'
  else if (ay > 0 && ay < 40) kind = 'trackpad'
  else kind = 'mouse'
  lastWheelKind = kind
  return kind
}

export type WheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }

/** Convierte un evento de rueda en zoom o desplazamiento según la configuración. */
export function interpretWheel(e: WheelEvent, s: NavSettings): WheelAction {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
  const pinch = e.ctrlKey || e.metaKey // pellizco del trackpad o Ctrl + rueda
  const device = s.mode === 'auto' ? wheelKind(e) : s.mode
  const wantsZoom = pinch || (device === 'mouse' && !e.shiftKey)
  if (wantsZoom) {
    // el pellizco entrega deltas pequeños; la rueda, pasos de ~100
    const base = pinch && device !== 'mouse' ? 0.012 : 0.0022
    let dy = e.deltaY * k
    if (s.invertZoom) dy = -dy
    const factor = Math.exp(-dy * base * s.zoomSpeed)
    return { kind: 'zoom', factor: Math.min(1.6, Math.max(0.6, factor)) }
  }
  let dx = e.deltaX * k, dy = e.deltaY * k
  if (e.shiftKey && !dx) {
    dx = dy
    dy = 0
  }
  if (s.invertScroll) {
    dx = -dx
    dy = -dy
  }
  return { kind: 'pan', dx, dy }
}
