import type { ShelfResult } from '../../../shared/types'
import { Cover } from './Cover'
import { Button, Icon, Mono } from './ui'

/**
 * The shelf Courseless publishes, sitting above the lessons on this machine.
 *
 * It is the same dense row as the rest of the Library, with one difference: the row is not a
 * lesson yet. Adding one copies it here — after that it is an ordinary lesson of yours, editable
 * and deletable like any other, and the row says so rather than offering to add it twice.
 *
 * Nothing here is load-bearing. Offline, the section states that plainly and gets out of the way.
 */
export function Shelf({
  shelf,
  adding,
  error,
  onAdd
}: {
  /** Null until the first answer arrives — the section stays out of the way until then. */
  shelf: ShelfResult | null
  /** Id currently being added, so exactly one row can be busy. */
  adding: string | null
  error: string
  onAdd(id: string): void
}) {
  if (!shelf) return null
  const items = shelf.items
  const left = items.filter((i) => !i.added).length

  return (
    <section data-testid="shelf">
      <div className="mb-2.5 flex items-baseline gap-3 border-b border-line-2 pb-2">
        <h2 className="shrink-0 text-[14px] font-semibold tracking-[-0.01em] text-ink-900">From Courseless</h2>
        <p className="truncate text-[12.5px] text-ink-500">lessons we publish, ready to add</p>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-400">
          {String(items.length).padStart(2, '0')}
        </span>
      </div>

      {items.length === 0 ? (
        <p data-testid="shelf-empty" className="py-5 text-[13.5px] leading-[1.6] text-ink-500">
          {shelf.offline
            ? 'The shelf could not load. It refreshes when you are back online.'
            : 'Nothing on the shelf yet. Ask for what you need on Home and your coach will build it.'}
        </p>
      ) : (
        <>
          <div className="divide-y divide-line-2">
            {items.map((item) => {
              const busy = adding === item.id
              return (
                <div
                  key={item.id}
                  data-testid={`shelf-row-${item.id}`}
                  data-added={item.added ? 'true' : undefined}
                  className="group flex w-full items-center gap-3.5 rounded-sm px-2 py-[8px] text-left transition-colors duration-150 hover:bg-sunken"
                >
                  <Cover seed={item.coverSeed} className="h-[26px] w-[26px] shrink-0" radius="rounded-[6px]" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-[-0.005em] text-ink-900">
                    {item.title}
                  </span>
                  <span className="hidden min-w-0 max-w-[190px] shrink truncate text-[12.5px] text-ink-500 md:block">
                    {item.tool}
                  </span>
                  {item.track && (
                    <Mono className="hidden max-w-[130px] shrink-0 truncate text-[10.5px] text-ocean-700 sm:block dark:text-ocean-300">
                      {item.track}
                    </Mono>
                  )}
                  <Mono className="w-[62px] shrink-0 text-right text-[11px] tabular text-ink-400">
                    {item.steps} steps
                  </Mono>

                  {/* One fixed cell for the action, whatever state it is in: Add, Adding and
                      Added are three different widths, and a right edge that moves row to row
                      is the thing that makes a list look untidy. */}
                  <span className="flex w-[84px] shrink-0 justify-end">
                    {item.added ? (
                      <span
                        data-testid={`shelf-added-${item.id}`}
                        className="inline-flex h-7 items-center gap-1.5 text-[12.5px] text-ink-400"
                      >
                        {Icon.check({ size: 14 })} Added
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`shelf-add-${item.id}`}
                        disabled={busy || !!adding}
                        aria-label={`Add ${item.title} to your library`}
                        onClick={() => onAdd(item.id)}
                        className="w-[72px]"
                      >
                        {busy ? 'Adding' : 'Add'}
                      </Button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>

          {shelf.offline && (
            <p data-testid="shelf-offline" className="mt-2.5 text-[12.5px] text-ink-500">
              The shelf could not load. It refreshes when you are back online.
            </p>
          )}
          {left === 0 && !shelf.offline && (
            <p className="mt-2.5 text-[12.5px] text-ink-500">
              Every one of these is in your library now — they are yours to edit or delete.
            </p>
          )}
          {error && (
            <p data-testid="shelf-error" className="mt-2.5 text-[12.5px] text-warn">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
