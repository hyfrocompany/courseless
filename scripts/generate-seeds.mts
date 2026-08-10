// Batch harness: generates the starter library with the SAME EngineService pipeline the app uses.
//
// It signs in the way the app does not: with an access token you hand it, because there is no
// window here to sign in from.
//
//   COURSELESS_ACCESS_TOKEN=<supabase access token> npx tsx scripts/generate-seeds.mts
//
//   npx tsx scripts/generate-seeds.mts            # all 27 (sequential, continue on failure)
//   npx tsx scripts/generate-seeds.mts --only 8   # just catalogue entry 8
//   npx tsx scripts/generate-seeds.mts --from 12  # resume from entry 12
//   npx tsx scripts/generate-seeds.mts --force    # regenerate even if the file exists
//
// Output: resources/seed-lessons/NN-slug.json  (builtin lessons imported by LessonStore on init)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Lesson } from '../src/shared/types'
import { EngineService, toFailure } from '../src/main/services/EngineService'
import { backendConfig, loadEnvFile } from '../src/main/util/env'
import { SEED_CATALOGUE, seedId, slugify, type SeedEntry } from './seed-catalogue'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : 'true'
}

const only = flag('only') ? Number(flag('only')) : null
const from = flag('from') ? Number(flag('from')) : null
const force = !!flag('force')
const outDir = flag('out') ? resolve(String(flag('out'))) : join(ROOT, 'resources', 'seed-lessons')

mkdirSync(outDir, { recursive: true })

const targets: SeedEntry[] = SEED_CATALOGUE.filter((e) => {
  if (only !== null) return e.index === only
  if (from !== null) return e.index >= from
  return true
})

if (targets.length === 0) {
  console.error(`No catalogue entries matched (only=${only} from=${from}).`)
  process.exit(1)
}

loadEnvFile(join(ROOT, '.env.local'))
const backend = backendConfig()
const accessToken = (process.env.COURSELESS_ACCESS_TOKEN ?? '').trim()
if (!backend || !accessToken) {
  console.error(
    'Cannot generate seeds: set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.local) and COURSELESS_ACCESS_TOKEN.'
  )
  process.exit(2)
}

const engine = new EngineService({
  baseUrl: backend.url,
  anonKey: backend.anonKey,
  getAccessToken: async () => accessToken
})

const status = await engine.detectStatus(true)
console.log(`engine: loggedIn=${status.loggedIn} plan=${status.model ?? '—'} transport=${status.transport}`)
if (!status.loggedIn) {
  console.error(`Cannot generate seeds: ${status.error ?? 'the engine is not reachable'}`)
  process.exit(2)
}

const results: { index: number; title: string; ok: boolean; detail: string; ms: number }[] = []

for (const entry of targets) {
  const id = seedId(entry)
  const file = join(outDir, `${String(entry.index).padStart(2, '0')}-${slugify(entry.title)}.json`)
  if (existsSync(file) && !force) {
    console.log(`[${entry.index}/27] SKIP (exists) ${entry.title}`)
    results.push({ index: entry.index, title: entry.title, ok: true, detail: 'skipped (exists)', ms: 0 })
    continue
  }

  const t0 = Date.now()
  process.stdout.write(`[${entry.index}/27] ${entry.track} — ${entry.title} … `)
  try {
    const generated = await engine.generateLesson(entry.ask, entry.level, randomUUID(), {
      onStatus: (m) => process.stdout.write(`\n    · ${m}\n    `)
    })
    const lesson: Lesson = {
      ...generated,
      id,
      title: entry.title, // catalogue titles are the product voice; keep them stable
      track: entry.track,
      builtin: true,
      featured: entry.featured,
      coverSeed: (entry.index * 7919) % 1_000_000,
      runs: []
    }
    writeFileSync(file, JSON.stringify(lesson, null, 2), 'utf8')
    const ms = Date.now() - t0
    console.log(`OK ${lesson.steps.length} steps, ${ms}ms -> ${file}`)
    results.push({ index: entry.index, title: entry.title, ok: true, detail: `${lesson.steps.length} steps`, ms })
  } catch (e) {
    const f = toFailure(e)
    const ms = Date.now() - t0
    console.log(`FAILED ${f.kind}: ${f.message.slice(0, 200)} (${ms}ms)`)
    results.push({ index: entry.index, title: entry.title, ok: false, detail: `${f.kind}: ${f.message}`, ms })
  }
}

engine.dispose()

const ok = results.filter((r) => r.ok).length
console.log(`\n=== seed generation done: ${ok}/${results.length} ok ===`)
for (const r of results) console.log(` ${r.ok ? 'ok  ' : 'FAIL'} ${String(r.index).padStart(2, '0')} ${r.title} — ${r.detail}`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
