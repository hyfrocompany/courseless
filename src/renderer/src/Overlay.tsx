import { useEffect, useRef, useState } from 'react'
import type { OverlayPoint } from '../../shared/types'

/**
 * The ghost cursor.
 *
 * A tinted arrow that FLIES to the element the current step is about, trailing a short comet,
 * settles with a double ripple, and names what it found. It is drawn on a transparent
 * click-through window over whatever app the learner is in, so two things are non-negotiable:
 *
 *   1. It must never be mistaken for the real pointer — hence the ocean tint, the halo and the
 *      trail. The learner has to know which arrow is theirs.
 *   2. It must be legible on ANY background: a white desktop, a black terminal, a photo. Every
 *      mark carries its own contrast (white halo under dark ink, hard drop shadow under both).
 *
 * There is no theme here. The overlay does not sit on Courseless's paper, it sits on the world.
 */

const TRAIL = 5
/** Distance the cursor covers per millisecond, before the clamp. */
const MS_PER_PX = 0.6
const MIN_MS = 350
const MAX_MS = 950
/** How long an arrival stays up before it fades on its own. */
const HOLD_MS = 6000
const CURSOR = 30

interface Frame {
  x: number
  y: number
  /** 0 while travelling, 1 once it has arrived — drives the ripple + label. */
  arrived: number
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export default function Overlay() {
  const api = window.courseless
  const [point, setPoint] = useState<OverlayPoint | null>(null)
  const [visible, setVisible] = useState(false)
  const [arrived, setArrived] = useState(false)
  const [flip, setFlip] = useState({ x: false, y: false })

  const cursorRef = useRef<HTMLDivElement>(null)
  const trailRefs = useRef<(HTMLDivElement | null)[]>([])
  const labelRef = useRef<HTMLDivElement>(null)
  // Last resting place survives across points: the cursor flies FROM where it stopped, the way a
  // hand does. The first point of a session starts from the middle of the desktop.
  const posRef = useRef<Frame>({ x: window.innerWidth / 2, y: window.innerHeight / 2, arrived: 0 })
  const firstRef = useRef(true)
  const historyRef = useRef<{ x: number; y: number }[]>([])
  const rafRef = useRef<number>(0)
  const hideTimerRef = useRef<number>(0)

  // ---------------------------------------------------------------- paint
  useEffect(() => {
    const paint = (): void => {
      const { x, y } = posRef.current
      const c = cursorRef.current
      if (c) c.style.transform = `translate3d(${x}px, ${y}px, 0)`
      const hist = historyRef.current
      for (let i = 0; i < TRAIL; i++) {
        const el = trailRefs.current[i]
        if (!el) continue
        // sample progressively further back in the path for each ghost
        const p = hist[Math.max(0, hist.length - 1 - (i + 1) * 3)]
        if (!p) continue
        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
      }
      const l = labelRef.current
      if (l) l.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    paint()
  })

  // ---------------------------------------------------------------- the flight
  useEffect(() => {
    if (!point) return
    cancelAnimationFrame(rafRef.current)
    window.clearTimeout(hideTimerRef.current)

    // The very first flight starts from the middle of the SCREEN the target is on, so the arrow
    // is always seen arriving rather than materialising on a monitor the learner is not watching.
    if (firstRef.current) {
      firstRef.current = false
      posRef.current = {
        x: point.screen.x + point.screen.width / 2,
        y: point.screen.y + point.screen.height / 2,
        arrived: 0
      }
    }
    const from = { x: posRef.current.x, y: posRef.current.y }
    const to = { x: point.x, y: point.y }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.hypot(dx, dy)
    const duration = Math.min(MAX_MS, Math.max(MIN_MS, dist * MS_PER_PX))
    // A hand does not travel in a straight line. Bow the path perpendicular to it, ~12% of the
    // distance, so the flight reads as a gesture rather than a tween.
    const bow = Math.min(140, dist * 0.12)
    const nx = dist > 1 ? -dy / dist : 0
    const ny = dist > 1 ? dx / dist : 0
    const ctrl = { x: (from.x + to.x) / 2 + nx * bow, y: (from.y + to.y) / 2 + ny * bow }

    setVisible(true)
    setArrived(false)
    historyRef.current = [{ ...from }]

    // Label callout flips near the edges of the screen it landed on — not the edges of the whole
    // multi-monitor desktop, which are somewhere else entirely.
    setFlip({
      x: to.x > point.screen.x + point.screen.width - 330,
      y: to.y > point.screen.y + point.screen.height - 150
    })

    const t0 = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / duration)
      const e = easeOutCubic(t)
      const mt = 1 - e
      // quadratic bezier
      const x = mt * mt * from.x + 2 * mt * e * ctrl.x + e * e * to.x
      const y = mt * mt * from.y + 2 * mt * e * ctrl.y + e * e * to.y
      posRef.current = { x, y, arrived: t }
      const hist = historyRef.current
      hist.push({ x, y })
      if (hist.length > 40) hist.shift()

      const c = cursorRef.current
      if (c) c.style.transform = `translate3d(${x}px, ${y}px, 0)`
      for (let i = 0; i < TRAIL; i++) {
        const el = trailRefs.current[i]
        if (!el) continue
        const p = hist[Math.max(0, hist.length - 1 - (i + 1) * 3)]
        if (p) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
      }
      const l = labelRef.current
      if (l) l.style.transform = `translate3d(${x}px, ${y}px, 0)`

      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else {
        setArrived(true)
        hideTimerRef.current = window.setTimeout(() => setVisible(false), HOLD_MS)
      }
    }
    rafRef.current = requestAnimationFrame(step)

    return () => cancelAnimationFrame(rafRef.current)
  }, [point])

  // ---------------------------------------------------------------- wiring
  useEffect(() => {
    const offPoint = api.point.onOverlayPoint((p) => setPoint(p))
    const offDismiss = api.point.onOverlayDismiss(() => {
      window.clearTimeout(hideTimerRef.current)
      cancelAnimationFrame(rafRef.current)
      setVisible(false)
      setArrived(false)
    })
    return () => {
      offPoint()
      offDismiss()
      window.clearTimeout(hideTimerRef.current)
    }
  }, [api])

  return (
    <div
      data-testid="overlay-root"
      data-visible={visible ? '1' : '0'}
      data-arrived={arrived ? '1' : '0'}
      data-point={point ? `${point.x},${point.y}` : ''}
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 300ms cubic-bezier(0.16,1,0.3,1)' }}
    >
      {/* comet trail — separate nodes so each keeps its own opacity and scale */}
      {Array.from({ length: TRAIL }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            trailRefs.current[i] = el
          }}
          className="absolute left-0 top-0 will-change-transform"
          style={{ opacity: visible && !arrived ? 0.34 - i * 0.06 : 0, transition: 'opacity 220ms linear' }}
        >
          <div
            style={{
              transform: `translate(-3px, -2px) scale(${1 - i * 0.11})`,
              transformOrigin: '4px 2px',
              filter: 'blur(0.4px)'
            }}
          >
            <GhostArrow size={CURSOR} trail />
          </div>
        </div>
      ))}

      {/* the arrival marks sit UNDER the cursor so the glyph stays readable */}
      <div
        ref={labelRef}
        className="absolute left-0 top-0 will-change-transform"
        data-testid="overlay-label"
      >
        {/* double ripple */}
        <span
          key={`r1-${point?.id ?? 0}`}
          className={arrived ? 'cl-ripple' : ''}
          style={{ position: 'absolute', left: 0, top: 0, opacity: arrived ? 1 : 0 }}
        />
        <span
          key={`r2-${point?.id ?? 0}`}
          className={arrived ? 'cl-ripple cl-ripple-2' : ''}
          style={{ position: 'absolute', left: 0, top: 0, opacity: arrived ? 1 : 0 }}
        />

        {/* callout */}
        {point?.label && (
          <div
            className="cl-callout"
            style={{
              position: 'absolute',
              left: flip.x ? 'auto' : 22,
              right: flip.x ? 22 : 'auto',
              top: flip.y ? 'auto' : 20,
              bottom: flip.y ? 20 : 'auto',
              opacity: arrived ? 1 : 0,
              transform: arrived ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.97)',
              transition: 'opacity 260ms cubic-bezier(0.16,1,0.3,1) 90ms, transform 260ms cubic-bezier(0.16,1,0.3,1) 90ms'
            }}
          >
            <span className="cl-callout-dot" />
            <span className="cl-callout-text">{point.label}</span>
          </div>
        )}
      </div>

      {/* the cursor itself */}
      <div
        ref={cursorRef}
        data-testid="overlay-cursor"
        className={`absolute left-0 top-0 will-change-transform ${arrived ? 'cl-bob' : ''}`}
      >
        <GhostArrow size={CURSOR} />
      </div>
    </div>
  )
}

/**
 * The glyph. Deliberately NOT the Windows arrow: same silhouette family so it reads as "a
 * pointer", but tinted ocean with a white keyline so it can never be confused with the real one.
 * The tip sits exactly at 0,0 of the parent transform — that is the point being made.
 */
function GhostArrow({ size, trail = false }: { size: number; trail?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{
        display: 'block',
        filter: trail ? 'none' : 'drop-shadow(0 3px 7px rgba(6,22,38,0.55)) drop-shadow(0 1px 1px rgba(6,22,38,0.4))'
      }}
      aria-hidden="true"
    >
      {/* white keyline first, so the dark body reads on a dark background too */}
      <path
        d="M1.6 1.2 L15.4 12.6 L9.1 13.4 L12.6 20.6 L9.4 22.1 L6.1 14.8 L1.6 18.6 Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M1.6 1.2 L15.4 12.6 L9.1 13.4 L12.6 20.6 L9.4 22.1 L6.1 14.8 L1.6 18.6 Z"
        fill="#0e1a22"
        stroke="#0b96ea"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* ocean highlight along the leading edge */}
      <path d="M3.1 3.6 L3.1 15.2 L6.2 12.6" stroke="#36b0fa" strokeWidth="1.1" strokeLinecap="round" opacity="0.9" />
    </svg>
  )
}
