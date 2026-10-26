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

### Archivos, imágenes y enlaces (como en Miro)

Se pueden **arrastrar y soltar**, **pegar** (Ctrl+V) o subir desde el botón **Subir** (`U`):

| Tipo | Formatos | En el tablero |
|---|---|---|
| Imágenes | JPG, PNG, GIF (animado), WebP, SVG, BMP, AVIF, **HEIC/HEIF** (se convierte a JPG) | Imagen redimensionable con proporción fija, rotar 90°, visor a pantalla completa |
| PDF | PDF de cualquier tamaño | Tarjeta con la portada y **paginador** compartido (‹ 1/12 ›), visor de todas las páginas y **Extraer páginas** como imágenes |
| Documentos | DOC, DOCX, ODT, RTF | Tarjeta con el texto del documento; visor con Office Online |
| Hojas de cálculo | XLS, XLSX, ODS, CSV, TSV | Vista previa de filas, visor y **A notas** (una nota por fila) |
| Presentaciones | PPT, PPTX, ODP | Portada de la primera diapositiva y visor con Office Online |
| Video | MP4, MOV, WebM | Fotograma de portada; doble clic para reproducir en el tablero |
| Audio | MP3, WAV, M4A, OGG… | Reproductor en la tarjeta |
| Otros | ZIP, PSD, AI, TXT, JSON… | Tarjeta de archivo con descarga |
| Enlaces | Cualquier URL | **Tarjeta con imagen, título y descripción** (Open Graph) |
| Incrustados | YouTube, Vimeo, Loom, Figma, Google Docs/Sheets/Slides/Forms/Drive/Maps, Spotify, SoundCloud, X, TikTok, Instagram, Canva, CodePen, Miro, Airtable, Typeform, GIPHY, Calendly y código `<iframe>` | Contenido vivo; doble clic para interactuar |

También: pegar capturas de pantalla, arrastrar imágenes desde otra pestaña, tomar fotos con la cámara del teléfono e insertar archivos desde una URL. Límite: 50 MB por archivo.
- Funciona en móvil y tablet.

Atajos: pulsa `?` dentro de un tablero.

## Stack

- React 18 + TypeScript + Vite (sin librerías de canvas: DOM + SVG propios).
- [Supabase](https://supabase.com): Postgres para guardar los tableros, Storage para los archivos y Realtime (broadcast + presence) para la colaboración.
- Funciones de Vercel (`api/`): vista previa de enlaces (`/api/preview`) y descarga de archivos remotos (`/api/file`), ambas con protección contra accesos a redes internas (SSRF).
- pdf.js (PDF), JSZip (portadas y texto de Office), SheetJS (hojas de cálculo) y heic2any (fotos de iPhone), cargados solo cuando se necesitan.
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
