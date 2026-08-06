// A ~60 line hash router. No dependency, no context — the hash IS the app's location, so the
// browser's own history stack gives us back / forward (and the mouse back button) for free.

import { useEffect, useMemo, useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'generating' }
  | { name: 'settings' }
  | { name: 'lesson'; id: string }
  | { name: 'run'; id: string }
  | { name: 'review'; id: string }
  | { name: 'edit'; id: string }

export const HOME: Route = { name: 'home' }

export function toHash(r: Route): string {
  switch (r.name) {
    case 'lesson':
      return `#/lesson/${r.id}`
    case 'run':
      return `#/run/${r.id}`
    case 'review':
      return `#/review/${r.id}`
    case 'edit':
      return `#/edit/${r.id}`
    default:
      return `#/${r.name}`
  }
}

export function parseHash(raw: string): Route {
  const h = raw.replace(/^#\/?/, '')
  const [head, ...rest] = h.split('/')
  const id = rest.join('/')
  switch (head) {
    case 'library':
      return { name: 'library' }
    case 'generating':
      return { name: 'generating' }
    case 'settings':
      return { name: 'settings' }
    case 'lesson':
      return id ? { name: 'lesson', id } : HOME
    case 'run':
      return id ? { name: 'run', id } : HOME
    case 'review':
      return id ? { name: 'review', id } : HOME
    case 'edit':
      return id ? { name: 'edit', id } : HOME
    default:
      return HOME
  }
}

/** Push (or replace) a route. Assigning location.hash is what creates the history entry. */
export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = toHash(r)
  if (window.location.hash === hash) return
  if (opts.replace) window.history.replaceState(null, '', hash)
  else window.location.hash = hash
  // replaceState does not fire hashchange — tell the store ourselves.
  if (opts.replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

function snapshot(): string {
  return window.location.hash || '#/home'
}

/** The current route, re-rendered on every hashchange (including history back/forward).
 *  Identity is stable per hash, and an unparseable hash is rewritten to the route it renders. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, snapshot)
  const route = useMemo(() => parseHash(hash), [hash])
  useEffect(() => {
    const canonical = toHash(route)
    if (hash !== canonical) window.history.replaceState(null, '', canonical)
  }, [hash, route])
  return route
}

/** Where "back" goes from here — used by Esc and by the breadcrumb. */
export function parentOf(r: Route): Route {
  switch (r.name) {
    case 'library':
    case 'settings':
    case 'generating':
      return HOME
    case 'lesson':
      return { name: 'library' }
    case 'run':
    case 'review':
    case 'edit':
      return { name: 'lesson', id: r.id }
    default:
      return HOME
  }
}
