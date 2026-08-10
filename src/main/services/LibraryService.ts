// The curated cloud shelf — the lessons Courseless publishes.
//
// It is a read-only public catalogue, so there is no server logic between the app and it: the row
// set comes straight off PostgREST with the anon key, with no session and no auth round-trip. A
// signed-out copy of the app can still see the shelf; only adding one writes anything, and that
// write is local.
//
// Two rules this file exists to keep:
//   1. The shelf is never load-bearing. Every failure answers with the last list that arrived (or
//      an empty one) and a flag saying so. Nothing here can stop the Library from rendering.
//   2. Adding a shelf lesson is an IMPORT, not a second way in. The row's `lesson` is wrapped in
//      the ordinary `.courseless.json` envelope and handed to `validateLessonFile`, so a published
//      lesson and a dropped file go through exactly the same door.

import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../shared/ipc'
import { validateLessonFile } from '../../shared/lessonFile'
import type { Lesson, ShelfAddResult, ShelfLesson, ShelfResult } from '../../shared/types'
import { log } from '../util/log'
import type { LessonStore } from './LessonStore'
import type { SettingsStore } from './SettingsStore'

/** Where an added lesson says it came from. Also how a re-install recognises its own imports. */
export const LIBRARY_AUTHOR = 'Courseless Library'

/** The shelf changes when we publish, which is not often. Ten minutes is generous and invisible. */
const TTL_MS = 10 * 60_000
const TIMEOUT_MS = 9000

/** The recommended shelf query: published only, featured first, then manual order, then newest. */
const SHELF_QUERY =
  'select=id,title,tool,track,featured,sort,published_at,lesson' +
  '&published=eq.true' +
  '&order=featured.desc,sort.asc,published_at.desc'

interface ShelfRow {
  id: string
  title: string
  tool: string | null
  track: string | null
  featured: boolean
  sort: number
  published_at: string | null
  /** The `lesson` half of a `.courseless.json` — the wrapper is added on the way in. */
  lesson: Record<string, unknown>
}

export interface LibraryServiceOptions {
  /** Empty when the app was built without a backend: the shelf then reports itself offline. */
  url: string
  anonKey: string
  lessons: LessonStore
  settings: SettingsStore
}

export class LibraryService {
  private rows: ShelfRow[] | null = null
  private fetchedAt = 0
  /** One fetch at a time: opening the Library twice in a second must not hit the wire twice. */
  private inflight: Promise<ShelfRow[]> | null = null

  constructor(private opts: LibraryServiceOptions) {}

  // ------------------------------------------------------------------ shelf

  async shelf(force = false): Promise<ShelfResult> {
    const fresh = this.rows !== null && Date.now() - this.fetchedAt < TTL_MS
    if (fresh && !force) return this.present(false)
    try {
      await this.load()
      return this.present(false)
    } catch (e) {
      log('library', 'shelf unavailable', String(e instanceof Error ? e.message : e).slice(0, 160))
      // Whatever is cached is still true enough to show; the screen says the rest.
      return this.present(true)
    }
  }

  /** The rows as the renderer needs them, with "already here" decided in one place. */
  private present(offline: boolean): ShelfResult {
    const rows = this.rows ?? []
    // Read the two "already here" sources once for the whole shelf, not once per row.
    const added = this.addedIds()
    const titles = this.titlesHere()
    return {
      items: rows.map((r) => this.toShelfLesson(r, added, titles)),
      offline,
      fetchedAt: this.rows && this.fetchedAt ? new Date(this.fetchedAt).toISOString() : null
    }
  }

  private toShelfLesson(row: ShelfRow, added: Set<string>, titles: Set<string>): ShelfLesson {
    const lesson = row.lesson ?? {}
    const steps = Array.isArray(lesson.steps) ? lesson.steps.length : 0
    const est = Number(lesson.est_minutes)
    const seed = Number(lesson.coverSeed)
    return {
      id: row.id,
      title: row.title,
      tool: row.tool ?? (typeof lesson.tool === 'string' ? lesson.tool : ''),
      track: row.track ?? '',
      featured: !!row.featured,
      goal: typeof lesson.goal === 'string' ? lesson.goal : '',
      steps,
      estMinutes: Number.isFinite(est) && est > 0 ? Math.round(est) : Math.max(3, steps * 3),
      coverSeed: Number.isFinite(seed) ? Math.abs(Math.round(seed)) : 0,
      added: added.has(row.id) || titles.has(row.title.toLowerCase())
    }
  }

  /**
   * Two answers to "is it already here", because either one alone lies. The remembered ids survive
   * a title change on the shelf; the titles survive a settings.json that was deleted or copied
   * from another machine while the lessons folder came along.
   */
  private addedIds(): Set<string> {
    return new Set(this.opts.settings.get().libraryAdded ?? [])
  }

  private titlesHere(): Set<string> {
    const out = new Set<string>()
    for (const l of this.opts.lessons.list()) {
      if (l.importedFrom === LIBRARY_AUTHOR) out.add((l.title ?? '').toLowerCase())
    }
    return out
  }

  private async load(): Promise<ShelfRow[]> {
    if (this.inflight) return this.inflight
    const run = this.fetchRows()
    this.inflight = run
    try {
      const rows = await run
      this.rows = rows
      this.fetchedAt = Date.now()
      log('library', `shelf ${rows.length} lessons`)
      return rows
    } finally {
      this.inflight = null
    }
  }

  private async fetchRows(): Promise<ShelfRow[]> {
    if (!this.opts.url || !this.opts.anonKey) throw new Error('no backend configured')
    const res = await fetch(`${this.opts.url}/rest/v1/library_lessons?${SHELF_QUERY}`, {
      // PostgREST wants the key in BOTH places: `apikey` gets past the gateway, the bearer token
      // is what the row policy is evaluated against. supabase-js sends both; so must this.
      headers: {
        apikey: this.opts.anonKey,
        Authorization: `Bearer ${this.opts.anonKey}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`shelf HTTP ${res.status}`)
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) throw new Error('shelf did not answer with a list')
    return data.filter(
      (r): r is ShelfRow =>
        !!r && typeof r === 'object' && typeof (r as ShelfRow).id === 'string' && !!(r as ShelfRow).lesson
    )
  }

  // ------------------------------------------------------------------ add

  /**
   * One click, one lesson. The row is wrapped into the shareable-file envelope and validated like
   * any other import, so a malformed publish is caught by the same code that catches a malformed
   * file — and it names the field, rather than saying "could not add".
   */
  async add(id: string): Promise<ShelfAddResult> {
    let row = (this.rows ?? []).find((r) => r.id === id) ?? null
    if (!row) {
      try {
        row = (await this.load()).find((r) => r.id === id) ?? null
      } catch {
        return { ok: false, error: 'The shelf could not be reached. Try again when you are back online.' }
      }
    }
    if (!row) return { ok: false, error: 'That lesson is no longer on the shelf.' }

    const check = validateLessonFile(
      JSON.stringify({
        format: 'courseless-lesson',
        formatVersion: 1,
        exportedAt: row.published_at ?? new Date().toISOString(),
        authoredBy: LIBRARY_AUTHOR,
        lesson: row.lesson
      })
    )
    if (!check.ok) {
      log('library', 'add rejected', id, check.error)
      return { ok: false, error: check.error }
    }

    // A fresh id, exactly as an import gets: the published slug is the SHELF's name for it, and
    // adding it twice must never overwrite the runs done on the first copy.
    const now = new Date().toISOString()
    const lesson: Lesson = {
      ...check.file.lesson,
      id: randomUUID(),
      runs: [],
      codexThreadId: null,
      importedFrom: LIBRARY_AUTHOR,
      importedAt: now,
      // The track is shelf metadata, kept on the local entry so search still finds it by shelf.
      ...(row.track ? { track: row.track } : {})
    }
    const saved = this.opts.lessons.save(lesson)

    const remembered = this.opts.settings.get().libraryAdded ?? []
    if (!remembered.includes(id)) this.opts.settings.set({ libraryAdded: [...remembered, id] })
    log('library', 'added', id, '->', saved.id, saved.title)
    return { ok: true, lesson: saved }
  }
}

/**
 * The shelf's two channels. Deliberately its own registration rather than a branch inside the main
 * IPC surface: nothing else in the app needs to know the catalogue exists.
 */
export function registerLibraryIpc(library: LibraryService): void {
  ipcMain.handle(IPC.libraryShelf, (_e, force?: boolean): Promise<ShelfResult> => library.shelf(!!force))
  ipcMain.handle(IPC.libraryAdd, (_e, id: string): Promise<ShelfAddResult> => library.add(String(id ?? '')))
}
