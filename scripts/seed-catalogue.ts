// The Courseless starter library: 27 seed lessons across 10 tracks.
// v2 (2026-08-06): AI-forward revamp — Codex CLI + AI-at-work tracks added, Creative
// consolidated, First week reframed, all titles in our own outcome voice.

import type { SkillLevel } from '../src/shared/types'

export interface SeedEntry {
  index: number
  track: string
  title: string
  ask: string
  level: SkillLevel
  featured: boolean
}

export function slugify(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Deterministic id so LessonStore's first-run import stays idempotent across boots. */
export function seedId(entry: SeedEntry): string {
  return `seed-${String(entry.index).padStart(2, '0')}-${slugify(entry.title)}`
}

export const SEED_CATALOGUE: SeedEntry[] = [
  // ---------------------------------------------------------------- Claude Code
  {
    index: 1,
    track: 'Claude Code',
    title: 'Your first Claude Code session',
    ask: 'have my first Claude Code session: install check, start it in a project, ask for a change, review and accept it',
    level: 'never',
    featured: true
  },
  {
    index: 2,
    track: 'Claude Code',
    title: 'Understand a codebase you just inherited',
    ask: 'use Claude Code to understand an unfamiliar repository: map structure, trace a feature, find where a behavior lives',
    level: 'few',
    featured: false
  },
  {
    index: 3,
    track: 'Claude Code',
    title: 'Ship a reviewed change with confidence',
    ask: 'use Claude Code to review my branch diff before pushing: find bugs, get a summary, apply a fix',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- Codex CLI
  {
    index: 4,
    track: 'Codex CLI',
    title: 'Set up Codex and run your first task',
    ask: 'set up the OpenAI Codex CLI and run my first task: install it, sign in, start it in a project, ask for a small change, review what it did',
    level: 'never',
    featured: true
  },
  {
    index: 5,
    track: 'Codex CLI',
    title: 'Let Codex fix a bug while you watch',
    ask: 'use the Codex CLI to find and fix a real bug in a project: describe the symptom, watch it investigate, review the diff, keep the fix',
    level: 'few',
    featured: false
  },
  {
    index: 6,
    track: 'Codex CLI',
    title: 'Automate a chore with codex exec',
    ask: 'use codex exec non-interactively to automate a repetitive project chore like renaming files or updating a config across many places',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- AI at work
  {
    index: 7,
    track: 'AI at work',
    title: 'Prompts that get usable answers',
    ask: 'write prompts that get usable answers from an AI chatbot: give context, set the output format, iterate instead of accepting the first draft',
    level: 'never',
    featured: false
  },
  {
    index: 8,
    track: 'AI at work',
    title: 'Turn a messy doc into a clean draft',
    ask: 'use an AI assistant to turn messy meeting notes into a clean structured document with the right tone for the audience',
    level: 'never',
    featured: false
  },
  {
    index: 9,
    track: 'AI at work',
    title: 'Build a reusable AI workflow for weekly reports',
    ask: 'build a repeatable AI workflow for a weekly status report: a saved prompt template, data pasted in the same shape every week, a consistent output format',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- Excel
  {
    index: 10,
    track: 'Excel',
    title: 'Pivot tables in one sitting',
    ask: 'create a pivot table in Excel from a sales sheet: rows, values, filters, refresh, and a pivot chart',
    level: 'never',
    featured: true
  },
  {
    index: 11,
    track: 'Excel',
    title: 'Look anything up with XLOOKUP',
    ask: 'replace VLOOKUP habits with XLOOKUP in Excel including exact match, if-not-found, and two-way lookup',
    level: 'few',
    featured: false
  },
  {
    index: 12,
    track: 'Excel',
    title: 'A budget model that holds up',
    ask: 'build a small clean financial model in Excel: assumptions block, formatted outputs, one scenario toggle',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- Figma
  {
    index: 13,
    track: 'Figma',
    title: 'Auto layout that behaves',
    ask: 'use Figma auto layout properly: direction, spacing, padding, hug vs fill, nested frames, resizing behavior',
    level: 'never',
    featured: false
  },
  {
    index: 14,
    track: 'Figma',
    title: 'Ship a design to developers cleanly',
    ask: 'prepare a Figma file for developer handoff: naming, sections, dev mode, annotations',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- Salesforce
  {
    index: 15,
    track: 'Salesforce',
    title: 'The pipeline report your team keeps asking for',
    ask: 'build the Salesforce report my team keeps asking for: filters, groupings, chart, dashboard, schedule',
    level: 'never',
    featured: true
  },
  {
    index: 16,
    track: 'Salesforce',
    title: 'Automate a follow-up with Flow',
    ask: "build a Salesforce record-triggered Flow with entry conditions, a decision, and fault handling so it doesn't break on edge cases",
    level: 'few',
    featured: false
  },
  {
    index: 17,
    track: 'Salesforce',
    title: 'Clean up a messy lead list',
    ask: 'clean up a messy Salesforce lead list: find duplicates, merge records, fix owners, and set up a list view that keeps it clean',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- NetSuite
  {
    index: 18,
    track: 'NetSuite',
    title: 'Close the month without the scramble',
    ask: 'close an accounting period in NetSuite: checklist, lock A/P and A/R, reconcile, close the period',
    level: 'few',
    featured: false
  },
  {
    index: 19,
    track: 'NetSuite',
    title: 'Saved searches that answer real questions',
    ask: 'build a NetSuite saved search with criteria, results columns, highlighting, and email schedule',
    level: 'few',
    featured: false
  },
  // ---------------------------------------------------------------- Notion
  {
    index: 20,
    track: 'Notion',
    title: 'One database that runs your team',
    ask: 'consolidate Notion into one well-designed database with views instead of many duplicates: properties, relations, filtered views',
    level: 'few',
    featured: false
  },
  {
    index: 21,
    track: 'Notion',
    title: 'A wiki nobody has to be reminded about',
    ask: 'structure a Notion team wiki people actually use: homepage, sections, ownership, templates',
    level: 'never',
    featured: false
  },
  // ---------------------------------------------------------------- Creative
  {
    index: 22,
    track: 'Creative',
    title: "Fix a photo's lighting like a pro",
    ask: "fix a photo's exposure and lighting in Photoshop: levels, curves, dodge and burn, keeping it natural",
    level: 'never',
    featured: false
  },
  {
    index: 23,
    track: 'Creative',
    title: 'Cut a clean edit before lunch',
    ask: 'cut a two-minute video edit in Premiere Pro fast: import, rough cut, trim, transitions, export',
    level: 'never',
    featured: false
  },
  {
    index: 24,
    track: 'Creative',
    title: 'Your first real render',
    ask: 'go from an empty Blender scene to a finished rendered image: a simple model, materials, lighting, camera, render settings',
    level: 'never',
    featured: false
  },
  // ---------------------------------------------------------------- First week
  {
    index: 25,
    track: 'First week',
    title: 'Set a new teammate up to win',
    ask: "onboard a new hire in their first week: accounts, tools, first tasks, check-ins — as a repeatable checklist",
    level: 'few',
    featured: true
  },
  {
    index: 26,
    track: 'First week',
    title: 'Every account and tool, ready on day one',
    ask: "set up every core tool on an employee's first day: email, chat, docs, password manager, dev or work environment",
    level: 'never',
    featured: false
  },
  {
    index: 27,
    track: 'First week',
    title: 'Handle your first customer ticket well',
    ask: 'answer a first customer support ticket well: triage, investigate, respond with the right tone, document',
    level: 'never',
    featured: false
  }
]
