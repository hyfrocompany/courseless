import { useEffect, useRef, useState } from 'react'
import { Button, Eyebrow, Kbd, Mono } from './ui'

/**
 * The one dialog in Courseless.
 *
 * It earns the interruption: pressing Start hands the screen over — the window minimises, a
 * strip appears on top of everything, and a global key starts listening. Asking for the two
 * things that shape the lesson (what it is, who it is for) on a page you could navigate away
 * from would leave the app in a mode the user did not choose.
 */
export function RecordStart({
  open,
  onStart,
  onClose
}: {
  open: boolean
  onStart(name: string, audience: string): void
  onClose(): void
}) {
  const [name, setName] = useState('')
  const [audience, setAudience] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setAudience('')
    const t = setTimeout(() => nameRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  // Esc closes, Tab stays inside. A dialog you can tab out of is a dialog you can lose.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>('input, button')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const ready = name.trim().length > 0
  const start = (): void => {
    if (ready) onStart(name.trim(), audience.trim())
  }

  return (
    <div
      className="fade fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: 'color-mix(in oklab, var(--c-ink-900) 34%, transparent)' }}
      data-testid="record-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Record a walkthrough"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={cardRef}
        className="rise w-full max-w-[520px] rounded-lg bg-surface p-7 shadow-float ring-hairline"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Eyebrow>Record</Eyebrow>
        <h2 className="mt-1.5 font-display text-[25px] leading-tight tracking-[-0.03em] text-ink-900">
          Record it once. Send the file.
        </h2>
        <p className="mt-2 max-w-[52ch] text-[13.5px] leading-[1.5] text-ink-500">
          Do the task the way you always do. Press{' '}
          <Kbd className="h-[19px] px-1.5 text-[10.5px]">Ctrl</Kbd>{' '}
          <Kbd className="h-[19px] px-1.5 text-[10.5px]">⇧</Kbd>{' '}
          <Kbd className="h-[19px] min-w-[19px] px-1.5 text-[10.5px]">M</Kbd> at each moment that
          matters. Nothing else is captured — no screen recording, no screenshots.
        </p>

        <label className="mt-6 block">
          <span className="text-[12.5px] font-semibold text-ink-900">What are you showing someone?</span>
          <input
            ref={nameRef}
            data-testid="record-name"
            value={name}
            spellCheck={false}
            placeholder="File an expense report"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') start()
            }}
            className="mt-1.5 h-11 w-full rounded-sm bg-paper px-3.5 text-[14.5px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-[12.5px] font-semibold text-ink-900">Who is it for?</span>
          <span className="ml-2 text-[12px] text-ink-400">optional</span>
          <input
            data-testid="record-audience"
            value={audience}
            spellCheck={false}
            placeholder="new sales hires · my mom, has never used a computer"
            onChange={(e) => setAudience(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') start()
            }}
            className="mt-1.5 h-11 w-full rounded-sm bg-paper px-3.5 text-[14px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
          />
          <span className="mt-1.5 block text-[12px] leading-[1.45] text-ink-500">
            Whoever you name here is who the lesson is written for — their words, their pace.
          </span>
        </label>

        <div className="mt-7 flex items-center gap-3">
          <Button data-testid="record-start" disabled={!ready} onClick={start}>
            Start recording
          </Button>
          <Button variant="quiet" data-testid="record-dialog-cancel" onClick={onClose}>
            Not now
          </Button>
          <Mono className="ml-auto hidden text-[10.5px] text-ink-400 sm:block">the window steps aside</Mono>
        </div>
      </div>
    </div>
  )
}
