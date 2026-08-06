import type { SkillLevel } from '../../../shared/types'

/** Track taglines, v2 catalogue (scripts/seed-catalogue.ts). Order = catalogue order. */
export const TRACKS: { name: string; tagline: string }[] = [
  { name: 'Claude Code', tagline: 'from zero to shipping' },
  { name: 'Codex CLI', tagline: 'your terminal, doing the work' },
  { name: 'AI at work', tagline: "the tools everyone's now expected to know" },
  { name: 'Excel', tagline: 'numbers without the dread' },
  { name: 'Figma', tagline: 'design that survives handoff' },
  { name: 'Salesforce', tagline: 'make the CRM work for you' },
  { name: 'NetSuite', tagline: 'month-end, tamed' },
  { name: 'Notion', tagline: 'systems that stick' },
  { name: 'Creative', tagline: 'look professional, fast' },
  { name: 'First week', tagline: 'start strong' }
]

export function tagline(track: string): string {
  return TRACKS.find((t) => t.name === track)?.tagline ?? track
}

export function trackOrder(track: string): number {
  const i = TRACKS.findIndex((t) => t.name === track)
  return i === -1 ? TRACKS.length : i
}

export const LEVELS: { value: SkillLevel; label: string }[] = [
  { value: 'never', label: 'Never done it' },
  { value: 'few', label: 'Done it a few' },
  { value: 'rusty', label: 'Rusty' }
]

/** The six curated quick-starts from the spec. */
export const QUICK_STARTS: { label: string; ask: string; level: SkillLevel }[] = [
  {
    label: 'Your first Claude Code session',
    ask: 'have my first Claude Code session: install check, start it in a project, ask for a change, review and accept it',
    level: 'never'
  },
  {
    label: 'Set up Codex and run your first task',
    ask: 'set up the OpenAI Codex CLI and run my first task: install it, sign in, start it in a project, ask for a small change, review what it did',
    level: 'never'
  },
  {
    label: 'Pivot tables in one sitting',
    ask: 'create a pivot table in Excel from a sales sheet: rows, values, filters, refresh, and a pivot chart',
    level: 'never'
  },
  {
    label: 'The report your team keeps asking for',
    ask: 'build the Salesforce report my team keeps asking for: filters, groupings, chart, dashboard, schedule',
    level: 'never'
  },
  {
    label: 'Ship a repo with git',
    ask: 'take a local project and ship it as a git repository: init, first commit, remote, branch, pull request',
    level: 'never'
  },
  {
    label: 'Regex, finally',
    ask: 'read and write regular expressions with confidence: character classes, groups, quantifiers, and testing them safely',
    level: 'rusty'
  }
]
