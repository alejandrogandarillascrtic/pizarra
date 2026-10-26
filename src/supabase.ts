import { createClient } from '@supabase/supabase-js'

// Clave publicable (segura para el navegador). Se puede sobreescribir con variables de entorno.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://grukslyzfmnrgplkqyxf.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_rFGzMplKbe6zQ1BQ-6dAWQ__OOjoQkc'

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 40 } },
})
