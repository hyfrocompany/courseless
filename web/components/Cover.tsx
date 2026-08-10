// Ported from the app: src/renderer/src/components/Cover.tsx.
// Seeded ocean-gradient cover art with one geometric overlay picked from six.

import { coverSpec } from '@/lib/cover'
import type { ReactNode } from 'react'

export function Cover({
  seed,
  className = '',
  children
}: {
  seed: number
  className?: string
  children?: ReactNode
}) {
  const spec = coverSpec(seed)
  const { cx, cy, scale, rotate, shape } = spec
  const X = cx * 100
  const Y = cy * 100

  return (
    <div className={`cover ${className}`} style={{ backgroundImage: spec.gradient }}>
      <svg className="cover-art" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <g transform={`rotate(${rotate} ${X} ${Y})`} opacity="0.5">
          {shape === 'orb' && <circle cx={X} cy={Y} r={26 * scale} fill="#fff" opacity="0.22" />}
          {shape === 'ring' && (
            <>
              <circle cx={X} cy={Y} r={30 * scale} fill="none" stroke="#fff" strokeWidth={1.6} opacity="0.5" />
              <circle cx={X} cy={Y} r={18 * scale} fill="none" stroke="#fff" strokeWidth={1.2} opacity="0.32" />
            </>
          )}
          {shape === 'arcs' &&
            [0, 1, 2, 3].map((i) => (
              <circle
                key={i}
                cx={X}
                cy={Y}
                r={(12 + i * 11) * scale}
                fill="none"
                stroke="#fff"
                strokeWidth={1.1}
                opacity={0.42 - i * 0.07}
              />
            ))}
          {shape === 'stripes' &&
            [0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={X - 40 + i * 16} y={-30} width={4.5} height={170} fill="#fff" opacity={0.16} />
            ))}
          {shape === 'wedge' && (
            <polygon
              points={`${X},${Y - 30 * scale} ${X + 34 * scale},${Y + 24 * scale} ${X - 34 * scale},${Y + 24 * scale}`}
              fill="#fff"
              opacity="0.18"
            />
          )}
          {shape === 'grid' &&
            [0, 1, 2, 3].flatMap((r) =>
              [0, 1, 2, 3].map((c) => (
                <circle
                  key={`${r}-${c}`}
                  cx={X - 24 + c * 16}
                  cy={Y - 24 + r * 16}
                  r={2.4 * scale}
                  fill="#fff"
                  opacity="0.34"
                />
              ))
            )}
        </g>
      </svg>
      {children}
    </div>
  )
}
