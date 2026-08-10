# Windows smoke test

A one-pass check of a real installed build on a real Windows machine. Written to be followed by a
person or by an agent driving the machine: every step says what to do and what the machine should
say back. Stop at the first mismatch and record the exact text.

Target: Windows 10 (22H2) or Windows 11, x64. Nothing needs to be installed first: no Node, no
Git, no PowerShell modules. PowerShell 5.1, which ships with Windows, is what the pointing helper
uses.

**The build is self-contained.** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_SITE_URL`
are compiled into the main bundle at build time from `build/public-env.json`. There is no
`.env.local` on the test machine and there must not be one: if sign-in works, the baking worked. A
real environment variable of the same name still overrides, which is the only supported way to
point a build at a different backend.

---

## 0. Install

1. Download `Courseless-Setup.exe`:
   `https://github.com/hyfrocompany/courseless/releases/latest/download/Courseless-Setup.exe`
2. Run it. SmartScreen will show **"Windows protected your PC"**. This build is unsigned, and
   that banner is expected. Choose *More info* → *Run anyway*.
3. The installer is the two-page kind (not one-click): it offers an install directory. Accept the
   default.

**Expect**

- Default location `C:\Users\<you>\AppData\Local\Programs\Courseless` (per-user, no UAC prompt).
- `Courseless.exe` in that folder, plus `resources\seed-lessons\` (27 `.json` files),
  `resources\uia-find.ps1` and `resources\screen-shot.ps1`. If any of those three are missing,
  pointing and the starter library are broken and the rest of this document is pointless.
- A Start-menu entry and a desktop shortcut, both named **Courseless**.

## 1. Deep-link registration

Before launching the app, in a normal (non-elevated) Command Prompt:

```
reg query "HKCU\Software\Classes\courseless" /s
```

**Expect** four values, and in particular:

```
HKEY_CURRENT_USER\Software\Classes\courseless
    (Default)    REG_SZ    URL:Courseless Protocol
    URL Protocol REG_SZ
HKEY_CURRENT_USER\Software\Classes\courseless\DefaultIcon
    (Default)    REG_SZ    ...\Courseless.exe,0
HKEY_CURRENT_USER\Software\Classes\courseless\shell\open\command
    (Default)    REG_SZ    "...\Courseless.exe" "%1"
```

The `"%1"` must be quoted. If the key is absent the NSIS macro in `build/installer.nsh` did not
run; the app also re-registers it on every launch, so re-check after step 2 before concluding
anything.

## 2. First launch

Launch from the Start menu.

**Expect**

- A window with the custom title bar, on the first-run walkthrough: what Courseless is, then
  signing in. The permissions page is macOS-only and must **not** appear on Windows.
- A tray icon (the blue "C" tile).
- The starter library imported: Library shows **27 lessons** across ten tracks.
- Settings → About shows `Courseless 0.1.0` with no `· dev`.
- Settings → the data row points at `C:\Users\<you>\AppData\Roaming\courseless`, and
  `courseless-main.log` exists there. The log's first line names the version and the Electron
  version.

## 3. Deep link end to end

With the app running, from Command Prompt:

```
start courseless://signed-in
```

**Expect** the Courseless window comes to the front. Nothing else changes: the link is a doorbell,
never a carrier of credentials, so a signed-out app stays signed out.

Then quit Courseless entirely (tray → Quit) and run the same command again.

**Expect** the app cold-starts and shows its window. It will be signed out if it was signed out
before; that is correct, not a bug.

## 4. Sign in through the website

Settings → account row → **Sign in** (or the first-run step).

**Expect**

- The default browser opens `https://courseless.hyfro.org/login?pair=<id>`.
- After signing in on the page, the page shows an **Open Courseless** button. Clicking it brings
  the app forward; the browser may first ask "Open Courseless?"; allow it.
- Within a few seconds the app shows the account email and the plan (**Free** on a new account).
  The app never sees the password.
- `courseless-main.log` gains a line for the pairing being redeemed.

If the app stays signed out for longer than a minute, the baked backend values are the first
suspect: check `Settings → About` and the log for
`no backend configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)`. That line means the build is
broken, not the account.

## 5. Billing status

Settings, plan section.

**Expect**

- Plan reads **Free** and the three meters (lessons built, coach replies, times it looked at the
  screen) show `0 / 3`, `0 / 20`, `0 / 15` on a fresh account.
- The Pro and Max cards are present with monthly and annual prices.
- Clicking a plan opens Stripe checkout in the browser. Do not complete a purchase; just confirm
  the checkout page loads with the right plan and price, then close the tab.

## 6. Generate a lesson

Home → type something the machine can actually do, for example
`rename a file in File Explorer` → pick a level → **Teach me**.

**Expect**

- The generating screen streams progress; the whole thing finishes in roughly 40 seconds.
- The result has 8 to 12 steps, each with an instruction and a "You should see…" checkpoint.
- The lessons meter in Settings has moved to `1 / 3`.

## 7. Pinned run and hotkeys

Open the new lesson → **Start pinned**.

**Expect** the main window minimizes and a compact widget pins over everything else. Click the
widget once (it never steals focus by design), then:

| Key | Expect |
|---|---|
| `Space` | advances to the next step |
| `H` | reveals hint 1, then 2, then 3 on repeat presses |
| `S` | skips the step |
| `Esc` | the widget expands back to the full window |
| `Ctrl+Shift+Space` | toggles the widget from anywhere, including from another app |
| `Ctrl+Shift+M` | does nothing here, it only exists while a recording is running |

## 8. Pointing accuracy

Two paths have to be checked separately, because one is a fallback for the other.

**Accessibility path (UIA/MSAA).** Open File Explorer, put it in front, and press `P` on a step
whose target is a visible Explorer control.

- A ghost cursor animates to the control and a ring sits on it. It points; it never clicks.
- In `courseless-main.log`, the entry for the call names `uia-find.ps1` and reports a match.
- Sanity check the helper on its own:

  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\Courseless\resources\uia-find.ps1" -Mode windows
  ```

  **Expect** a JSON array of the open top-level windows on stdout, and nothing on stderr.

**Vision fallback.** Press `P` on a step whose target has no accessible name (a canvas, an icon in
a custom-drawn toolbar).

- The log shows the screenshot being taken (`screen-shot.ps1`) followed by a vision call.
- Either the pointer lands on the right thing, or the app says out loud that it cannot find it.
  A confident point at the wrong element is a failure; an honest refusal is a pass.
- The "times it looked at the screen" meter increments only on the vision path.

## 9. Recording, end to end

Home → **Record your own** → give it a name and an audience ("a new hire") → Start.

1. Do three or four small things in a real app, pressing `Ctrl+Shift+M` at each meaningful moment.
2. The recording pill shows the mark count going up.
3. Stop.

**Expect**

- The marks compile into a lesson on the normal generate stream, one step per mark, written for
  the audience given.
- *Edit steps* opens the editor and changes save.
- *Share…* writes `<slug>.courseless.json` where the save dialog says.
- Library → *Import* takes that file straight back in.
- After the recording ends, `Ctrl+Shift+M` is released back to the OS: press it and nothing
  Courseless-related happens.

## 10. Update path

Not testable on the first release. From 0.1.1 onward: leave the app running for a minute with an
older version installed and watch `courseless-main.log` for

```
[update] available 0.1.1
[update] downloaded and staged 0.1.1
```

Settings → About then shows **Update ready (0.1.1) — restarts to apply**. Quit and relaunch; About
shows the new version. Nothing ever prompts, and no restart happens on its own.

---

## What to report back

For each numbered section: pass, or the exact text of what appeared instead. Attach
`%APPDATA%\courseless\courseless-main.log`, the single most useful artifact for anything
that goes wrong here, and it contains no credentials.
