# Pizarra

Whiteboard colaborativo en tiempo real, open source (MIT). Un lienzo infinito para equipos: notas adhesivas, formas, texto, conectores, marcos y lápiz, con cursores en vivo. Sin cuentas: se comparte con un enlace.

## Funciones

- **Lienzo infinito** con zoom (Ctrl + rueda / pellizco) y desplazamiento (rueda, dos dedos, espacio + arrastrar, herramienta mano).
- **Notas adhesivas** con 8 colores y texto que se ajusta solo al tamaño.
- **Formas**: rectángulo, círculo y rombo con texto.
- **Texto libre**, **marcos** (al mover un marco se mueve su contenido) y **lápiz** a mano alzada.
- **Conectores** que se anclan a los objetos y los siguen al moverlos.
- **Multijugador**: cambios en vivo, cursores con nombre y avatares de quién está conectado.
- Selección múltiple, redimensionar, duplicar, traer al frente / enviar atrás, deshacer / rehacer.
- Copiar y pegar entre tableros; pegar texto crea una nota por línea.
- **Plantillas**: lluvia de ideas, retrospectiva, kanban y diagrama de flujo.
- Exportar / importar el tablero en JSON.
- Funciona en móvil y tablet.

Atajos: pulsa `?` dentro de un tablero.

## Stack

- React 18 + TypeScript + Vite (sin librerías de canvas: DOM + SVG propios).
- [Supabase](https://supabase.com): Postgres para guardar los tableros y Realtime (broadcast + presence) para la colaboración.
- Desplegado en Vercel.

## Desarrollo local

```bash
npm install
npm run dev
```

Por defecto usa el proyecto Supabase del equipo. Para usar el tuyo, copia `.env.example` a `.env` y ejecuta `supabase/schema.sql` en tu proyecto.

## Modelo de datos

- `boards (id uuid, name, created_at, updated_at)`
- `items (id text, board_id → boards, data jsonb, updated_at)` — cada objeto del tablero es una fila; `data` guarda su tipo, posición, tamaño, color, texto, etc.

La sincronización es *last-write-wins* por objeto: los cambios se difunden al instante por un canal Realtime y se guardan en Postgres con un pequeño retardo.

## Seguridad

Acceso por enlace: quien conoce el UUID de un tablero puede verlo y editarlo. Es ideal para equipos internos; para datos sensibles conviene agregar Supabase Auth y políticas RLS por usuario.

## Origen

Pizarra replica funciones públicas y observables de las pizarras colaborativas (como Miro) con código 100% propio. No contiene código, diseños ni marcas de Miro y no está afiliado a Miro.
