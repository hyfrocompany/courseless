import type { PointPhase, PointResult } from '../../../shared/types'
import { Icon, Kbd } from './ui'

/**
 * The two shared pieces of guided pointing: the control that asks for it, and the honest note
 * that appears when it could not be given.
 *
 * The accuracy contract has a UI half. When grounding fails the learner must be TOLD, in the
 * same place the arrow would have come from — never left waiting for something that is not
 * coming, and never shown an arrow that landed on a guess.
 */

export function pointNote(result: PointResult | null): string | null {
  if (!result) return null
  switch (result.outcome) {
    case 'point':
      return null
    case 'miss':
      // A step with nothing clickable ("type git init at the prompt") is not a failure to find
      // something — it is a step with nothing to find. Saying so is more useful than an apology.
      return result.tried
        ? `Couldn't spot it on screen — it should be: ${result.where}`
        : `Nothing to point at on this step — it happens at: ${result.where}`
    case 'wrong-app':
      return `Open ${result.tool || 'the app'} first, then ask again.`
    case 'limit':
      // Not a miss: nothing was looked at. The plan card in the runner carries the way out.
      return result.message
    case 'error':
      return result.message
  }
}

/** Runner: a full-width-ish pill in the action row. */
export function ShowMeButton({
  phase,
  onClick,
  className = ''
}: {
  phase: PointPhase
  onClick(): void
  className?: string
}) {
  const finding = phase === 'finding'
  return (
    <button
      type="button"
      data-testid="point-btn"
      data-phase={phase}
      onClick={onClick}
      disabled={finding}
      aria-label={finding ? 'Finding it on screen' : 'Show me where it is on screen'}
      className={`relative inline-flex h-9 select-none items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-[13.5px] font-medium transition-[background-color,color,opacity] duration-150 ease-out disabled:cursor-progress ${
        finding
          ? 'bg-chip text-chip-ink'
          : phase === 'shown'
            ? 'bg-chip text-chip-ink hover:bg-mist'
            : 'bg-surface text-ink-900 ring-hairline hover:bg-sunken'
      } ${className}`}
    >
      {/* the wait is 5s on the vision path — a shimmer that actually moves is the difference
          between "working" and "broken" */}
      {finding && (
        <span
          aria-hidden="true"
          className="sweep pointer-events-none absolute inset-0 opacity-45"
          style={{ mixBlendMode: 'plus-lighter' }}
        />
      )}
      <span className="relative inline-flex items-center gap-2">
        {Icon.pointer({ size: 14 })}
        {finding ? 'Finding it' : 'Show me'}
      </span>
    </button>
  )
}

/** Float: the same action at widget scale. */
export function ShowMeIconButton({ phase, onClick }: { phase: PointPhase; onClick(): void }) {
  const finding = phase === 'finding'
  return (
    <button
      type="button"
      data-testid="float-point"
      data-phase={phase}
      onClick={onClick}
      disabled={finding}
      aria-label={finding ? 'Finding it on screen' : 'Show me where it is'}
      title={finding ? 'Finding it on screen' : 'Show me where it is (P)'}
      className={`relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-full px-3 text-[13px] transition-colors duration-150 disabled:cursor-progress ${
        finding || phase === 'shown' ? 'bg-chip text-chip-ink' : 'text-ink-700 ring-hairline hover:bg-sunken'
      }`}
    >
      {finding && (
        <span
          aria-hidden="true"
          className="sweep pointer-events-none absolute inset-0 opacity-45"
          style={{ mixBlendMode: 'plus-lighter' }}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">
        {Icon.pointer({ size: 13 })}
        {finding ? 'Finding' : 'Show me'}
      </span>
    </button>
  )
}

/** The honest miss / wrong-app line. Quiet, not an error — the lesson still stands. */
export function PointNote({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <p
      data-testid="point-note"
      className={`fade flex items-start gap-2 text-ink-500 ${compact ? 'text-[11.5px] leading-[1.4]' : 'text-[12.5px] leading-[1.45]'}`}
    >
      <span className="mt-[3px] shrink-0 text-ink-400">{Icon.search({ size: compact ? 12 : 13 })}</span>
      <span>{text}</span>
    </p>
  )
}

/** Runner header: "Point as I go" without a trip to Settings. */
export function AutoPointToggle({ on, onToggle }: { on: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid="auto-point-toggle"
      onClick={onToggle}
      title={on ? 'Pointing at every step' : 'Point only when asked'}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors duration-150 ${
        on ? 'bg-chip text-chip-ink' : 'text-ink-500 hover:bg-sunken hover:text-ink-900'
      }`}
    >
      {Icon.pointer({ size: 12 })}
      as I go
    </button>
  )
}

export function PointKbdChip() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Kbd>P</Kbd> Show me
    </span>
  )
}
