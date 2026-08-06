# Courseless

**Stop taking courses. Start doing things.**

Courseless is a Windows desktop app that turns "I want to be able to do X" into a
step-by-step guided path through the real task in the real app. No videos, no course
player: an AI engine generates the lesson on demand, a small always-on-top coach pins
over your work, an animated pointer shows you exactly where to click on your actual
screen, and your improvement is measured honestly (hints needed, not watch time).

- **Ask anything** — "close the month in NetSuite", "make my first git commit" — and get
  a runnable 8–12 step lesson in ~40 seconds, with observable checkpoints ("You should
  see…"), a 3-level hint ladder, and guidance that deliberately fades as you progress.
- **Pinned by default** — starting a lesson minimizes the app and pins a compact coach
  widget over your work. The full window is one keypress away (Esc).
- **On-screen pointing** — press `P` and an animated ghost cursor flies to the exact UI
  element the step refers to (accessibility-tree grounding with a vision fallback; it
  points, it never clicks for you, and it declines honestly rather than guess).
- **A coach, not a narrator** — stuck? `C` opens a chat that knows your lesson and your
  current step. Silent by default; a voice toggle exists in Settings.
- **Record & share** — record a walkthrough of your own workflow by marking moments
  (`Ctrl+Shift+M`), let the engine compile the marks into a lesson written for a chosen
  audience ("new sales hires", "my mom"), polish it in the step editor, then export a
  `.courseless.json` file a colleague can import and run — with pointing working on
  *their* machine.
- **27-lesson starter library** across ten tracks (Claude Code, Codex CLI, AI at work,
  Excel, Figma, Salesforce, NetSuite, Notion, Creative, First week).
- **Local-first** — lessons and settings are plain JSON in your user folder. No account,
  no server, no telemetry, and the app never holds an API key.

---

## Requirements

| What | Why |
|---|---|
| **Windows 10/11** | The pointing overlay and recorder use Windows accessibility APIs (UIA/MSAA). The rest of the app is cross-platform Electron, but Windows is the supported target today. |
| **Node.js 20+ and npm** | Build/run tooling. |
| **OpenAI Codex CLI, signed in** | The current lesson/coach engine. A ChatGPT plan is enough — no API key. The engine layer is deliberately abstracted (`CodexService`) and the UI is provider-neutral; swapping in a hosted LLM API later is a backend-only change. |

Set up the engine (one time):

```
npm install -g @openai/codex
codex login
```

`codex login status` should say you are logged in. The app checks this itself on first
run and walks you through it if anything is missing.

## Run it

```
git clone https://github.com/hyfrocompany/courseless.git
cd courseless
npm install
npm run dev
```

That's it. First launch imports the starter library and shows a first-run screen with
live engine detection. Ask for something you want to learn, or open the Library.

> The dev server occupies the terminal; stop with Ctrl+C. There is no packaged
> installer yet — `npm run dev` is the supported way to run the app today.

## Using it

| Key | Where | Does |
|---|---|---|
| `Space` | runner / pinned widget | Did it — advance to the next step |
| `H` | runner / widget | Take a hint (3 levels, escalating; counted honestly) |
| `P` | runner / widget | Show me — the pointer flies to the target on screen |
| `C` | runner / widget | Coach chat about the current step |
| `S` | runner / widget | Skip the step |
| `Esc` | widget / runner | Expand widget back to the window / go back |
| `Ctrl+Shift+Space` | anywhere | Summon Courseless (toggles the widget during a run) |
| `Ctrl+Shift+M` | while recording | Mark a step |

Everyday flows:

- **Learn**: Home → type what you want to be able to do → pick your level → *Teach me*.
  Open the lesson → *Start pinned*. Do the steps in the real app; finish and the window
  returns with your Review (assistance rate, per-step timing, what to practice next).
- **Practice mode** locks hints until you've genuinely tried twice — for the second run.
- **Record for someone else**: Home → *Record your own* → name it, say who it's for →
  work normally, marking each meaningful moment → Stop. Edit the compiled steps if you
  like (*Edit steps*), then *Share…* to export a lesson file. They import it from
  Library → *Import* (or drag the file in).
- The one number the app cares about: **assistance rate** — hints plus twice any skips,
  per step. Watch it fall run over run.

## Repo tour

```
src/main/               Electron main process
  services/CodexService.ts   engine layer (codex app-server JSON-RPC + exec fallback)
  services/PointService.ts   pointing: UIA/MSAA grounding + self-verified vision fallback
  services/LessonStore.ts    lessons/runs as JSON in %APPDATA%/courseless
  windows.ts                 main window, pinned widget, pointer overlay, tray, hotkey
src/preload/            contextBridge API (the renderer's only door)
src/renderer/           React + Tailwind UI (Home, Library, Runner, Editor, Review…)
src/shared/             types + typed IPC contracts shared by all three
resources/seed-lessons/ the 27 starter lessons (generated, schema-validated)
resources/uia-find.ps1  accessibility grounding helper (find by name / element at point)
scripts/                seed generation/validation harness (`npm run seeds` — makes
                        real engine calls; you rarely need it)
PRODUCT.md              product truth: users, positioning, pedagogy, constraints
```

Useful commands: `npm run typecheck`, `npm run build`. Launching with
`COURSELESS_REMOTE_DEBUG=9333 npm run dev` exposes a CDP port the test harness uses.

## Known limitations

- Pointing targets the **primary display**; multi-monitor pointing and >100% DPI
  scaling are not yet exercised.
- The pinned widget never steals focus (by design, so your typing keeps landing in the
  app you're learning) — click it once before using its keyboard shortcuts.
- No packaged installer yet. Before building one: null the `codexThreadId` fields in
  `resources/seed-lessons/` and remove the `app:tray-invoke` debug IPC.
- Lessons are only as truthful as the engine; every step carries an observable
  checkpoint precisely so you can tell immediately when one isn't.
