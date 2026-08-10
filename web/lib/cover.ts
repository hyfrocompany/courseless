// Ported verbatim from the app: src/renderer/src/lib/cover.ts.
// The covers on this page are the same art the library shows, from the same seeds.

/** Small, fast, deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type ShapeKind = 'orb' | 'ring' | 'arcs' | 'stripes' | 'wedge' | 'grid'

export interface CoverSpec {
  gradient: string
  shape: ShapeKind
  cx: number
  cy: number
  scale: number
  rotate: number
}

// The identity gradient: deep ocean floor to fill blue to bright surface to foam.
const DEEP = ['#0B2942', '#0A2B49', '#0C2540']
const MID = ['#0077C8', '#0A6FB8', '#0B7FCF']
const HIGH = ['#36B0FA', '#3FB6FF', '#2FA6F2']
const FOAM = ['#B9E2FF', '#CDEAFF', '#AEDCFF']
const SHAPES: ShapeKind[] = ['orb', 'ring', 'arcs', 'stripes', 'wedge', 'grid']

export function coverSpec(seed: number): CoverSpec {
  const r = rng(seed)
  const angle = Math.round(118 + r() * 54)
  const deep = DEEP[Math.floor(r() * DEEP.length)]
  const mid = MID[Math.floor(r() * MID.length)]
  const high = HIGH[Math.floor(r() * HIGH.length)]
  const foam = FOAM[Math.floor(r() * FOAM.length)]
  const s1 = Math.round(24 + r() * 14)
  const s2 = Math.round(s1 + 20 + r() * 16)
  const gradient = `linear-gradient(${angle}deg, ${deep} 0%, ${mid} ${s1}%, ${high} ${s2}%, ${foam} 100%)`
  return {
    gradient,
    shape: SHAPES[Math.floor(r() * SHAPES.length)],
    cx: 0.12 + r() * 0.76,
    cy: 0.14 + r() * 0.7,
    scale: 0.5 + r() * 0.7,
    rotate: Math.round(r() * 90 - 45)
  }
}
