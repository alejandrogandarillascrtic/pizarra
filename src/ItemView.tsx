import { memo } from 'react'
import type { Item } from './types'
import { autoFont, connectorPoints, darken, isDark, penPath } from './geometry'
import { isMedia } from './media'
import { MediaView } from './MediaView'

interface Props {
  item: Item
  items: Record<string, Item>
  editing: boolean
  hover: boolean
  onText: (text: string, h?: number) => void
  onDone: () => void
}

function TextEditor({ item, onText, onDone }: Pick<Props, 'item' | 'onText' | 'onDone'>) {
  const fs = autoFont(item)
  return (
    <textarea
      className={`editor editor-${item.type}`}
      autoFocus
      defaultValue={item.text || ''}
      style={{ fontSize: fs, color: textColor(item) }}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const el = e.currentTarget
        let h: number | undefined
        if (item.type === 'text') {
          el.style.height = 'auto'
          h = Math.max(item.h, el.scrollHeight)
          el.style.height = ''
        }
        onText(el.value, h)
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          ;(e.currentTarget as HTMLTextAreaElement).blur()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

function textColor(i: Item) {
  if (i.type === 'text') return i.color
  return isDark(i.color) ? '#ffffff' : '#1b1f3b'
}

function Label({ item }: { item: Item }) {
  if (!item.text) return null
  return (
    <div className={`label label-${item.type}`} style={{ fontSize: autoFont(item), color: textColor(item) }}>
      {item.text}
    </div>
  )
}

export const ItemView = memo(function ItemView({ item, items, editing, hover, onText, onDone }: Props) {
  if (isMedia(item)) return <MediaView item={item} hover={hover} />
  const base: React.CSSProperties = { left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z }
  const cls = `item item-${item.type}${hover ? ' hover' : ''}`

  if (item.type === 'connector' && item.from && item.to) {
    const { a, b } = connectorPoints(item, items)
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const s = 14
    const p1 = { x: b.x - s * Math.cos(ang - 0.45), y: b.y - s * Math.sin(ang - 0.45) }
    const p2 = { x: b.x - s * Math.cos(ang + 0.45), y: b.y - s * Math.sin(ang + 0.45) }
    const tip = item.arrow !== false ? { x: b.x - 9 * Math.cos(ang), y: b.y - 9 * Math.sin(ang) } : b
    return (
      <svg className="item item-connector" style={{ zIndex: item.z }} data-kind="connector">
        <line data-id={item.id} className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line x1={a.x} y1={a.y} x2={tip.x} y2={tip.y} stroke={item.color} strokeWidth={item.stroke || 2.5} strokeLinecap="round" />
        {item.arrow !== false && <polygon points={`${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill={item.color} />}
      </svg>
    )
  }

  if (item.type === 'pen') {
    const d = penPath(item.points || [])
    return (
      <svg className="item item-pen" style={{ ...base, overflow: 'visible' }}>
        <path data-id={item.id} className="hit" d={d} />
        <path d={d} stroke={item.color} strokeWidth={item.stroke || 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (item.type === 'frame') {
    return (
      <div className={cls} data-id={item.id} style={{ ...base, background: item.color }}>
        <div className="frame-title" data-id={item.id}>
          {editing ? (
            <input
              autoFocus
              defaultValue={item.text || ''}
              onChange={(e) => onText(e.currentTarget.value)}
              onBlur={onDone}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              }}
            />
          ) : (
            item.text || 'Marco'
          )}
        </div>
      </div>
    )
  }

  const style: React.CSSProperties = { ...base }
  if (item.type === 'sticky') style.background = item.color
  if (item.type === 'rect' || item.type === 'ellipse') {
    style.background = item.color
    style.borderColor = darken(item.color === '#ffffff' ? '#5f6577' : item.color, 0.3)
  }

  return (
    <div className={cls} data-id={item.id} style={style}>
      {item.type === 'diamond' && (
        <svg className="diamond" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points="50,1 99,50 50,99 1,50"
            fill={item.color}
            stroke={darken(item.color === '#ffffff' ? '#5f6577' : item.color, 0.3)}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {editing ? <TextEditor item={item} onText={onText} onDone={onDone} /> : <Label item={item} />}
    </div>
  )
})
