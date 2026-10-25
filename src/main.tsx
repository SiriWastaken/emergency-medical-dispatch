import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Persist before the window closes. If the save fails, keep the window open once so the user sees why.
if ('__TAURI_INTERNALS__' in window) {
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const win = getCurrentWindow()
    let warned = false
    void win.onCloseRequested(async (e) => {
      await useCase.getState().flush()
      if (useCase.getState().saveState === 'error' && !warned) {
        warned = true
        e.preventDefault()
        useApp.getState().showToast('Unsaved changes could not be saved. Close again to discard them.')
      }
    })
  })
}
