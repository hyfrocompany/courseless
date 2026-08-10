import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lesson, RecordDraft, ShelfResult } from '../../../shared/types'
import { tagline, trackOrder } from '../lib/catalogue'
import { LessonRow } from '../components/LessonRow'
import { Shelf } from '../components/Shelf'
import { Button, Eyebrow, Icon, Mono } from '../components/ui'

const ALL = 'All'
const YOURS = 'Yours'

function testidFor(name: string): string {
  return `track-${name.replace(/\W+/g, '-').toLowerCase()}`
}

/**
 * Engines fail in their own language: a 400 comes back as a wall of JSON. The author does not
 * need the wire format, they need the sentence inside it — so dig out `message` when there is
 * one and keep it to a line.
 */
function humanError(raw: string): string {
  const text = (raw || '').trim()
  const found = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  const message = found ? found[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : text
  return message.length > 120 ? `${message.slice(0, 118)}…` : message
}

/**
 * Every lesson on this machine, in one place with one selector.
 *
 * The sidebar FILTERS (it does not scroll-jump): one mechanic, and the selected entry stays lit,
 * so "where am I" has a visible answer at all times. Search cuts across every section.
 */
export function Library({
  lessons,
  drafts,
  shelf,
  shelfAdding,
  shelfError,
  onShelfAdd,
  importError,
  onOpenLesson,
  onEditLesson,
  onShareLesson,
  onImport,
  onImportText,
  onDismissImportError,
  onRetryDraft,
  onDeleteDraft,
  onRecord
}: {
  lessons: Lesson[]
  drafts: RecordDraft[]
  /** The curated cloud shelf. Null until the first answer arrives; never blocks this screen. */
  shelf: ShelfResult | null
  shelfAdding: string | null
  shelfError: string
  onShelfAdd(id: string): void
  importError: { error: string; file?: string } | null
  onOpenLesson(id: string): void
  onEditLesson(id: string): void
  onShareLesson(id: string): void
  onImport(): void
  onImportText(text: string, name: string): void
  onDismissImportError(): void
  onRetryDraft(id: string): void
  onDeleteDraft(id: string): void
  onRecord(): void
}) {
  const [filter, setFilter] = useState<string>(ALL)
  const [q, setQ] = useState('')
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Drag-and-drop. The file is READ here and only its text crosses to the main process — the
  // renderer never learns a filesystem path and the main process never trusts one from us.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDropping(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => onImportText(String(reader.result ?? ''), file.name)
      reader.onerror = () => onImportText('', file.name)
      reader.readAsText(file)
    },
    [onImportText]
  )

  const yours = useMemo(() => lessons.filter((l) => !l.builtin), [lessons])

  const groups = useMemo(() => {
    const byTrack = new Map<string, Lesson[]>()
    for (const l of lessons.filter((x) => x.builtin)) {
      const key = l.track || 'More'
      const arr = byTrack.get(key)
      if (arr) arr.push(l)
      else byTrack.set(key, [l])
    }
    return [...byTrack.entries()].sort((a, b) => trackOrder(a[0]) - trackOrder(b[0]))
  }, [lessons])

  const entries = useMemo(
    () => [
      { name: ALL, count: lessons.length },
      { name: YOURS, count: yours.length },
      ...groups.map(([name, items]) => ({ name, count: items.length }))
    ],
    [groups, lessons.length, yours.length]
  )

  const query = q.trim().toLowerCase()
  const matches = (l: Lesson): boolean =>
    !query ||
    l.title.toLowerCase().includes(query) ||
    l.tool.toLowerCase().includes(query) ||
    (l.track ?? '').toLowerCase().includes(query)

  const results = useMemo(() => lessons.filter(matches), [lessons, query])

  // sections rendered when not searching
  const sections: { name: string; hint?: string; items: Lesson[] }[] = []
  if (filter === ALL || filter === YOURS) sections.push({ name: YOURS, hint: 'lessons you asked for', items: yours })
  for (const [name, items] of groups) {
    if (filter === ALL || filter === name) sections.push({ name, hint: tagline(name), items })
  }

  const shownCount = query ? results.length : sections.reduce((n, s) => n + s.items.length, 0)

  return (
    <div
      data-testid="view-library"
      className="relative mx-auto w-full max-w-[1120px] px-8 pb-16 pt-8"
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return
        dragDepth.current += 1
        setDropping(true)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDropping(false)
      }}
      onDrop={onDrop}
    >
      {/* drop target — the whole screen is the target, so the hint is the whole screen */}
      {dropping && (
        <div
          data-testid="drop-overlay"
          className="fade pointer-events-none fixed inset-x-0 bottom-0 top-[48px] z-40 flex items-center justify-center"
          style={{ background: 'color-mix(in oklab, var(--c-paper) 82%, transparent)' }}
        >
          <div className="rounded-lg bg-surface px-8 py-7 text-center shadow-float ring-1 ring-[var(--c-accent)]">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-chip text-chip-ink">
              {Icon.download({ size: 20 })}
            </span>
            <p className="mt-3 font-display text-[19px] leading-tight tracking-[-0.02em] text-ink-900">
              Drop it here
            </p>
            <p className="mt-1 text-[13px] text-ink-500">A .courseless.json someone shared with you.</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] leading-tight tracking-[-0.03em] text-ink-900">Library</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            {lessons.length} lessons on this machine · {yours.length} yours
          </p>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" data-testid="record-btn" onClick={onRecord}>
            {Icon.record({ size: 14 })} Record your own
          </Button>
          <Button variant="ghost" size="sm" data-testid="import-btn" onClick={onImport}>
            {Icon.download({ size: 14 })} Import
          </Button>

          <div className="relative w-full min-w-[180px] max-w-[300px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
            {Icon.search({ size: 15 })}
          </span>
          <input
            ref={searchRef}
            data-testid="library-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Esc belongs to the field while it has content; only an empty field lets it bubble
                // up to the app-level "go back".
                if (q) {
                  e.stopPropagation()
                  setQ('')
                }
              }
            }}
            spellCheck={false}
            placeholder="Search lessons, tools, tracks"
            aria-label="Search the library"
            className="h-9 w-full rounded-full bg-surface pl-9 pr-9 text-[13.5px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
          />
          {q && (
            <button
              type="button"
              data-testid="library-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQ('')
                searchRef.current?.focus()
              }}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-sunken hover:text-ink-900"
            >
              {Icon.close({ size: 13 })}
            </button>
          )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ import failed */}
      {importError && (
        <div
          data-testid="import-error"
          role="alert"
          className="fade mt-5 rounded-md bg-[var(--c-danger-bg)] p-4 ring-1 ring-[var(--c-danger-line)]"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-ink-900">
                {importError.file ? `Could not import ${importError.file}` : 'Could not import that file'}
              </p>
              <p className="mt-1 max-w-[76ch] text-[13px] leading-[1.5] text-ink-700">{importError.error}</p>
            </div>
            <button
              type="button"
              data-testid="import-error-dismiss"
              aria-label="Dismiss"
              onClick={onDismissImportError}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-surface hover:text-ink-900"
            >
              {Icon.close({ size: 14 })}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ recordings that did not compile */}
      {drafts.length > 0 && (
        <div data-testid="drafts" className="mt-5 rounded-md bg-surface p-4 ring-1 ring-[var(--c-warn-line)]">
          <Eyebrow tone="muted">Unfinished recordings</Eyebrow>
          <p className="mt-1 max-w-[70ch] text-[13px] leading-[1.5] text-ink-500">
            The marks are still here. Only the compile failed.
          </p>
          <ul className="mt-3 divide-y divide-line-2">
            {drafts.map((d) => (
              <li key={d.id} data-testid={`draft-${d.id}`} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink-900">
                    {d.name || 'Untitled recording'}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px]" title={d.error}>
                    <Mono className="shrink-0 text-[11px] text-ink-400">
                      {d.marks.length} {d.marks.length === 1 ? 'mark' : 'marks'}
                      {d.audience ? ` · for ${d.audience}` : ''}
                    </Mono>
                    <span className="min-w-0 text-ink-500">{humanError(d.error)}</span>
                  </span>
                </span>
                <Button variant="outline" size="sm" data-testid={`draft-retry-${d.id}`} onClick={() => onRetryDraft(d.id)}>
                  Try again
                </Button>
                <button
                  type="button"
                  data-testid={`draft-delete-${d.id}`}
                  onClick={() => onDeleteDraft(d.id)}
                  className="text-[12.5px] text-ink-400 transition-colors duration-150 hover:text-danger"
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-x-8 gap-y-5 min-[1100px]:grid-cols-[200px_minmax(0,1fr)]">
        {/* selector: sidebar at ≥1100px, chip row below */}
        <aside className="min-w-0 min-[1100px]:sticky min-[1100px]:top-[64px] min-[1100px]:self-start">
          <Eyebrow className="mb-2 hidden min-[1100px]:block">Browse</Eyebrow>
          <div className="flex flex-wrap gap-1.5 min-[1100px]:flex-col min-[1100px]:flex-nowrap min-[1100px]:gap-px">
            {entries.map((e) => {
              const active = filter === e.name && !query
              return (
                <button
                  key={e.name}
                  type="button"
                  data-testid={testidFor(e.name)}
                  aria-pressed={active}
                  onClick={() => {
                    setFilter(e.name)
                    setQ('')
                  }}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-[5px] text-[12.5px] font-medium transition-colors duration-150 min-[1100px]:w-full min-[1100px]:justify-between min-[1100px]:rounded-sm min-[1100px]:px-2.5 min-[1100px]:py-[6px] ${
                    active
                      ? 'bg-chip text-chip-ink'
                      : 'text-ink-500 hover:text-ink-900 max-[1099px]:bg-surface max-[1099px]:ring-hairline min-[1100px]:hover:bg-sunken'
                  }`}
                >
                  <span className="truncate">{e.name}</span>
                  <span className={`font-mono text-[10.5px] tabular ${active ? '' : 'text-ink-400'}`}>{e.count}</span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* content */}
        <div className="min-w-0" data-testid="lesson-list">
          {query ? (
            <section>
              <div className="mb-3 flex items-baseline gap-3 border-b border-line-2 pb-2">
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink-900">Results</h2>
                <p className="truncate text-[12.5px] text-ink-500">for “{q.trim()}”</p>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-400">
                  {String(results.length).padStart(2, '0')}
                </span>
              </div>
              {results.length === 0 ? (
                <p data-testid="library-empty" className="py-8 text-[13.5px] text-ink-500">
                  Nothing here matches “{q.trim()}”. Ask for it on Home and your coach will build it.
                </p>
              ) : (
                <div className="divide-y divide-line-2">
                  {results.map((l) => (
                    <LessonRow
                      key={l.id}
                      lesson={l}
                      onOpen={onOpenLesson}
                      onEdit={onEditLesson}
                      onShare={onShareLesson}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="space-y-8">
              {/* The curated shelf, first in the column and sharing its left edge with every row
                  below it: it is the one part of the Library that is not on this machine yet, so
                  it sits above what is. Searching filters what you HAVE, so it steps aside then. */}
              <Shelf shelf={shelf} adding={shelfAdding} error={shelfError} onAdd={onShelfAdd} />
              {sections.map((s) => (
                <section key={s.name} data-testid={`section-${s.name.replace(/\W+/g, '-').toLowerCase()}`}>
                  <div className="mb-2.5 flex items-baseline gap-3 border-b border-line-2 pb-2">
                    <h2 className="shrink-0 text-[14px] font-semibold tracking-[-0.01em] text-ink-900">{s.name}</h2>
                    {s.hint && <p className="truncate text-[12.5px] text-ink-500">{s.hint}</p>}
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-400">
                      {String(s.items.length).padStart(2, '0')}
                    </span>
                  </div>
                  {s.items.length === 0 ? (
                    <p data-testid="library-empty" className="py-5 text-[13.5px] leading-[1.6] text-ink-500">
                      Nothing yet. Ask for something on Home, record one yourself, or drop a{' '}
                      <span className="font-mono text-[12px] text-ink-700">.courseless.json</span> someone sent
                      you anywhere on this page.
                    </p>
                  ) : (
                    <div className="divide-y divide-line-2">
                      {s.items.map((l) => (
                        <LessonRow
                          key={l.id}
                          lesson={l}
                          onOpen={onOpenLesson}
                          onEdit={onEditLesson}
                          onShare={onShareLesson}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
              {shownCount === 0 && sections.length === 0 && (
                <p data-testid="library-empty" className="py-8 text-[13.5px] text-ink-500">
                  This library is empty.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
