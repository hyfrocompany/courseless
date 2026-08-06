// One-shot migration for the v2 starter catalogue (2026-08-06).
// Renames/retitles kept seeds to their new index/track/featured, deletes dropped ones,
// and prints which indexes still need `generate-seeds.mts --only N`.

import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SEED_CATALOGUE } from './seed-catalogue'

const DIR = join(process.cwd(), 'resources', 'seed-lessons')

// old index -> new index for lessons whose topic is unchanged (title/track updated in place)
const CARRY: Record<number, number> = {
  1: 1, 2: 2, 4: 3, 8: 10, 9: 11, 10: 12, 11: 13, 13: 14, 17: 15, 18: 16,
  14: 18, 16: 19, 19: 20, 20: 21, 23: 23, 25: 25, 26: 26, 27: 27
}
const DROP = [3, 5, 6, 7, 12, 15, 21, 22, 24]

const slug = (t: string): string =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const byIndex = new Map<number, string>()
for (const f of files) byIndex.set(parseInt(f.slice(0, 2), 10), f)

// stage 1: move carried files to temp names so renumbering can't collide
const staged: Array<{ tmp: string; to: number }> = []
for (const [oldIdx, newIdx] of Object.entries(CARRY)) {
  const f = byIndex.get(Number(oldIdx))
  if (!f) { console.log(`carry MISSING old ${oldIdx}`); continue }
  const tmp = join(DIR, `tmp-${oldIdx}.json`)
  renameSync(join(DIR, f), tmp)
  staged.push({ tmp, to: newIdx })
}
for (const d of DROP) {
  const f = byIndex.get(d)
  if (f && existsSync(join(DIR, f))) { unlinkSync(join(DIR, f)); console.log(`dropped ${f}`) }
}
// stage 2: patch + land at final names
for (const { tmp, to } of staged) {
  const entry = SEED_CATALOGUE.find((e) => e.index === to)
  if (!entry) throw new Error(`no catalogue entry for new index ${to}`)
  const lesson = JSON.parse(readFileSync(tmp, 'utf8'))
  lesson.title = entry.title
  lesson.track = entry.track
  lesson.featured = entry.featured
  const dest = join(DIR, `${String(to).padStart(2, '0')}-${slug(entry.title)}.json`)
  writeFileSync(dest, JSON.stringify(lesson, null, 2))
  unlinkSync(tmp)
  console.log(`carried -> ${dest.split('\\').pop()}`)
}
// stage 3: report gaps
const have = new Set(readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => parseInt(f.slice(0, 2), 10)))
const need = SEED_CATALOGUE.filter((e) => !have.has(e.index)).map((e) => e.index)
console.log(`\nneed generation: ${need.join(', ') || 'none'}`)
