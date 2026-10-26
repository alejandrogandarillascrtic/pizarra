import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Board from './Board'
import Home from './Home'
import { loadMe, saveMe } from './recent'
import type { Me } from './types'
import './styles.css'

function App() {
  const [me, setMeState] = useState<Me>(loadMe)
  const setMe = (m: Me) => {
    saveMe(m)
    setMeState(m)
  }
  const m = location.pathname.match(/^\/b\/([^/]+)/)
  if (m) return <Board boardId={decodeURIComponent(m[1])} me={me} setMe={setMe} />
  return <Home />
}

createRoot(document.getElementById('root')!).render(
  <App />,
)
