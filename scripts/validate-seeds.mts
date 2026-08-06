import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_CATALOGUE } from './seed-catalogue';

const dir = join(process.cwd(), 'resources', 'seed-lessons');
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
let bad = 0;
const titles = new Map(SEED_CATALOGUE.map((c: any) => [c.index, c.title]));
for (const f of files) {
  const l = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const errs: string[] = [];
  const idx = parseInt(f.slice(0, 2), 10);
  for (const k of ['id','title','goal','est_minutes','prerequisites','steps','coverSeed','track']) if (l[k] === undefined) errs.push(`missing ${k}`);
  if (l.builtin !== true) errs.push('builtin!==true');
  if (titles.get(idx) && l.title !== titles.get(idx)) errs.push(`title mismatch: "${l.title}" vs catalogue "${titles.get(idx)}"`);
  if (!Array.isArray(l.steps) || l.steps.length < 6) errs.push(`steps ${l.steps?.length}`);
  else l.steps.forEach((s: any, i: number) => {
    for (const k of ['action','where','why','checkpoint','hint_levels','fade_tier']) if (s[k] === undefined || s[k] === '') errs.push(`step${i+1}.${k}`);
    if (!Array.isArray(s.hint_levels) || s.hint_levels.length !== 3) errs.push(`step${i+1}.hint_levels len ${s.hint_levels?.length}`);
    if (![1,2,3].includes(s.fade_tier)) errs.push(`step${i+1}.fade_tier ${s.fade_tier}`);
  });
  const tiers = (l.steps ?? []).map((s: any) => s.fade_tier);
  const lastThird = tiers.slice(-Math.ceil(tiers.length / 3));
  if (lastThird.length && !lastThird.some((t: number) => t >= 2)) errs.push('no fading in final third');
  if (errs.length) { bad++; console.log(`FAIL ${f}\n  ${errs.join('\n  ')}`); }
  else console.log(`ok   ${f} (${l.steps.length} steps, tiers ${tiers.join('')})`);
}
console.log(`\n${files.length} files, ${bad} failing`);
