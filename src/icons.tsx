const P: Record<string, React.ReactNode> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  hand: <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-5.5a1.5 1.5 0 013 0V13m-9-1.5a1.5 1.5 0 00-3 0V14a7 7 0 007 7h1a6 6 0 006-6v-4.5a1.5 1.5 0 00-3 0" />,
  sticky: <><path d="M5 4h14v10l-5 6H5z" /><path d="M14 20v-6h5" /></>,
  text: <><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  rect: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <circle cx="12" cy="12" r="8" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  connector: <><path d="M5 19L19 5" /><path d="M11 5h8v8" /></>,
  pen: <><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="M14 7l3 3" /></>,
  frame: <><path d="M7 3v18M17 3v18M3 7h18M3 17h18" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>,
  front: <><rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" /><path d="M4 16V5a1 1 0 011-1h11" /></>,
  back: <><rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" /><path d="M20 8v11a1 1 0 01-1 1H8" /></>,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></>,
  dots: <><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name]}
    </svg>
  )
}
