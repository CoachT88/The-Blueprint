import App from './App.svelte'

const app = new App({
  target: document.getElementById('app'),
})

// Register service worker for PWA (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => {
    console.warn('[CHOP] SW registration failed:', err)
  })
}

export default app
