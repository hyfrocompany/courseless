// Page chrome shared by every route, so the lockup and the footer cannot drift.

import Link from 'next/link'

export const DL_MAC = 'https://github.com/hyfrocompany/courseless/releases/latest/download/Courseless.dmg'
export const DL_WIN = 'https://github.com/hyfrocompany/courseless/releases/latest/download/Courseless-Setup.exe'
export const REPO = 'https://github.com/hyfrocompany/courseless'

/** The app's own lockup: lowercase Manrope 700 plus the ocean dot (components/Nav.tsx). */
export function Wordmark() {
  return (
    <Link className="wordmark" href="/">
      <span>courseless</span>
      <i aria-hidden="true" />
    </Link>
  )
}

export function Topbar({ variant = 'landing' }: { variant?: 'landing' | 'plain' }) {
  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <Wordmark />
        <nav className="topnav" aria-label="Main">
          {variant === 'landing' ? (
            <>
              <a className="hide-sm" href="#how">
                How it works
              </a>
              <a className="hide-sm" href="#doing">
                In the app
              </a>
              <a href="#pricing">Pricing</a>
              <Link href="/login">Sign in</Link>
              <a className="btn primary" href="#get">
                Download
              </a>
            </>
          ) : (
            <>
              <Link href="/#pricing">Pricing</Link>
              <Link className="btn primary" href="/#get">
                Download
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <Wordmark />
        <nav aria-label="Footer">
          <a href={DL_MAC}>macOS</a>
          <a href={DL_WIN}>Windows</a>
          <Link href="/login">Sign in</Link>
          <a href={REPO}>GitHub</a>
        </nav>
        <p className="said">Yours, on this machine.</p>
      </div>
    </footer>
  )
}
