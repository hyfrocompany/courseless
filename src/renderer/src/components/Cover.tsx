import { useMemo, type ReactNode } from 'react'
import { coverSpec } from '../lib/cover'

/**
 * Ocean-gradient cover art, seeded per lesson: the gradient angle and stops shift, and one
 * simple geometric overlay is picked from six. No imagery ships with the app — this is how the
 * library gets colour variance that scales to any lesson count.
 */
export function Cover({
  seed,
  className = '',
  radius = 'rounded-md',
  children,
  vignette = true
}: {
  seed: number
  className?: string
  radius?: string
  children?: ReactNode
  vignette?: boolean
}) {
  const spec = useMemo(() => coverSpec(seed), [seed])
  const { cx, cy, scale, rotate, shape } = spec

  return (
    <div
      className={`relative isolate overflow-hidden ${radius} ${className}`}
      style={{ backgroundImage: spec.gradient }}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g transform={`rotate(${rotate} ${cx * 100} ${cy * 100})`} opacity="0.5">
          {shape === 'orb' && (
            <circle cx={cx * 100} cy={cy * 100} r={26 * scale} fill="#fff" opacity="0.22" />
          )}
          {shape === 'ring' && (
            <>
              <circle
                cx={cx * 100}
                cy={cy * 100}
                r={30 * scale}
                fill="none"
                stroke="#fff"
                strokeWidth={1.6}
                opacity="0.5"
              />
              <circle
                cx={cx * 100}
                cy={cy * 100}
                r={18 * scale}
                fill="none"
                stroke="#fff"
                strokeWidth={1.2}
                opacity="0.32"
              />
            </>
          )}
          {shape === 'arcs' &&
            [0, 1, 2, 3].map((i) => (
              <circle
                key={i}
                cx={cx * 100}
                cy={cy * 100}
                r={(12 + i * 11) * scale}
                fill="none"
                stroke="#fff"
                strokeWidth={1.1}
                opacity={0.42 - i * 0.07}
              />
            ))}
          {shape === 'stripes' &&
            [0, 1, 2, 3, 4].map((i) => (
              <rect
                key={i}
                x={cx * 100 - 40 + i * 16}
                y={-30}
                width={4.5}
                height={170}
                fill="#fff"
                opacity={0.16}
              />
            ))}
          {shape === 'wedge' && (
            <polygon
              points={`${cx * 100},${cy * 100 - 30 * scale} ${cx * 100 + 34 * scale},${cy * 100 + 24 * scale} ${
                cx * 100 - 34 * scale
              },${cy * 100 + 24 * scale}`}
              fill="#fff"
              opacity="0.18"
            />
          )}
          {shape === 'grid' &&
            [0, 1, 2, 3].flatMap((r) =>
              [0, 1, 2, 3].map((c) => (
                <circle
                  key={`${r}-${c}`}
                  cx={cx * 100 - 24 + c * 16}
                  cy={cy * 100 - 24 + r * 16}
                  r={2.4 * scale}
                  fill="#fff"
                  opacity="0.34"
                />
              ))
            )}
        </g>
      </svg>
      {vignette && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 18% 8%, rgba(255,255,255,0.28), transparent 55%), linear-gradient(180deg, transparent 45%, rgba(6,24,40,0.42) 100%)'
          }}
        />
      )}
      {children}
    </div>
  )
}
