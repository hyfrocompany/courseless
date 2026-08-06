import { useState } from 'react'
import type { CodexStatus } from '../../../shared/types'
import { Wordmark } from '../components/Nav'
import { TitleBarStrip } from '../components/WindowControls'
import { Button, Eyebrow, Icon, Mono } from '../components/ui'
import { copyText } from '../lib/system'

const COMMANDS = ['npm i -g @openai/codex', 'codex login']

function CommandBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-3 rounded-sm bg-sunken px-3.5 py-2.5">
      <Mono className="select-all text-[12.5px] text-ink-900">
        <span className="mr-2 text-ink-400">$</span>
        {cmd}
      </Mono>
      <button
        type="button"
        onClick={async () => {
          if (await copyText(cmd)) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }
        }}
        className="ml-auto shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-500 transition-colors duration-150 hover:text-ink-900"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

export function FirstRun({
  status,
  checking,
  onRecheck,
  onContinue
}: {
  status: CodexStatus | null
  checking: boolean
  onRecheck(): void
  onContinue(): void
}) {
  const ready = !!status?.loggedIn

  return (
    <div
      data-testid="view-firstrun"
      className="flex min-h-screen items-center justify-center px-8 py-14"
      style={{
        backgroundImage:
          'radial-gradient(70% 55% at 50% -10%, color-mix(in oklab, var(--c-accent) 12%, transparent), transparent 70%)'
      }}
    >
      {/* no Nav here, so first-run carries its own drag strip + window controls */}
      <TitleBarStrip />

      <div className="rise w-full max-w-[520px] rounded-lg bg-surface p-8 ring-hairline shadow-lift">
        <Wordmark />
        <h1 className="mt-6 font-display text-[34px] leading-[1.06] tracking-[-0.03em] text-ink-900">
          Courses are over.
        </h1>
        <p className="mt-3 max-w-[50ch] text-[14px] leading-relaxed text-ink-500">
          Courseless turns anything you want to be able to do into a step-by-step path through the real app — built
          on demand by an AI you already have. Nothing leaves this machine.
        </p>

        <div className="mt-6 rounded-md bg-paper p-4 ring-hairline">
          {checking ? (
            <div className="flex items-center gap-3">
              <span className="pulse-dot h-[9px] w-[9px] rounded-full bg-ocean-500" />
              <span className="text-[13.5px] text-ink-700">Looking for a local AI engine</span>
            </div>
          ) : ready ? (
            <div className="flex items-center gap-3">
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-success text-white">
                {Icon.check({ size: 13 })}
              </span>
              <div>
                <div className="text-[13.5px] font-medium text-ink-900">Engine connected</div>
                <Mono className="text-[11px] text-ink-500">
                  {status?.version ?? ''} · {status?.model ?? 'default model'}
                </Mono>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="h-[9px] w-[9px] rounded-full bg-warn" />
                <span className="text-[13.5px] font-medium text-ink-900">
                  {status?.installed ? 'Codex is installed but not signed in' : 'Codex not found on this machine'}
                </span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-ink-500">
                Run these two commands in a terminal, then re-check. A ChatGPT plan is enough — no API key.
              </p>
              <div className="mt-3 space-y-2">
                {COMMANDS.map((c) => (
                  <CommandBlock key={c} cmd={c} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {ready ? (
            <Button data-testid="firstrun-continue" onClick={onContinue}>
              Open the library {Icon.arrowRight({ size: 15 })}
            </Button>
          ) : (
            <>
              <Button data-testid="firstrun-recheck" onClick={onRecheck} disabled={checking}>
                {Icon.refresh({ size: 15 })} Re-check
              </Button>
              <Button variant="quiet" data-testid="firstrun-skip" onClick={onContinue}>
                Look around first
              </Button>
            </>
          )}
        </div>

        <Eyebrow tone="muted" className="mt-7">
          your pace · your screen · your coach
        </Eyebrow>
      </div>
    </div>
  )
}
