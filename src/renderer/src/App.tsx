import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_RUNNER_STATE,
  type CoachLine,
  type CodexStatus,
  type GenerateEvent,
  type Lesson,
  type LessonRun,
  type PointPhase,
  type PointResult,
  type RecordDraft,
  type RunnerCoachState,
  type RunStepStat,
  type Settings,
  type SkillLevel
} from '../../shared/types'
import type { AppInfo } from '../../shared/ipc'
import { Nav, type NavTab } from './components/Nav'
import { RecordStart } from './components/RecordStart'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { Editor } from './screens/Editor'
import { Generating } from './screens/Generating'
import { LessonOverview } from './screens/LessonOverview'
import { COACH_DRAWER, Runner } from './screens/Runner'
import { Review } from './screens/Review'
import { SettingsScreen } from './screens/Settings'
import { FirstRun } from './screens/FirstRun'
import { HOME, navigate, parentOf, useRoute, type Route } from './lib/router'

const TAB_FOR: Record<Route['name'], NavTab> = {
  home: 'home',
  library: 'library',
  lesson: 'library',
  run: 'library',
  review: 'library',
  edit: 'library',
  generating: null,
  settings: null
}

export default function App() {
  const api = window.courseless
  const route = useRoute()

  // ---------------------------------------------------------------- global
  const [status, setStatus] = useState<CodexStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [booted, setBooted] = useState(false)
  const [firstRun, setFirstRun] = useState(false)

  // generation
  const [ask, setAsk] = useState('')
  const [level, setLevel] = useState<SkillLevel>('never')
  const [genStatus, setGenStatus] = useState('')
  const [genRaw, setGenRaw] = useState('')
  const [genError, setGenError] = useState('')
  const [generated, setGenerated] = useState<Lesson | null>(null)
  const genOpRef = useRef<string | null>(null)

  // runner
  const [runLessonId, setRunLessonId] = useState<string | null>(null)
  const [runIndex, setRunIndex] = useState(0)
  const [hintLevel, setHintLevel] = useState(0)
  const [practice, setPractice] = useState(false)
  const [tries, setTries] = useState<number[]>([])
  const [, setTick] = useState(0)
  const statsRef = useRef<RunStepStat[]>([])
  const stepStartRef = useRef<number>(Date.now())
  const runStartRef = useRef<string>('')
  const [lastRun, setLastRun] = useState<LessonRun | null>(null)
  const [floatOpen, setFloatOpen] = useState(false)

  // coach
  const [coachOpen, setCoachOpen] = useState(false)
  const [coachInput, setCoachInput] = useState('')
  const [chat, setChat] = useState<CoachLine[]>([])
  const [coachStream, setCoachStream] = useState('')
  const [coachBusy, setCoachBusy] = useState(false)
  const [coachStatus, setCoachStatus] = useState('')
  const coachOpRef = useRef<string | null>(null)

  // suggestion
  const [suggestion, setSuggestion] = useState<{ title: string; ask: string } | null>(null)
  const [suggestBusy, setSuggestBusy] = useState(false)

  // guided pointing
  const [pointPhase, setPointPhase] = useState<PointPhase>('idle')
  const [pointResult, setPointResult] = useState<PointResult | null>(null)
  const pointSeqRef = useRef(0)

  // stall coach
  const [stalled, setStalled] = useState(false)

  // authoring: record / share / import
  const [recordOpen, setRecordOpen] = useState(false)
  const [drafts, setDrafts] = useState<RecordDraft[]>([])
  const [importError, setImportError] = useState<{ error: string; file?: string } | null>(null)
  const [shareNote, setShareNote] = useState('')

  const refreshLessons = useCallback(async () => {
    setLessons(await api.lessons.list())
  }, [api])

  const refreshDrafts = useCallback(async () => {
    setDrafts(await api.record.drafts())
  }, [api])

  const refreshStatus = useCallback(
    async (force = false) => {
      setChecking(true)
      try {
        setStatus(await api.codexStatus(force))
      } finally {
        setChecking(false)
      }
    },
    [api]
  )

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    void refreshStatus()
    void refreshLessons()
    void refreshDrafts()
    void api.appInfo().then(setInfo)
    void api.settings.get().then((s) => {
      setSettings(s)
      setFirstRun(!s.onboarded)
      // normalise the URL so the first history entry is a real route
      navigate(HOME, { replace: true })
      setBooted(true)
    })
  }, [api, refreshDrafts, refreshLessons, refreshStatus])

  // ---------------------------------------------------------------- recording
  // The pill and the compile both live in the main process, so this window only has to open the
  // dialog, follow the phase, and get out of the way.
  useEffect(() => api.record.onInvite(() => setRecordOpen(true)), [api])

  useEffect(
    () =>
      api.record.onState((s) => {
        if (s.phase === 'compiling') {
          // The compile is a generation like any other: same screen, same stream, same cancel.
          setRecordOpen(false)
          setGenRaw('')
          setGenError('')
          setGenerated(null)
          setAsk(s.name)
          setGenStatus('Turning your recording into a path')
          genOpRef.current = s.opId && s.opId !== 'pending' ? s.opId : 'pending'
          navigate({ name: 'generating' })
        } else if (s.phase === 'idle') {
          void refreshDrafts()
        }
      }),
    [api, refreshDrafts]
  )

  const startRecording = useCallback(
    (name: string, audience: string) => {
      setRecordOpen(false)
      void api.record.start(name, audience)
    },
    [api]
  )

  // settings changed anywhere (this window, the float, the tray) -> follow
  useEffect(() => api.settings.onChange(setSettings), [api])

  // theme: class-based, both windows read the same persisted setting
  useEffect(() => {
    const dark = settings?.theme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.body.style.colorScheme = dark ? 'dark' : 'light'
  }, [settings?.theme])

  // 1s ticker so the runner clock moves
  useEffect(() => {
    if (route.name !== 'run') return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [route.name])

  // ---------------------------------------------------------------- route <-> lesson
  const routeLessonId =
    route.name === 'lesson' || route.name === 'run' || route.name === 'review' || route.name === 'edit'
      ? route.id
      : null

  // Deep links and history navigation can land on a lesson we have not loaded yet.
  useEffect(() => {
    if (!routeLessonId || lesson?.id === routeLessonId) return
    let alive = true
    void api.lessons.get(routeLessonId).then((l) => {
      if (!alive) return
      if (l) setLesson(l)
      else navigate({ name: 'library' }, { replace: true })
    })
    return () => {
      alive = false
    }
  }, [api, routeLessonId, lesson?.id])

  // Guards: a run only exists while it is running, and a review needs a run to show.
  useEffect(() => {
    if (route.name === 'run' && runLessonId !== route.id) {
      navigate({ name: 'lesson', id: route.id }, { replace: true })
    }
    if (route.name === 'review' && lesson?.id === route.id && lesson.runs.length === 0) {
      navigate({ name: 'lesson', id: route.id }, { replace: true })
    }
    if (route.name === 'generating' && !genOpRef.current && !generated) {
      navigate(HOME, { replace: true })
    }
    // Starter lessons are not editable in place — Duplicate first. Reaching #/edit/<builtin> by
    // hand lands on the overview, where that choice is offered.
    if (route.name === 'edit' && lesson?.id === route.id && lesson.builtin) {
      navigate({ name: 'lesson', id: route.id }, { replace: true })
    }
  }, [route, runLessonId, lesson, generated])

  // Reviewing is not only reachable straight off a finished run — history back/forward can land
  // here too, so fall back to the last run on record.
  const reviewRun = useMemo<LessonRun | null>(() => {
    if (route.name !== 'review' || !lesson) return null
    return lastRun ?? lesson.runs[lesson.runs.length - 1] ?? null
  }, [route, lesson, lastRun])

  // ---------------------------------------------------------------- generate stream
  useEffect(() => {
    const off = api.onGenerateEvent((e: GenerateEvent) => {
      if (genOpRef.current && e.opId !== genOpRef.current) return
      switch (e.type) {
        case 'status':
          setGenStatus(e.message)
          break
        case 'delta':
          setGenRaw((s) => s + e.text)
          break
        case 'message':
          setGenRaw(e.text)
          break
        case 'done':
          setGenStatus(`${e.lesson.steps.length} steps · thread ${e.lesson.codexThreadId ? 'kept' : 'none'}`)
          setGenerated(e.lesson)
          setLesson(e.lesson)
          void refreshLessons()
          break
        case 'error':
          if (e.error.kind === 'CANCELLED') {
            setGenStatus('')
            genOpRef.current = null
            navigate(HOME)
          } else {
            setGenError(`${e.error.message} (${e.error.kind})`)
            setGenStatus('')
          }
          break
      }
    })
    return off
  }, [api, refreshLessons])

  // ---------------------------------------------------------------- coach stream
  useEffect(() => {
    const off = api.onCoachEvent((e) => {
      if (coachOpRef.current && e.opId !== coachOpRef.current) return
      switch (e.type) {
        case 'status':
          setCoachStatus(e.message)
          break
        case 'delta':
          setCoachStream((s) => s + e.text)
          break
        case 'done':
          setChat((c) => [...c, { role: 'coach', text: e.text }])
          setCoachStream('')
          setCoachBusy(false)
          break
        case 'error':
          setChat((c) => [...c, { role: 'coach', text: `${e.error.message} (${e.error.kind})` }])
          setCoachStream('')
          setCoachBusy(false)
          break
      }
    })
    return off
  }, [api])

  // ---------------------------------------------------------------- runner actions
  const commitStep = useCallback((index: number, opts: { skipped?: boolean; done?: boolean }) => {
    const s = statsRef.current[index]
    if (!s) return
    s.seconds += Math.max(0, Math.round((Date.now() - stepStartRef.current) / 1000))
    if (opts.skipped) s.skipped = true
    if (opts.done) s.done = true
  }, [])

  // The float is the default surface now, so the window is usually MINIMIZED while a run is on.
  // Anything that ends or leaves the run has to put it back; a ref, because finishRun is called
  // from a callback that must not re-create itself every time the widget opens or closes.
  const floatOpenRef = useRef(floatOpen)
  floatOpenRef.current = floatOpen

  /** Pin: the widget carries the lesson and the window steps aside. */
  const pinToScreen = useCallback(async () => {
    const st = await api.floatControl('open')
    setFloatOpen(st.visible)
    // minimize, never hide — the taskbar button is how a learner gets the window back by hand
    await api.winControl('minimize')
  }, [api])

  /** Unpin: the window comes back and takes the lesson with it. */
  const unpinToWindow = useCallback(async () => {
    await api.floatControl('close')
    setFloatOpen(false)
    await api.winControl('restore')
  }, [api])

  const finishRun = useCallback(async () => {
    if (!lesson) return
    const wasPinned = floatOpenRef.current
    const updated = await api.lessons.saveRun(lesson.id, {
      startedAt: runStartRef.current || new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      perStep: statsRef.current
    })
    if (updated) {
      setLesson(updated)
      setLastRun(updated.runs[updated.runs.length - 1] ?? null)
    }
    await refreshLessons()
    await api.runner.setState({ ...EMPTY_RUNNER_STATE })
    await api.floatControl('close')
    setFloatOpen(false)
    // Finishing the last step from the float has to land somewhere: the window comes back, on
    // the Review screen, which is the only thing worth looking at at the end of a run.
    if (wasPinned) await api.winControl('restore')
    setCoachOpen(false)
    setSuggestion(null)
    setRunLessonId(null)
    navigate({ name: 'review', id: lesson.id })
  }, [api, lesson, refreshLessons])

  // NOTE (B1 bug #1): these must stay OUT of setState updater callbacks — React StrictMode
  // invokes those twice in dev, which double-counted every hint.
  const advance = useCallback(
    (skipped: boolean) => {
      if (!lesson) return
      const i = runIndex
      commitStep(i, skipped ? { skipped: true } : { done: true })
      const next = i + 1
      if (next >= lesson.steps.length) {
        void finishRun()
        return
      }
      stepStartRef.current = Date.now()
      setHintLevel(0)
      setRunIndex(next)
    },
    [commitStep, finishRun, lesson, runIndex]
  )

  const takeHint = useCallback(() => {
    if (hintLevel >= 3) return
    if (practice && (tries[runIndex] ?? 0) < 2) return // practice mode: prove it first
    const s = statsRef.current[runIndex]
    if (s) s.hintsUsed += 1
    setHintLevel(hintLevel + 1)
  }, [hintLevel, practice, runIndex, tries])

  const goPrev = useCallback(() => {
    if (runIndex === 0) return
    commitStep(runIndex, {})
    stepStartRef.current = Date.now()
    setHintLevel(0)
    setRunIndex(runIndex - 1)
  }, [commitStep, runIndex])

  const markTried = useCallback(() => {
    setTries((t) => t.map((v, i) => (i === runIndex ? v + 1 : v)))
  }, [runIndex])

  // ---------------------------------------------------------------- guided pointing
  // The window that owns the runner owns the pointing too, so the float and the runner can never
  // disagree about what is on screen. Only the newest request may land: `pointSeqRef` drops a
  // reply that arrived after the learner moved on (the vision path takes ~5s).
  const requestPoint = useCallback(
    async (opts: { auto?: boolean } = {}) => {
      const l = lesson
      const step = l?.steps[runIndex]
      if (!l || !step) return
      const seq = ++pointSeqRef.current
      setPointPhase('finding')
      setPointResult(null)
      let res: PointResult
      try {
        res = await api.point.show({
          lessonId: l.id,
          stepIndex: runIndex,
          target: step.target,
          where: step.where,
          action: step.action,
          tool: l.tool,
          // asking again by hand means "look again now"; the auto-walk may reuse the 30s cache
          fresh: !opts.auto
        })
      } catch (e) {
        res = { outcome: 'error', message: String(e), ms: 0 }
      }
      if (seq !== pointSeqRef.current) return
      setPointResult(res)
      setPointPhase(res.outcome === 'point' ? 'shown' : 'idle')
    },
    [api, lesson, runIndex]
  )

  const dismissPoint = useCallback(() => {
    pointSeqRef.current++
    setPointPhase('idle')
    setPointResult(null)
    void api.point.dismiss()
  }, [api])

  // Main can take the overlay down without being asked (the learner dragged a window, the
  // foreground changed). Follow it: a mirror that still says "shown" makes the Show me button lie
  // and makes the next Esc dismiss an arrow that is already gone.
  useEffect(
    () =>
      api.point.onOverlayDismiss(() => {
        if (pointPhaseRef.current !== 'shown') return
        setPointPhase('idle')
      }),
    [api]
  )

  // A point belongs to ONE step. Changing step, or leaving the runner, takes it down — an arrow
  // still hovering over the previous step's button is exactly the wrong-place failure.
  useEffect(() => {
    dismissPoint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIndex, route.name, lesson?.id])

  // "Point as I go" — the walk-through mode. Off by default; Courseless is quiet.
  useEffect(() => {
    if (route.name !== 'run' || !settings?.pointAsYouGo || !lesson?.steps[runIndex]) return
    const t = setTimeout(() => void requestPoint({ auto: true }), 260)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, settings?.pointAsYouGo, lesson?.id, runIndex])

  // ---------------------------------------------------------------- voice (off by default)
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    if (!settings?.speakSteps || route.name !== 'run') {
      synth.cancel()
      return
    }
    const step = lesson?.steps[runIndex]
    if (!step) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(step.where ? `${step.action} ${step.where}` : step.action)
    u.rate = 1.05
    synth.speak(u)
    // verification hook: speaking is asynchronous and unobservable from outside the window
    const w = window as unknown as { __clSpoke?: number; __clLastSpoken?: string }
    w.__clSpoke = (w.__clSpoke ?? 0) + 1
    w.__clLastSpoken = u.text
    return () => synth.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.speakSteps, route.name, lesson?.id, runIndex])

  // ---------------------------------------------------------------- stall coach
  // One quiet nudge per step, never a nag. Threshold is 3x the lesson's own pace with a 90s floor,
  // so a 20-second step and a five-minute step are both judged on their own terms.
  useEffect(() => {
    setStalled(false)
    if (route.name !== 'run' || !lesson || !settings?.stallCoach) return
    const perStepMs = ((lesson.est_minutes || 10) * 60_000) / Math.max(1, lesson.steps.length)
    const ms = info?.stallMsOverride ?? Math.max(90_000, perStepMs * 3)
    const t = setTimeout(() => setStalled(true), ms)
    return () => clearTimeout(t)
  }, [route.name, lesson, runIndex, settings?.stallCoach, info?.stallMsOverride])

  // keep the latest handlers reachable from the (stable) IPC listener
  const handlersRef = useRef({ advance, takeHint, goPrev, requestPoint, sendCoach })
  handlersRef.current = { advance, takeHint, goPrev, requestPoint, sendCoach }

  useEffect(() => {
    const off = api.runner.onAction((a) => {
      if (a.source === 'main') return
      const h = handlersRef.current
      if (a.type === 'done') h.advance(false)
      else if (a.type === 'skip') h.advance(true)
      else if (a.type === 'hint') h.takeHint()
      else if (a.type === 'prev') h.goPrev()
      else if (a.type === 'point') void h.requestPoint()
      // The float never calls the engine itself: it hands the question to the window that owns
      // the thread, so there is one conversation no matter which surface it was typed into.
      else if (a.type === 'coach-ask') {
        if (a.text) void h.sendCoach(a.text)
      } else if (a.type === 'coach-open') {
        // main has already raised this window and hidden the widget
        setFloatOpen(false)
        setCoachOpen(true)
      } else if (a.type === 'close') {
        // main raised this window and hid the widget — follow, or the pin button lies
        setFloatOpen(false)
      }
    })
    return off
  }, [api])

  // The float shows a window onto the same thread, not a second one. Six lines is three
  // exchanges, which is what fits in a 380px card without becoming a chat app.
  const coachTail = useMemo<RunnerCoachState>(
    () => ({ lines: chat.slice(-6), stream: coachStream, busy: coachBusy, total: chat.length }),
    [chat, coachStream, coachBusy]
  )

  // publish runner state (main -> float)
  useEffect(() => {
    if (route.name === 'run' && lesson) {
      void api.runner.setState({
        active: true,
        lessonId: lesson.id,
        title: lesson.title,
        tool: lesson.tool,
        stepIndex: runIndex,
        total: lesson.steps.length,
        step: lesson.steps[runIndex] ?? null,
        hintLevel,
        hintsUsed: statsRef.current[runIndex]?.hintsUsed ?? 0,
        startedAtMs: stepStartRef.current,
        stalled,
        pointing: pointPhase,
        pointResult,
        coach: coachTail
      })
    } else {
      void api.runner.setState({ ...EMPTY_RUNNER_STATE })
    }
  }, [api, route.name, lesson, runIndex, hintLevel, stalled, pointPhase, pointResult, coachTail])

  // ---------------------------------------------------------------- keyboard
  const goBack = useCallback(() => {
    navigate(parentOf(route))
  }, [route])

  // Read through a ref, not the closure: React flushes the drawer-close state update *during*
  // the same keydown dispatch, so a re-subscribed listener would otherwise see coachOpen=false
  // and go back as well — one Esc doing two things.
  const coachOpenRef = useRef(coachOpen)
  coachOpenRef.current = coachOpen
  const pointPhaseRef = useRef(pointPhase)
  pointPhaseRef.current = pointPhase

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const typing = !!t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)

      if (e.key === 'Escape') {
        // one Esc contract everywhere: dismiss the transient thing that is open, innermost first
        // (a live pointer, then the coach drawer), and only then go up a level
        if (coachOpenRef.current) {
          e.preventDefault()
          setCoachOpen(false)
          return
        }
        if (pointPhaseRef.current !== 'idle') {
          e.preventDefault()
          dismissPoint()
          return
        }
        if (route.name === 'generating') {
          void onCancelGenerate()
          return
        }
        if (route.name !== 'home') {
          e.preventDefault()
          goBack()
        }
        return
      }
      if (route.name !== 'run') return
      if (typing || coachOpen) return

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        handlersRef.current.advance(false)
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        handlersRef.current.takeHint()
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        handlersRef.current.advance(true)
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        setCoachOpen(true)
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault()
        void handlersRef.current.requestPoint()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, coachOpen, goBack, dismissPoint])

  // ---------------------------------------------------------------- commands
  function onGenerate(): void {
    const text = ask.trim()
    if (!text) return
    setGenRaw('')
    setGenError('')
    setGenerated(null)
    setGenStatus('Waking your coach')
    genOpRef.current = 'pending'
    navigate({ name: 'generating' })
    void api.generateLesson(text, level).then(({ opId }) => {
      genOpRef.current = opId
    })
  }

  async function onCancelGenerate(): Promise<void> {
    const op = genOpRef.current
    genOpRef.current = null
    if (op && op !== 'pending') await api.cancel(op)
    navigate(HOME)
  }

  /** `pinned` defaults to the setting: pinned is how lessons run unless you said otherwise. */
  function startRun(l: Lesson, isPractice: boolean, pinned = settings?.startPinned !== false): void {
    statsRef.current = l.steps.map((_, i) => ({
      stepIndex: i,
      seconds: 0,
      hintsUsed: 0,
      skipped: false,
      done: false
    }))
    runStartRef.current = new Date().toISOString()
    stepStartRef.current = Date.now()
    setLesson(l)
    setPractice(isPractice)
    setTries(l.steps.map(() => 0))
    setRunIndex(0)
    setHintLevel(0)
    setChat([])
    setCoachOpen(false)
    setLastRun(null)
    setRunLessonId(l.id)
    navigate({ name: 'run', id: l.id })
    if (pinned) void pinToScreen()
  }

  /** Leaving a run mid-way takes the widget with it — a float with no lesson is litter. */
  function leaveRun(to: 'lesson' | 'library'): void {
    setRunLessonId(null)
    if (floatOpenRef.current) {
      void api.floatControl('close')
      setFloatOpen(false)
    }
    navigate(to === 'library' ? { name: 'library' } : { name: 'lesson', id: lesson?.id ?? '' })
  }

  function openLesson(id: string): void {
    setChat([])
    navigate({ name: 'lesson', id })
  }

  async function deleteLesson(id: string): Promise<void> {
    await api.lessons.delete(id)
    await refreshLessons()
    setLesson(null)
    navigate({ name: 'library' })
  }

  // ---------------------------------------------------------------- share / import / edit

  async function shareLesson(id: string): Promise<void> {
    setShareNote('')
    const res = await api.lessons.export(id)
    if (res.ok) setShareNote(`Saved to ${res.path} — send that file to anyone with Courseless.`)
    else if (!res.cancelled) setShareNote(res.error)
    if (route.name !== 'lesson') {
      // Sharing from a Library row has no place to put the note, so open what was shared.
      const l = await api.lessons.get(id)
      if (l && res.ok) {
        setLesson(l)
        navigate({ name: 'lesson', id })
      }
    }
  }

  async function importLesson(payload?: { text: string; name: string }): Promise<void> {
    setImportError(null)
    const res = await api.lessons.import(payload)
    if (res.ok) {
      await refreshLessons()
      setLesson(res.lesson)
      navigate({ name: 'lesson', id: res.lesson.id })
    } else if (!res.cancelled) {
      setImportError({ error: res.error, file: res.file })
      navigate({ name: 'library' })
    }
  }

  async function duplicateLesson(id: string): Promise<void> {
    const copy = await api.lessons.duplicate(id)
    if (!copy) return
    await refreshLessons()
    setLesson(copy)
    navigate({ name: 'edit', id: copy.id })
  }

  async function saveEditedLesson(next: Lesson): Promise<void> {
    const saved = await api.lessons.save(next)
    setLesson(saved)
    await refreshLessons()
  }

  /** `text` comes from the float's compact chat; without it, the drawer's own input. */
  async function sendCoach(text?: string): Promise<void> {
    const msg = (text ?? coachInput).trim()
    if (!msg || !lesson || coachBusy) return
    setChat((c: CoachLine[]) => [...c, { role: 'you', text: msg }])
    if (text === undefined) setCoachInput('')
    setCoachStream('')
    setCoachStatus('')
    setCoachBusy(true)
    const { opId } = await api.coachSend(lesson.id, msg, {
      stepIndex: runIndex,
      total: lesson.steps.length,
      step: lesson.steps[runIndex] ?? null
    })
    coachOpRef.current = opId
  }

  /**
   * The runner's "Pin to screen". Reads the widget's real state first: the tray and the global
   * hotkey can both toggle it behind this window's back, and a button that lies about what it is
   * about to do is worse than no button.
   */
  async function toggleFloat(): Promise<void> {
    const st = await api.floatControl('status')
    if (st.visible) await unpinToWindow()
    else await pinToScreen()
  }

  async function onSuggestNext(): Promise<void> {
    if (!lesson) return
    setSuggestBusy(true)
    setSuggestion(null)
    const res = await api.suggestNext(lesson.id, reviewRun ?? {})
    setSuggestBusy(false)
    if (res.ok) setSuggestion(res.value)
  }

  async function patchSettings(patch: Partial<Settings>): Promise<void> {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    setSettings(await api.settings.set(patch))
  }

  // ---------------------------------------------------------------- render
  if (!booted) {
    return <div className="min-h-screen bg-paper" />
  }

  if (firstRun) {
    return (
      <FirstRun
        status={status}
        checking={checking}
        onRecheck={() => void refreshStatus(true)}
        onContinue={() => {
          void patchSettings({ onboarded: true })
          setFirstRun(false)
          navigate(HOME, { replace: true })
        }}
      />
    )
  }

  const routeLesson = lesson && lesson.id === routeLessonId ? lesson : null

  // The shell owns the scroll, not the document: a document scrollbar would run up the right edge
  // *past* the window controls, and a close button that is not flush into the corner is not a
  // Windows close button. Everything below the 48px title bar scrolls inside <main>.
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper">
      <Nav
        status={status}
        tab={TAB_FOR[route.name]}
        onHome={() => navigate(HOME)}
        onLibrary={() => navigate({ name: 'library' })}
        onSettings={() => navigate({ name: 'settings' })}
        onStatusClick={() => navigate({ name: 'settings' })}
      />

      {/* The coach drawer shrinks the scroll container rather than padding it — padding would
          leave the scrollbar at the border edge, hidden underneath the drawer. */}
      <main
        data-testid="scroll-root"
        className="relative min-h-0 flex-1 overflow-y-auto transition-[margin] duration-200 ease-out"
        style={{ marginRight: route.name === 'run' && coachOpen ? COACH_DRAWER : 0 }}
      >
      {route.name === 'home' && (
        <Home
          lessons={lessons}
          ask={ask}
          setAsk={setAsk}
          level={level}
          setLevel={setLevel}
          onGenerate={onGenerate}
          onOpenLesson={openLesson}
          onSeeAll={() => navigate({ name: 'library' })}
          onRecord={() => setRecordOpen(true)}
        />
      )}

      {route.name === 'library' && (
        <Library
          lessons={lessons}
          drafts={drafts}
          importError={importError}
          onOpenLesson={openLesson}
          onEditLesson={(id) => navigate({ name: 'edit', id })}
          onShareLesson={(id) => void shareLesson(id)}
          onImport={() => void importLesson()}
          onImportText={(text, name) => void importLesson({ text, name })}
          onDismissImportError={() => setImportError(null)}
          onRetryDraft={(id) => void api.record.retryDraft(id)}
          onDeleteDraft={(id) => {
            void api.record.deleteDraft(id).then(refreshDrafts)
          }}
          onRecord={() => setRecordOpen(true)}
        />
      )}

      {route.name === 'generating' && (
        <Generating
          ask={ask}
          raw={genRaw}
          status={genStatus}
          error={genError}
          lesson={generated}
          onCancel={() => void onCancelGenerate()}
          onOpen={() => {
            if (generated) {
              setLesson(generated)
              genOpRef.current = null
              navigate({ name: 'lesson', id: generated.id })
            }
          }}
          onRetry={onGenerate}
          onHome={() => {
            genOpRef.current = null
            navigate(HOME)
          }}
        />
      )}

      {route.name === 'lesson' && routeLesson && (
        <LessonOverview
          lesson={routeLesson}
          shareNote={shareNote}
          startPinned={settings?.startPinned !== false}
          onStart={(isPractice, pinned) => startRun(routeLesson, isPractice, pinned)}
          onDelete={() => void deleteLesson(routeLesson.id)}
          onBack={() => navigate({ name: 'library' })}
          onEdit={() => navigate({ name: 'edit', id: routeLesson.id })}
          onDuplicate={() => void duplicateLesson(routeLesson.id)}
          onShare={() => void shareLesson(routeLesson.id)}
        />
      )}

      {route.name === 'edit' && routeLesson && !routeLesson.builtin && (
        <Editor
          key={routeLesson.id}
          lesson={routeLesson}
          onSave={saveEditedLesson}
          onBack={() => navigate({ name: 'library' })}
          onDone={() => navigate({ name: 'lesson', id: routeLesson.id })}
        />
      )}

      {route.name === 'run' && routeLesson && routeLesson.steps[runIndex] && (
        <Runner
          lesson={routeLesson}
          index={runIndex}
          hintLevel={hintLevel}
          hintsUsed={statsRef.current[runIndex]?.hintsUsed ?? 0}
          elapsed={Math.max(0, Math.round((Date.now() - stepStartRef.current) / 1000))}
          practice={practice}
          tries={tries[runIndex] ?? 0}
          floatOpen={floatOpen}
          coachOpen={coachOpen}
          pointPhase={pointPhase}
          pointResult={pointResult}
          autoPoint={!!settings?.pointAsYouGo}
          stalled={stalled}
          onPoint={() => void requestPoint()}
          onToggleAutoPoint={() => void patchSettings({ pointAsYouGo: !settings?.pointAsYouGo })}
          chat={chat}
          coachStream={coachStream}
          coachBusy={coachBusy}
          coachStatus={coachStatus}
          coachInput={coachInput}
          setCoachInput={setCoachInput}
          onSendCoach={() => void sendCoach()}
          onDone={() => advance(false)}
          onHint={takeHint}
          onSkip={() => advance(true)}
          onPrev={goPrev}
          onTried={markTried}
          onToggleFloat={() => void toggleFloat()}
          onToggleCoach={() => setCoachOpen((v) => !v)}
          onExit={() => leaveRun('lesson')}
          onLibrary={() => leaveRun('library')}
        />
      )}

      {route.name === 'review' && routeLesson && (
        <Review
          lesson={routeLesson}
          run={reviewRun}
          suggestion={suggestion}
          suggestBusy={suggestBusy}
          onSuggest={() => void onSuggestNext()}
          onUseSuggestion={(a) => {
            setAsk(a)
            navigate(HOME)
          }}
          onRunAgain={(isPractice) => startRun(routeLesson, isPractice)}
          onLibrary={() => navigate({ name: 'library' })}
          onLesson={() => navigate({ name: 'lesson', id: routeLesson.id })}
        />
      )}

      {route.name === 'settings' && (
        <SettingsScreen
          status={status}
          settings={settings}
          info={info}
          checking={checking}
          onRecheck={() => void refreshStatus(true)}
          onPatch={(p) => void patchSettings(p)}
          onBack={() => navigate(HOME)}
        />
      )}
      </main>

      <RecordStart open={recordOpen} onStart={startRecording} onClose={() => setRecordOpen(false)} />
    </div>
  )
}
