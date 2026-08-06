import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FadeTier, Lesson, LessonStep } from '../../../shared/types'
import { Breadcrumb, BreadcrumbBar } from '../components/Breadcrumb'
import { FadeDot, TIER_LABEL } from '../components/FadeDots'
import { Button, Eyebrow, Icon, Mono } from '../components/ui'

/**
 * The step editor.
 *
 * A lesson is a document, so this is a document editor, not a settings form: the steps stay in
 * their reading order at full width, one opens at a time, and nothing is written until you say
 * so. The Save bar is explicit for one reason — a lesson with runs against it is evidence of
 * someone's practice, and evidence should not change because a cursor passed through a field.
 */

interface Row extends LessonStep {
  /** Stable across reorders — React keys must not be the index while rows move. */
  key: string
  /**
   * Where this step was when the editor opened, or null if it is new. This is what makes
   * "structural change" a fact rather than a guess: any add, delete, or out-of-order sequence
   * shows up here, while editing the words of a step does not.
   */
  origIndex: number | null
}

const BLANK: LessonStep = {
  action: '',
  where: '',
  why: '',
  checkpoint: '',
  hint_levels: ['', '', ''],
  fade_tier: 2
}

let keySeq = 0
const nextKey = (): string => `s${++keySeq}`

function toRows(steps: LessonStep[]): Row[] {
  return steps.map((s, i) => ({
    ...s,
    hint_levels: [s.hint_levels[0] ?? '', s.hint_levels[1] ?? '', s.hint_levels[2] ?? ''],
    key: nextKey(),
    origIndex: i
  }))
}

/** Add, delete or reorder — the things that make an old run's step indexes point somewhere else. */
function isStructural(rows: Row[], originalCount: number): boolean {
  if (rows.length !== originalCount) return true
  let last = -1
  for (const r of rows) {
    if (r.origIndex === null) return true
    if (r.origIndex < last) return true
    last = r.origIndex
  }
  return false
}

const FIELD =
  'w-full rounded-sm bg-paper px-3 py-2 text-[13.5px] leading-[1.5] text-ink-900 ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]'

function Field({
  label,
  hint,
  value,
  onChange,
  testid,
  rows = 1,
  placeholder,
  mono = false
}: {
  label: string
  hint?: string
  value: string
  onChange(v: string): void
  testid: string
  rows?: number
  placeholder?: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</span>
        {hint && <span className="truncate text-[11.5px] text-ink-400">{hint}</span>}
      </span>
      {rows > 1 ? (
        <textarea
          data-testid={testid}
          value={value}
          rows={rows}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`mt-1 resize-y ${FIELD}`}
        />
      ) : (
        <input
          data-testid={testid}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`mt-1 ${FIELD} ${mono ? 'font-mono text-[12.5px]' : ''}`}
        />
      )}
    </label>
  )
}

/** The fade tier, edited the way it is read everywhere else: ● guided ◐ prompted ○ solo. */
function TierToggle({ value, onChange, index }: { value: FadeTier; onChange(t: FadeTier): void; index: number }) {
  return (
    <div
      role="radiogroup"
      aria-label="How much guidance this step gives"
      className="inline-flex items-center gap-px rounded-full bg-sunken p-[3px]"
    >
      {([1, 2, 3] as FadeTier[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          data-testid={`tier-${index}-${t}`}
          title={TIER_LABEL[t]}
          onClick={() => onChange(t)}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[4px] text-[11.5px] font-medium transition-colors duration-150 ${
            value === t ? 'bg-surface text-ink-900 ring-hairline' : 'text-ink-500 hover:text-ink-900'
          }`}
        >
          <FadeDot tier={t} size={10} className={value === t ? 'text-ocean-600 dark:text-ocean-400' : ''} />
          {TIER_LABEL[t]}
        </button>
      ))}
    </div>
  )
}

export function Editor({
  lesson,
  onSave,
  onBack,
  onDone
}: {
  lesson: Lesson
  onSave(next: Lesson): Promise<void>
  onBack(): void
  onDone(): void
}) {
  const [title, setTitle] = useState(lesson.title)
  const [tool, setTool] = useState(lesson.tool)
  const [goal, setGoal] = useState(lesson.goal)
  const [est, setEst] = useState(String(lesson.est_minutes))
  const [audience, setAudience] = useState(lesson.audience ?? '')
  const [rows, setRows] = useState<Row[]>(() => toRows(lesson.steps))
  const [open, setOpen] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  /** Set when leaving was attempted with unsaved work. The save bar answers it in place. */
  const [leaving, setLeaving] = useState<null | 'back' | 'done'>(null)
  const listRef = useRef<HTMLOListElement>(null)

  // The baseline the dirty check compares against. Re-taken after every save, so "unsaved
  // changes" always means changes since the last write, not since the screen opened.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({
      title: lesson.title,
      tool: lesson.tool,
      goal: lesson.goal,
      est: String(lesson.est_minutes),
      audience: lesson.audience ?? '',
      steps: lesson.steps
    })
  )
  const originalCountRef = useRef(lesson.steps.length)

  const cleanSteps = useMemo<LessonStep[]>(
    () =>
      rows.map((r) => ({
        action: r.action.trim(),
        where: r.where.trim(),
        why: r.why.trim(),
        checkpoint: r.checkpoint.trim(),
        hint_levels: r.hint_levels.map((h) => h.trim()),
        fade_tier: r.fade_tier,
        ...(r.target && r.target.trim() ? { target: r.target.trim() } : {})
      })),
    [rows]
  )

  const current = JSON.stringify({ title, tool, goal, est, audience, steps: cleanSteps })
  const dirty = current !== baseline
  const structural = isStructural(rows, originalCountRef.current)
  const emptyActions = cleanSteps.filter((s) => !s.action).length

  const update = useCallback((key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }, [])

  const move = useCallback((key: string, dir: -1 | 1) => {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= rs.length) return rs
      const copy = [...rs]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }, [])

  const addStep = useCallback(() => {
    const row: Row = { ...BLANK, hint_levels: ['', '', ''], key: nextKey(), origIndex: null }
    setRows((rs) => [...rs, row])
    setOpen(row.key)
    setTimeout(() => {
      listRef.current?.lastElementChild?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      document.querySelector<HTMLInputElement>(`[data-testid="step-action-${rows.length}"]`)?.focus()
    }, 40)
  }, [rows.length])

  const discard = useCallback(() => {
    setTitle(lesson.title)
    setTool(lesson.tool)
    setGoal(lesson.goal)
    setEst(String(lesson.est_minutes))
    setAudience(lesson.audience ?? '')
    setRows(toRows(lesson.steps))
    originalCountRef.current = lesson.steps.length
    setOpen(null)
    setConfirmDelete(null)
  }, [lesson])

  const save = useCallback(async () => {
    if (saving) return
    setSaving(true)
    const version = (lesson.version ?? 1) + (structural ? 1 : 0)
    const minutes = Math.max(1, Math.min(600, Math.round(Number(est) || lesson.est_minutes)))
    const next: Lesson = {
      ...lesson,
      title: title.trim() || lesson.title,
      tool: tool.trim(),
      goal: goal.trim(),
      est_minutes: minutes,
      steps: cleanSteps.filter((s) => s.action),
      version,
      ...(audience.trim() ? { audience: audience.trim() } : {})
    }
    if (!audience.trim()) delete next.audience
    await onSave(next)
    setBaseline(JSON.stringify({ title, tool, goal, est, audience, steps: cleanSteps }))
    originalCountRef.current = next.steps.length
    setRows(toRows(next.steps))
    setSaving(false)
    setSavedNote(structural ? `Saved · now version ${version}` : 'Saved')
    setTimeout(() => setSavedNote(''), 2600)
  }, [audience, cleanSteps, est, goal, lesson, onSave, saving, structural, title, tool])

  // Ctrl+S is the muscle memory for "write this down". Esc closes the open step first, so it
  // never means "leave the screen" while a step is expanded.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, save])

  // The Esc ladder, editor edition: close the open step, then ask about unsaved work, and only
  // then let the app's own Esc take you up a level. Unsaved edits must never leave on one key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (leaving) {
        e.preventDefault()
        e.stopPropagation()
        setLeaving(null)
        return
      }
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(null)
        return
      }
      if (dirty) {
        e.preventDefault()
        e.stopPropagation()
        setLeaving('back')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dirty, leaving, open])

  /** Every way out goes through here, so "unsaved" is asked once and answered once. */
  const leave = useCallback(
    (where: 'back' | 'done') => {
      if (dirty) {
        setLeaving(where)
        return
      }
      if (where === 'back') onBack()
      else onDone()
    },
    [dirty, onBack, onDone]
  )

  // A half-finished edit must not vanish because a window closed.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return (
    <>
      <BreadcrumbBar>
        <Breadcrumb current={lesson.title} onRoot={() => leave('back')} />
        <span className="ml-auto flex items-center gap-3">
          {savedNote && (
            <Mono className="fade text-[11px] text-ocean-700 dark:text-ocean-300" data-testid="editor-saved">
              {savedNote}
            </Mono>
          )}
          <Mono className="text-[11px] text-ink-400" data-testid="editor-version">
            v{lesson.version ?? 1}
          </Mono>
        </span>
      </BreadcrumbBar>

      <div
        data-testid="view-editor"
        className={`mx-auto w-full max-w-[880px] px-8 pt-6 ${dirty ? 'pb-[104px]' : 'pb-16'}`}
      >
        <Eyebrow>Editing</Eyebrow>
        <h1 className="mt-1.5 font-display text-[26px] leading-tight tracking-[-0.03em] text-ink-900">
          Say it the way you would say it.
        </h1>
        <p className="mt-2 max-w-[62ch] text-[13.5px] text-ink-500">
          Every word here is what the learner reads. Nothing is saved until you save it.
        </p>

        {/* ------------------------------------------------------------ the lesson itself */}
        <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Field label="Title" value={title} onChange={setTitle} testid="editor-title" />
          <Field label="Tool" value={tool} onChange={setTool} testid="editor-tool" placeholder="File Explorer" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Field
            label="Goal"
            hint="one sentence: what they will have done"
            value={goal}
            onChange={setGoal}
            testid="editor-goal"
            rows={2}
          />
          <div className="flex flex-col gap-4">
            <Field label="Minutes" value={est} onChange={setEst} testid="editor-est" mono />
          </div>
        </div>
        <div className="mt-4">
          <Field
            label="Who it is for"
            hint="shapes nothing automatically — it travels with the lesson"
            value={audience}
            onChange={setAudience}
            testid="editor-audience"
            placeholder="new sales hires"
          />
        </div>

        {/* ------------------------------------------------------------ steps */}
        <div className="mt-9 mb-2 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-2.5">
          <Eyebrow>The path</Eyebrow>
          <span className="font-mono text-[10.5px] text-ink-400">
            {rows.length} steps · click one to open it
          </span>
        </div>

        <ol className="divide-y divide-line-2" data-testid="editor-steps" ref={listRef}>
          {rows.map((r, i) => {
            const isOpen = open === r.key
            return (
              <li key={r.key} data-testid={`editor-step-${i}`} className="py-1">
                {/* collapsed header — always visible, always the reading order */}
                <div className="group flex items-start gap-3 py-2">
                  <Mono className="mt-[5px] w-6 shrink-0 text-[10.5px] text-ink-400">
                    {String(i + 1).padStart(2, '0')}
                  </Mono>
                  <FadeDot
                    tier={r.fade_tier}
                    size={11}
                    className="mt-[8px] shrink-0 text-ocean-600 dark:text-ocean-400"
                  />
                  <button
                    type="button"
                    data-testid={`step-open-${i}`}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpen(isOpen ? null : r.key)
                      }
                    }}
                    className="min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left transition-colors duration-150 hover:bg-sunken"
                  >
                    <span
                      className={`block text-[14px] font-medium leading-snug ${
                        r.action.trim() ? 'text-ink-900' : 'italic text-ink-400'
                      }`}
                    >
                      {r.action.trim() || 'Empty step — write what to do'}
                    </span>
                    {!isOpen && r.where.trim() && (
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-500">{r.where}</span>
                    )}
                  </button>

                  <span className="flex shrink-0 items-center gap-0.5 pt-0.5">
                    <button
                      type="button"
                      data-testid={`step-up-${i}`}
                      aria-label={`Move step ${i + 1} up`}
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => move(r.key, -1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-sunken hover:text-ink-900 disabled:pointer-events-none disabled:opacity-25"
                    >
                      <span className="rotate-[-90deg]">{Icon.chevronRight({ size: 14 })}</span>
                    </button>
                    <button
                      type="button"
                      data-testid={`step-down-${i}`}
                      aria-label={`Move step ${i + 1} down`}
                      title="Move down"
                      disabled={i === rows.length - 1}
                      onClick={() => move(r.key, 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-sunken hover:text-ink-900 disabled:pointer-events-none disabled:opacity-25"
                    >
                      <span className="rotate-90">{Icon.chevronRight({ size: 14 })}</span>
                    </button>
                    {confirmDelete === r.key ? (
                      <span className="ml-1 inline-flex items-center gap-2 text-[12px]">
                        <button
                          type="button"
                          data-testid={`step-delete-confirm-${i}`}
                          onClick={() => {
                            setRows((rs) => rs.filter((x) => x.key !== r.key))
                            setConfirmDelete(null)
                            if (open === r.key) setOpen(null)
                          }}
                          className="font-medium text-danger underline underline-offset-4"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="text-ink-400 transition-colors duration-150 hover:text-ink-900"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`step-delete-${i}`}
                        aria-label={`Delete step ${i + 1}`}
                        title="Delete this step"
                        onClick={() => setConfirmDelete(r.key)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 opacity-0 transition-[color,opacity,background-color] duration-150 hover:bg-[var(--c-danger-bg)] hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        {Icon.trash({ size: 14 })}
                      </button>
                    )}
                  </span>
                </div>

                {/* expanded body */}
                {isOpen && (
                  <div className="fade ml-[52px] mb-3 mr-1 rounded-md bg-surface p-4 ring-hairline">
                    <div className="grid gap-3.5">
                      <Field
                        label="Action"
                        hint="imperative, one sentence"
                        value={r.action}
                        onChange={(v) => update(r.key, { action: v })}
                        testid={`step-action-${i}`}
                        placeholder="Click New folder in the Home tab."
                      />
                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field
                          label="Where"
                          hint="the surface, in words"
                          value={r.where}
                          onChange={(v) => update(r.key, { where: v })}
                          testid={`step-where-${i}`}
                        />
                        <Field
                          label="Target"
                          hint="the element's exact label"
                          value={r.target ?? ''}
                          onChange={(v) => update(r.key, { target: v })}
                          testid={`step-target-${i}`}
                          placeholder="New folder"
                          mono
                        />
                      </div>
                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <Field
                          label="Why"
                          hint="one line of motivation"
                          value={r.why}
                          onChange={(v) => update(r.key, { why: v })}
                          testid={`step-why-${i}`}
                        />
                        <Field
                          label="Checkpoint"
                          hint="what they should see"
                          value={r.checkpoint}
                          onChange={(v) => update(r.key, { checkpoint: v })}
                          testid={`step-checkpoint-${i}`}
                        />
                      </div>

                      <div>
                        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                          Hints
                        </span>
                        <span className="ml-2 text-[11.5px] text-ink-400">nudge → detail → exact path</span>
                        <div className="mt-1.5 grid gap-2">
                          {[0, 1, 2].map((h) => (
                            <div key={h} className="flex items-start gap-2.5">
                              <Mono className="mt-[9px] w-3 shrink-0 text-[10.5px] text-ink-400">{h + 1}</Mono>
                              <input
                                data-testid={`step-hint-${i}-${h}`}
                                value={r.hint_levels[h] ?? ''}
                                spellCheck={false}
                                onChange={(e) => {
                                  const hints = [...r.hint_levels]
                                  hints[h] = e.target.value
                                  update(r.key, { hint_levels: hints })
                                }}
                                className={FIELD}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 pt-3.5">
                        <TierToggle
                          value={r.fade_tier}
                          index={i}
                          onChange={(t) => update(r.key, { fade_tier: t })}
                        />
                        <button
                          type="button"
                          data-testid={`step-close-${i}`}
                          onClick={() => setOpen(null)}
                          className="text-[12.5px] text-ink-500 transition-colors duration-150 hover:text-ink-900"
                        >
                          Close step
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" data-testid="editor-add-step" onClick={addStep}>
            Add step
          </Button>
          {emptyActions > 0 && (
            <span className="text-[12.5px] text-ink-500">
              {emptyActions} empty {emptyActions === 1 ? 'step' : 'steps'} — they are dropped when you save.
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ the save bar */}
      {dirty && (
        <div
          data-testid="save-bar"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[var(--c-glass)] backdrop-blur-[10px]"
        >
          <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center gap-3 px-8 py-3.5">
            <span className="text-[13px] text-ink-700">
              {leaving ? 'Leave with these changes unsaved?' : 'Unsaved changes'}
              {structural && !leaving && (
                <span className="text-ink-500" data-testid="save-bar-structural">
                  {' '}
                  · the steps moved, so this becomes version {(lesson.version ?? 1) + 1} and earlier runs are
                  marked as older
                </span>
              )}
            </span>
            <span className="ml-auto flex items-center gap-2.5">
              {leaving ? (
                <>
                  <Button
                    variant="quiet"
                    data-testid="editor-leave-discard"
                    onClick={() => {
                      discard()
                      setLeaving(null)
                      if (leaving === 'back') onBack()
                      else onDone()
                    }}
                  >
                    Leave without saving
                  </Button>
                  <Button variant="outline" data-testid="editor-stay" onClick={() => setLeaving(null)}>
                    Stay
                  </Button>
                  <Button
                    data-testid="editor-save-leave"
                    disabled={saving}
                    onClick={() => {
                      const where = leaving
                      void save().then(() => {
                        setLeaving(null)
                        if (where === 'back') onBack()
                        else onDone()
                      })
                    }}
                  >
                    Save and leave
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="quiet" data-testid="editor-discard" onClick={discard}>
                    Discard
                  </Button>
                  <Button data-testid="editor-save" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving' : 'Save'}
                  </Button>
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {!dirty && (
        <div className="mx-auto w-full max-w-[880px] px-8 pb-16">
          <Button variant="quiet" data-testid="editor-done" onClick={() => leave('done')}>
            Back to the lesson
          </Button>
        </div>
      )}
    </>
  )
}
