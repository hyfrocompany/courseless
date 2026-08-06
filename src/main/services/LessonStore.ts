// Local-only lesson storage: one JSON file per lesson under <dataDir>/lessons/.
// Atomic writes (tmp + rename). No server, no telemetry.
//
// Electron-free on purpose: paths and the builtin-tombstone hooks are injected, so a plain Node
// harness (scripts/generate-seeds.mts) can reuse this class outside Electron.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Lesson, LessonRun, RunInput } from '../../shared/types'
import { log } from '../util/log'

const SAFE_ID = /^[A-Za-z0-9._-]+$/

export interface TombstoneHooks {
  get(): string[]
  add(id: string): void
}

export interface LessonStoreOptions {
  /** Directory that holds the *.json lesson files. */
  dir: string
  /** Directory of shipped seed lessons (resources/seed-lessons). Optional. */
  seedDir?: string | null
  /** Where deleted-builtin ids are remembered so they do not resurrect. */
  tombstones?: TombstoneHooks
}

export function computeAssistanceRate(run: RunInput, stepCount: number): number {
  const steps = stepCount > 0 ? stepCount : run.perStep.length
  if (!steps) return 0
  const hints = run.perStep.reduce((a, s) => a + (Number(s.hintsUsed) || 0), 0)
  const skips = run.perStep.reduce((a, s) => a + (s.skipped ? 1 : 0), 0)
  return Math.round(((hints + 2 * skips) / steps) * 1000) / 1000
}

export class LessonStore {
  private dir: string
  private seedDir: string | null
  private tombstones: TombstoneHooks

  constructor(options: LessonStoreOptions | string) {
    const opts: LessonStoreOptions = typeof options === 'string' ? { dir: options } : options
    this.dir = opts.dir
    this.seedDir = opts.seedDir ?? null
    this.tombstones = opts.tombstones ?? { get: () => [], add: () => undefined }
    this.ensureDir()
    this.importSeeds()
  }

  get directory(): string {
    return this.dir
  }

  private ensureDir(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch (e) {
      log('lessons', 'mkdir failed', String(e))
    }
  }

  private fileFor(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`unsafe lesson id: ${id}`)
    return join(this.dir, `${id}.json`)
  }

  private writeAtomic(file: string, data: string): void {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, file) // atomic replace on win32 + posix
  }

  /** Idempotent first-run import of the shipped starter library. */
  importSeeds(): number {
    if (!this.seedDir || !existsSync(this.seedDir)) return 0
    const deleted = new Set(this.tombstones.get())
    let imported = 0
    let files: string[] = []
    try {
      files = readdirSync(this.seedDir).filter((n) => n.endsWith('.json'))
    } catch {
      return 0
    }
    for (const name of files.sort()) {
      try {
        const lesson = JSON.parse(readFileSync(join(this.seedDir, name), 'utf8')) as Lesson
        if (!lesson?.id || !Array.isArray(lesson.steps)) continue
        if (deleted.has(lesson.id)) continue // user removed it on purpose
        if (existsSync(this.fileFor(lesson.id))) continue // already imported
        this.save({ ...lesson, builtin: true, runs: Array.isArray(lesson.runs) ? lesson.runs : [] })
        imported++
      } catch (e) {
        log('lessons', 'seed import failed', name, String(e).slice(0, 160))
      }
    }
    if (imported) log('lessons', `imported ${imported} seed lessons from ${this.seedDir}`)
    return imported
  }

  list(): Lesson[] {
    this.ensureDir()
    let names: string[]
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    const out: Lesson[] = []
    for (const n of names) {
      try {
        const raw = readFileSync(join(this.dir, n), 'utf8')
        const lesson = JSON.parse(raw) as Lesson
        if (lesson && typeof lesson.id === 'string' && Array.isArray(lesson.steps)) out.push(lesson)
      } catch (e) {
        log('lessons', 'skipping unreadable file', n, String(e).slice(0, 160))
      }
    }
    // user-generated first, then builtins; newest first within each group
    out.sort((a, b) => {
      const ab = a.builtin ? 1 : 0
      const bb = b.builtin ? 1 : 0
      if (ab !== bb) return ab - bb
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    })
    return out
  }

  get(id: string): Lesson | null {
    try {
      const file = this.fileFor(id)
      if (!existsSync(file)) return null
      return JSON.parse(readFileSync(file, 'utf8')) as Lesson
    } catch (e) {
      log('lessons', 'get failed', id, String(e).slice(0, 160))
      return null
    }
  }

  save(lesson: Lesson): Lesson {
    this.ensureDir()
    const clean: Lesson = { ...lesson, runs: Array.isArray(lesson.runs) ? lesson.runs : [] }
    this.writeAtomic(this.fileFor(clean.id), JSON.stringify(clean, null, 2))
    log('lessons', 'saved', clean.id, clean.title, `${clean.steps.length} steps`)
    return clean
  }

  delete(id: string): boolean {
    try {
      const existing = this.get(id)
      const file = this.fileFor(id)
      if (!existsSync(file)) return false
      unlinkSync(file)
      if (existing?.builtin) this.tombstones.add(id) // do not re-import on next launch
      log('lessons', 'deleted', id, existing?.builtin ? '(builtin — tombstoned)' : '')
      return true
    } catch (e) {
      log('lessons', 'delete failed', id, String(e).slice(0, 160))
      return false
    }
  }

  /** Append a finished run, computing the honest assistance rate in one place. */
  saveRun(lessonId: string, run: RunInput): Lesson | null {
    const lesson = this.get(lessonId)
    if (!lesson) return null
    const full: LessonRun = {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      perStep: run.perStep,
      assistanceRate: computeAssistanceRate(run, lesson.steps.length),
      // Stamped here, once, at the only moment it is knowable: per-step stats are stored by
      // index, and after a structural edit index 3 is a different step. Review compares this to
      // the lesson's version and says so out loud rather than silently charting two lessons.
      version: lesson.version ?? 1
    }
    lesson.runs = [...(lesson.runs ?? []), full]
    log('lessons', 'run saved', lessonId, `assistanceRate=${full.assistanceRate} v${full.version}`)
    return this.save(lesson)
  }
}
