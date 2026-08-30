/**
 * Applies the stored theme before React renders.
 *
 * This lived as an inline <script> in the HTML, which CSP blocks under
 * `script-src 'self'` — so it silently never ran and the app flashed the wrong
 * theme on every launch. As a module imported first by the entry point it is
 * same-origin, allowed, and still executes before `createRoot` paints.
 */
try {
  const stored = localStorage.getItem('seekr-theme')
  const prefersDark =
    stored === 'dark' ||
    ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.add(prefersDark ? 'dark' : 'light')
} catch {
  // Private mode or blocked storage: fall back to the light palette.
  document.documentElement.classList.add('light')
}
