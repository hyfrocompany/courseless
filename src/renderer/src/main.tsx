import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts'
import './index.css'
import App from './App'
import Float from './Float'
import Overlay from './Overlay'
import Record from './Record'

const hash = window.location.hash
const isFloat = hash.startsWith('#/float')
const isOverlay = hash.startsWith('#/overlay')
const isRecord = hash.startsWith('#/record')

// The float window paints its own rounded card over a transparent background.
if (isFloat) document.body.classList.add('is-float')
// The overlay is a full-screen sheet of glass over the desktop.
if (isOverlay) document.body.classList.add('is-overlay')
// The recording pill is the same kind of surface as the float: its own card, transparent window.
if (isRecord) document.body.classList.add('is-float')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOverlay ? <Overlay /> : isRecord ? <Record /> : isFloat ? <Float /> : <App />}
  </StrictMode>
)
