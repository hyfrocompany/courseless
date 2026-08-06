import type { FadeTier } from '../../../shared/types'

export const TIER_LABEL: Record<FadeTier, string> = { 1: 'guided', 2: 'prompted', 3: 'solo' }

/**
 * The fade tier, drawn rather than typed: ● guided, ◐ prompted, ○ solo.
 * Unicode half-circles render inconsistently across fonts, so these are SVG.
 */
export function FadeDot({ tier, size = 12, className = '' }: { tier: FadeTier; size?: number; className?: string }) {
  const r = size / 2 - 1
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={TIER_LABEL[tier]}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.9" />
      {tier === 1 && <circle cx={size / 2} cy={size / 2} r={r} fill="currentColor" />}
      {tier === 2 && (
        <path
          d={`M ${size / 2} ${size / 2 - r} A ${r} ${r} 0 0 1 ${size / 2} ${size / 2 + r} Z`}
          fill="currentColor"
        />
      )}
    </svg>
  )
}

export function FadeLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-ink-500 ${className}`}>
      {([1, 2, 3] as FadeTier[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <FadeDot tier={t} size={11} className="text-ocean-600 dark:text-ocean-400" />
          {TIER_LABEL[t]}
        </span>
      ))}
      <span className="text-ink-400">the training wheels come off</span>
    </div>
  )
}
