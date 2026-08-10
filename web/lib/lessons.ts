// Real entries from the shipped starter library: resources/seed-lessons/*.json.
// Titles, tools, seeds, step counts and minutes are copied from those files, so the
// covers on this page are byte-for-byte the covers the app draws.

export interface LessonRef {
  title: string
  /** the full tool string the lesson carries, as the app stores it */
  tool: string
  /** the same tool, short enough to read on a cover chip instead of being cut mid-word */
  short: string
  seed: number
  steps: number
  minutes: number
}

export const FEATURED: LessonRef[] = [
  { title: 'Pivot tables in one sitting', tool: 'Microsoft Excel for Windows (Microsoft 365)', short: 'Microsoft Excel', seed: 63352, steps: 10, minutes: 15 },
  { title: 'Your first Claude Code session', tool: 'Claude Code in Windows Terminal', short: 'Claude Code', seed: 7919, steps: 9, minutes: 15 },
  { title: 'The pipeline report your team keeps asking for', tool: 'Salesforce Lightning Experience', short: 'Salesforce', seed: 134623, steps: 12, minutes: 30 },
  { title: 'Set a new teammate up to win', tool: 'Asana', short: 'Asana', seed: 197975, steps: 9, minutes: 25 }
]

export const MORE: LessonRef[] = [
  { title: 'Close the month without the scramble', tool: 'Oracle NetSuite', short: 'Oracle NetSuite', seed: 110866, steps: 10, minutes: 75 },
  { title: 'Auto layout that behaves', tool: 'Figma Desktop', short: 'Figma Desktop', seed: 87109, steps: 12, minutes: 20 },
  { title: "Fix a photo's lighting like a pro", tool: 'Adobe Photoshop', short: 'Adobe Photoshop', seed: 174218, steps: 12, minutes: 30 },
  { title: 'One database that runs your team', tool: 'Notion', short: 'Notion', seed: 150461, steps: 9, minutes: 35 },
  { title: 'Handle your first customer ticket well', tool: 'Zendesk Support', short: 'Zendesk Support', seed: 213813, steps: 9, minutes: 25 }
]
