import { useState } from 'react'
import type { CodexStatus, Settings as SettingsType } from '../../../shared/types'
import type { AppInfo } from '../../../shared/ipc'
import { Breadcrumb, BreadcrumbBar } from '../components/Breadcrumb'
import { Button, Eyebrow, Icon, Kbd, Mono } from '../components/ui'
import { copyText, openInExplorer, prettyHotkey } from '../lib/system'

/** A labelled on/off switch. Reads as a switch, not a checkbox — these change app behaviour. */
function Toggle({
  on,
  onChange,
  label,
  testid
}: {
  on: boolean
  onChange(next: boolean): void
  label: string
  testid: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testid}
      onClick={() => onChange(!on)}
      className="group inline-flex items-center gap-3 text-left"
    >
      <span
        className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 ease-out ${
          on ? 'bg-fill' : 'bg-ink-300'
        }`}
      >
        <span
          className="absolute h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_3px_rgb(14_26_34/0.35)] transition-[left] duration-200 ease-out"
          style={{ left: on ? 19 : 3 }}
        />
      </span>
      <span className="text-[13.5px] text-ink-700 transition-colors duration-150 group-hover:text-ink-900">
        {label}
      </span>
    </button>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,190px)_1fr] gap-x-8 gap-y-2 border-b border-line-2 py-5 last:border-b-0">
      <div>
        <div className="text-[13.5px] font-semibold text-ink-900">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function SettingsScreen({
  status,
  settings,
  info,
  checking,
  onRecheck,
  onPatch,
  onBack
}: {
  status: CodexStatus | null
  settings: SettingsType | null
  info: AppInfo | null
  checking: boolean
  onRecheck(): void
  onPatch(patch: Partial<SettingsType>): void
  onBack(): void
}) {
  const [hotkey, setHotkey] = useState(settings?.hotkey ?? '')
  const [model, setModel] = useState(settings?.model ?? '')
  const [displayName, setDisplayName] = useState(settings?.displayName ?? '')
  const [copied, setCopied] = useState('')

  async function copy(value: string, key: string): Promise<void> {
    if (await copyText(value)) {
      setCopied(key)
      setTimeout(() => setCopied(''), 1600)
    }
  }

  return (
    <>
      <BreadcrumbBar>
        <Breadcrumb root="Home" current="Settings" onRoot={onBack} />
      </BreadcrumbBar>

      <div data-testid="view-settings" className="mx-auto w-full max-w-[760px] px-8 pb-16 pt-7">
      <Eyebrow>Settings</Eyebrow>
      <h1 className="mt-1.5 font-display text-[28px] leading-tight tracking-[-0.03em]">Yours, on this machine.</h1>
      <p className="mt-2 max-w-[62ch] text-[13.5px] text-ink-500">
        No account, no server, no telemetry. Lessons are plain JSON files in a folder you own.
      </p>

      <div className="mt-7">
        <Row label="Engine" hint="The local AI that builds and coaches your lessons. Courseless never holds an API key.">
          <div className="rounded-md bg-surface p-4 ring-hairline">
            <div className="flex items-center gap-2.5">
              <span
                className={`h-[8px] w-[8px] rounded-full ${
                  checking ? 'bg-ink-300 pulse-dot' : status?.loggedIn ? 'bg-success' : 'bg-warn'
                }`}
              />
              <span className="text-[13.5px] font-medium text-ink-900">
                {checking
                  ? 'Checking'
                  : status?.loggedIn
                    ? 'Connected'
                    : status?.installed
                      ? 'Installed, not signed in'
                      : 'No engine found'}
              </span>
              <Button variant="ghost" size="sm" data-testid="recheck-btn" onClick={onRecheck} className="ml-auto">
                {Icon.refresh({ size: 14 })} Re-check
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[11px] text-ink-500">
              <div className="flex justify-between gap-3 border-b border-line-2 pb-1.5">
                <dt>version</dt>
                <dd data-testid="status-installed" className="text-ink-700">
                  {status?.version ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line-2 pb-1.5">
                <dt>model</dt>
                <dd data-testid="status-model" className="truncate text-ink-700">
                  {status?.model ?? 'default'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>transport</dt>
                <dd data-testid="status-transport" className="text-ink-700">
                  {status?.transport ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>signed in</dt>
                <dd className="text-ink-700">{status?.loggedIn ? 'yes' : 'no'}</dd>
              </div>
            </dl>
            {status?.error && <p className="mt-3 text-[13px] text-warn">{status.error}</p>}
          </div>
        </Row>

        <Row label="Model override" hint="Leave empty to use the engine's default.">
          <input
            data-testid="settings-model"
            value={model}
            placeholder="gpt-5.6-sol"
            spellCheck={false}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => onPatch({ model: model.trim() || null })}
            className="h-10 w-full max-w-[320px] rounded-sm bg-surface px-3 font-mono text-[13px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
          />
        </Row>

        <Row
          label="Start lessons pinned"
          hint="The coach floats over your work and the window steps aside. The full window is one tap away."
        >
          <div className="flex flex-col gap-3.5">
            <Toggle
              testid="toggle-start-pinned"
              label="Pin lessons to the screen"
              on={settings?.startPinned !== false}
              onChange={(v) => onPatch({ startPinned: v })}
            />
            <p className="max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
              With this off, lessons open in the window and the lesson page offers pinning second
              instead of first. Either way, <Kbd className="h-[19px] px-1.5 text-[10.5px]">Esc</Kbd>{' '}
              in the widget brings the window back, and the runner can pin mid-lesson.
            </p>
          </div>
        </Row>

        <Row
          label="Pointing"
          hint="A ghost cursor flies to the thing the step is about. It points — it never clicks for you."
        >
          <div className="flex flex-col gap-3.5">
            <Toggle
              testid="toggle-point"
              label="Point as I go"
              on={!!settings?.pointAsYouGo}
              onChange={(v) => onPatch({ pointAsYouGo: v })}
            />
            <p className="max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
              With this off, pointing happens only when you ask — the <Kbd className="h-[19px] px-1.5 text-[10.5px]">P</Kbd>{' '}
              key or the Show me button. Courseless first reads the element straight from Windows;
              only if that finds nothing does it look at the screen.
            </p>
            <div className="rounded-sm bg-sunken p-3 text-[12.5px] leading-[1.5] text-ink-500">
              <span className="font-medium text-ink-700">What gets captured.</span> Your screen is
              captured only when you ask it to point and only if reading the element failed. The
              image goes to your local engine and is deleted the moment the answer comes back —
              nothing is stored, nothing is uploaded by Courseless.
            </div>
          </div>
        </Row>

        <Row label="Voice" hint="Off by default. Courseless is quiet unless you ask it not to be.">
          <div className="flex flex-col gap-3.5">
            <Toggle
              testid="toggle-voice"
              label="Speak steps aloud"
              on={!!settings?.speakSteps}
              onChange={(v) => onPatch({ speakSteps: v })}
            />
            <Toggle
              testid="toggle-stall"
              label="Nudge me if I go quiet"
              on={settings?.stallCoach !== false}
              onChange={(v) => onPatch({ stallCoach: v })}
            />
            <p className="max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
              The nudge is one line in the float widget when a step has been open about three times
              longer than it should take. Once per step, never twice.
            </p>
          </div>
        </Row>

        <Row
          label="Your name on shared lessons"
          hint="Written into the file when you share one, so the person opening it knows who it came from."
        >
          <input
            data-testid="settings-display-name"
            value={displayName}
            placeholder="Dana"
            spellCheck={false}
            maxLength={60}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => onPatch({ displayName: displayName.trim() })}
            className="h-10 w-full max-w-[320px] rounded-sm bg-surface px-3 text-[13.5px] ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
          />
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
            Leave it empty and shared lessons say{' '}
            <span className="text-ink-700">“from a Courseless user”</span>. It is a label in a file
            you send — there is no account behind it and nothing is sent anywhere.
          </p>
        </Row>

        <Row label="Summon hotkey" hint="Shows the window, or toggles the float widget while a lesson is running.">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              {prettyHotkey(settings?.hotkey ?? '').map((k) => (
                <Kbd key={k} className="h-7 px-2 text-[12px]">
                  {k}
                </Kbd>
              ))}
            </div>
            <input
              data-testid="settings-hotkey"
              value={hotkey}
              spellCheck={false}
              onChange={(e) => setHotkey(e.target.value)}
              onBlur={() => hotkey.trim() && onPatch({ hotkey: hotkey.trim() })}
              className="h-10 w-full max-w-[280px] rounded-sm bg-surface px-3 font-mono text-[12px] text-ink-500 ring-hairline focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--c-focus)]"
            />
          </div>
          <p className="mt-2.5 max-w-[58ch] text-[12.5px] leading-[1.5] text-ink-500">
            While you are recording a walkthrough,{' '}
            <Kbd className="h-[19px] px-1.5 text-[10.5px]">Ctrl</Kbd>{' '}
            <Kbd className="h-[19px] px-1.5 text-[10.5px]">⇧</Kbd>{' '}
            <Kbd className="h-[19px] min-w-[19px] px-1.5 text-[10.5px]">M</Kbd> marks a moment. That
            one is fixed, and it exists only while the recording pill is on screen.
          </p>
        </Row>

        <Row label="Appearance" hint="Applies to the main window and the float widget.">
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full bg-sunken p-[3px]">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={settings?.theme === t}
                data-testid={`theme-${t}`}
                onClick={() => onPatch({ theme: t })}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-[7px] text-[13px] font-medium capitalize transition-colors duration-150 ${
                  settings?.theme === t ? 'bg-surface text-ink-900 ring-hairline' : 'text-ink-500 hover:text-ink-900'
                }`}
              >
                {t === 'light' ? Icon.sun({ size: 15 }) : Icon.moon({ size: 15 })}
                {t}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Data folder" hint="Lessons, settings and the log. Delete the folder and Courseless forgets everything.">
          <div className="rounded-sm bg-sunken p-3">
            <Mono className="block break-all text-[11.5px] text-ink-700">{info?.lessonsPath ?? '…'}</Mono>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => info && openInExplorer(info.userDataPath)}
            >
              {Icon.folder({ size: 14 })} Open folder
            </Button>
            <Button variant="ghost" size="sm" onClick={() => info && copy(info.userDataPath, 'data')}>
              {copied === 'data' ? 'Copied' : 'Copy path'}
            </Button>
          </div>
          <Mono className="mt-3 block break-all text-[11px] text-ink-400">{info?.logPath ?? ''}</Mono>
        </Row>

        <Row label="About" hint="Stop taking courses. Start doing things.">
          <Mono className="text-[11.5px] text-ink-500">
            Courseless {info?.version ?? ''} {info?.isDev ? '· dev' : ''}
          </Mono>
          <p className="mt-2.5 max-w-[54ch] font-display text-[16px] italic leading-[1.45] text-ink-700">
            When an agent does it for you, the skill stays the machine&apos;s. Keep it yours.
          </p>
        </Row>
      </div>
      </div>
    </>
  )
}
