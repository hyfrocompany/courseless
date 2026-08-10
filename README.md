# Courseless

**Stop taking courses. Start doing things.**

Courseless is a desktop app that turns "I want to be able to do X" into a step-by-step guided path
through the real task in the real app. No videos, no course player: an AI engine generates the
lesson on demand, a small always-on-top coach pins over your work, an animated pointer shows you
exactly where to click on your actual screen, and your improvement is measured honestly (hints
needed, not watch time).

- **Ask anything**, like "close the month in NetSuite" or "make my first git commit", and get a
  runnable 8 to 12 step lesson in about 40 seconds, with observable checkpoints ("You should
  see…"), a 3-level hint ladder, and guidance that deliberately fades as you progress.
- **Pinned by default.** Starting a lesson minimizes the app and pins a compact coach widget over
  your work. The full window is one keypress away (Esc).
- **On-screen pointing.** Press `P` and an animated ghost cursor flies to the exact UI element the
  step refers to (accessibility-tree grounding with a vision fallback). It points, it never clicks
  for you, and it declines honestly rather than guess.
- **A coach, not a narrator.** Stuck? `C` opens a chat that knows your lesson and your current
  step. Silent by default; a voice toggle exists in Settings.
- **Record and share.** Record a walkthrough of your own workflow by marking moments
  (`Ctrl+Shift+M`), let the engine compile the marks into a lesson written for a chosen audience
  ("new sales hires", "my mom"), polish it in the step editor, then export a `.courseless.json`
  file a colleague can import and run, with pointing working on *their* machine.
- **27-lesson starter library** across ten tracks (Claude Code, Codex CLI, AI at work, Excel,
  Figma, Salesforce, NetSuite, Notion, Creative, First week).
- **Yours on this machine.** Lessons and settings are plain JSON in your user folder, and nothing
  you make is stored anywhere else. Building a lesson, coaching and pointing go through the
  Courseless engine service, which is what the account is for.

---

## Download

| | |
|---|---|
| macOS | [Courseless.dmg](https://github.com/hyfrocompany/courseless/releases/latest/download/Courseless.dmg) |
| Windows | [Courseless-Setup.exe](https://github.com/hyfrocompany/courseless/releases/latest/download/Courseless-Setup.exe) |

Both are also on [courseless.hyfro.org](https://courseless.hyfro.org) and on the
[releases page](https://github.com/hyfrocompany/courseless/releases). The app updates itself: new
versions download quietly in the background and are in place the next time you start it.

The Mac build is signed and notarized, so it opens normally. The Windows build is not signed yet,
so SmartScreen shows a "Windows protected your PC" banner on first run: choose *More info*, then
*Run anyway*.

## Requirements

| What | Why |
|---|---|
| **macOS 14+ or Windows 10/11** | Pointing and recording read the operating system's accessibility tree, which means the macOS Accessibility and Screen Recording permissions or the Windows UIA/MSAA APIs. macOS builds are universal (Apple silicon and Intel); Windows is x64. |
| **A Courseless account** | Building lessons, the coach and screen-reading for the pointer all run through the Courseless engine service. Signing in happens in your browser; the app pairs with the tab and never sees your password. The engine layer stays deliberately abstracted (`EngineService`) and the UI is provider-neutral. |

Nothing else is needed. There is no runtime to install and no configuration file to write.

On macOS, the first run walks through the two permissions pointing needs. Grant them in System
Settings and come back; the app polls and notices.

## Using it

| Key | Where | Does |
|---|---|---|
| `Space` | runner / pinned widget | Did it, advance to the next step |
| `H` | runner / widget | Take a hint (3 levels, escalating; counted honestly) |
| `P` | runner / widget | Show me, the pointer flies to the target on screen |
| `C` | runner / widget | Coach chat about the current step |
| `S` | runner / widget | Skip the step |
| `Esc` | widget / runner | Expand widget back to the window, or go back |
| `Ctrl+Shift+Space` | anywhere | Summon Courseless (toggles the widget during a run) |
| `Ctrl+Shift+M` | while recording | Mark a step |

Everyday flows:

- **Learn**: Home, type what you want to be able to do, pick your level, *Teach me*. Open the
  lesson, then *Start pinned*. Do the steps in the real app; finish and the window returns with
  your Review (assistance rate, per-step timing, what to practice next).
- **Practice mode** locks hints until you have genuinely tried twice, for the second run.
- **Record for someone else**: Home, *Record your own*, name it, say who it is for, work normally
  while marking each meaningful moment, Stop. Edit the compiled steps if you like (*Edit steps*),
  then *Share…* to export a lesson file. They import it from Library, *Import*, or by dragging the
  file in.
- The one number the app cares about: **assistance rate**, hints plus twice any skips, per step.
  Watch it fall run over run.

## Developing

```
git clone https://github.com/hyfrocompany/courseless.git
cd courseless
npm install
npm run dev
```

Node.js 20 or newer. `npm run dev` occupies the terminal; stop with Ctrl+C.

Create `.env.local` at the repo root with the two public backend values and, if you are not using
production, the site the browser handoff should open:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_SITE_URL=http://localhost:3000
```

The main process reads that file at startup in development. A packaged build has no `.env.local`
next to it, so the same three values are compiled into the main bundle at build time from
`build/public-env.json`; a real environment variable of the same name still wins at runtime. None
of the three is a secret: the anon key is meant to ship in clients and every row is guarded by
row-level security.

Useful commands:

| | |
|---|---|
| `npm run typecheck` | TypeScript across main, preload, renderer and shared |
| `npm run build` | electron-vite production build into `out/` |
| `npm run pack:mac` / `npm run pack:win` | local installer, no upload |
| `npm run release:mac` | the macOS release by hand: signed, notarized, stapled DMG plus the updater ZIP, uploaded to the release for the current version (needs the Developer ID certificate and a `courseless-notary` keychain profile). CI normally does this |
| `npm run icons` | regenerate `build/icon.icns` and `build/icon.png` from the mark drawn in code |
| `npm run seeds` | regenerate the starter library; makes real engine calls, rarely needed |

Launching with `COURSELESS_REMOTE_DEBUG=9333 npm run dev` exposes a CDP port the test harness uses.
It also adds the harness hook `trayInvoke` to the preload bridge, which is absent otherwise.

**Never set `COURSELESS_REMOTE_DEBUG` for an end user.** A CDP port is unauthenticated total
control of the app: anything that can reach it runs arbitrary code inside the renderers, which hold
the account, billing and lesson bridge. It is a development switch, nothing in the app or the
installer sets it, and nothing should.

## Releasing

Version lives in `package.json` and nowhere else.

1. Bump the version, commit, push.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.

That is the whole release. The `release` workflow runs two jobs onto the same GitHub release:
macOS builds the universal app, signs it with the Developer ID certificate, notarizes it through
an App Store Connect API key, staples both the app and the disk image, and uploads
`Courseless.dmg`, the ZIP that electron-updater needs, and `latest-mac.yml`; Windows builds the
unsigned x64 installer and uploads `Courseless-Setup.exe` and `latest.yml`. Neither job touches
the other's files. Secrets are only ever exposed to a tag push or a manual dispatch, and there is
no `pull_request` trigger.

`npm run release:mac` does the same macOS work on a developer's Mac (Developer ID certificate in
the login keychain, a `courseless-notary` notarytool profile) and is the fallback when something
has to be built by hand.

`docs/WINDOWS-SMOKE-TEST.md` is the checklist for validating a Windows build on a real machine.

## Repo tour

```
src/main/               Electron main process
  services/EngineService.ts  engine layer (streaming SSE + one-shot calls, typed failures)
  services/AuthService.ts    the account: browser handoff, session encrypted with safeStorage
  services/PointService.ts   pointing: accessibility grounding + self-verified vision fallback
  services/LessonStore.ts    lessons/runs as JSON in the user data folder
  windows.ts                 main window, pinned widget, pointer overlay, tray, hotkey
  update.ts                  silent background updates (electron-updater)
src/preload/            contextBridge API (the renderer's only door)
src/renderer/           React + Tailwind UI (Home, Library, Runner, Editor, Review, Settings…)
src/shared/             types + typed IPC contracts shared by all three
resources/seed-lessons/ the 27 starter lessons (generated, schema-validated)
resources/uia-find.ps1  Windows accessibility grounding (find by name / element at point)
resources/screen-shot.ps1  Windows screen and window capture for the vision fallback
resources/mac/          courseless-ax: the macOS helper (AX + ScreenCaptureKit), Swift source
                        beside the universal binary it builds into
supabase/               the engine service: edge functions, schema, row-level security
web/                    courseless.hyfro.org (Next.js): the site, pricing, the login handoff
build/                  packaging inputs: entitlements, the NSIS deep-link macros, icons
scripts/                release, seed generation/validation, icon and helper builds
electron-builder.yml    packaging config for both platforms
PRODUCT.md              product truth: users, positioning, pedagogy, constraints
```

## Known limitations

- Pointing targets the **primary display**; multi-monitor pointing and display scaling above 100%
  are not yet exercised.
- The pinned widget never steals focus (by design, so your typing keeps landing in the app you are
  learning), so click it once before using its keyboard shortcuts.
- The Windows installer is unsigned, which costs one SmartScreen click on first run.
- Lessons are only as truthful as the engine. Every step carries an observable checkpoint
  precisely so you can tell immediately when one is not.
