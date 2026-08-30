// Must be first: applies the theme class before anything renders.
import './lib/theme-boot'
import React from 'react'
import ReactDOM from 'react-dom/client'
import Overlay from './OverlayApp'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
)
