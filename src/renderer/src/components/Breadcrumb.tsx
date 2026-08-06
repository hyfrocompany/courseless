import type { ReactNode } from 'react'

/**
 * The "where am I, and how do I get out" strip. It sits in exactly one place on every detail
 * screen — immediately under the nav — so leaving is never a hunt.
 */
export function Breadcrumb({
  root = 'Library',
  current,
  onRoot
}: {
  root?: string
  current: string
  onRoot(): void
}) {
  return (
    <nav data-testid="breadcrumb" aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[12.5px]">
      <button
        type="button"
        data-testid="breadcrumb-root"
        onClick={onRoot}
        className="shrink-0 text-ink-500 underline-offset-[3px] transition-colors duration-150 hover:text-ink-900 hover:underline"
      >
        {root}
      </button>
      <span aria-hidden="true" className="shrink-0 text-ink-300">
        /
      </span>
      <span className="min-w-0 truncate font-medium text-ink-900">{current}</span>
    </nav>
  )
}

/** Breadcrumb in its own sticky bar (Lesson / Review / Settings). The Runner puts the same
 *  breadcrumb inside its progress strip so the two never stack. */
export function BreadcrumbBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-[var(--c-glass)] backdrop-blur-md">
      <div className="mx-auto flex h-[38px] w-full max-w-[1120px] items-center px-8">{children}</div>
    </div>
  )
}
