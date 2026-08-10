// Where Stripe Checkout lands when someone backs out (billing/index.ts sets
// cancel_url = `${APP_URL}/billing/cancelled`). Nothing happened, so the page says exactly that
// and offers the two doors out: back to the app, or back to the plans.

import { Footer, Topbar } from '@/components/chrome'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Checkout cancelled on Courseless', robots: { index: false } }

export default function BillingCancelledPage() {
  return (
    <>
      <Topbar variant="plain" />
      <main className="wrap auth-main">
        <div className="auth">
          <div className="auth-card bill-card">
            <div className="done-mark bill-mark quiet" aria-hidden="true">
              <UndoIcon />
            </div>
            <h1 className="done-title">No charge. Nothing changed.</h1>
            <p className="note bill-note">
              You closed checkout before paying, which is completely fine. Your plan is exactly where you left it, and
              your lessons are still waiting.
            </p>

            <a className="btn ocean block bill-cta" href="courseless://signed-in">
              Back to Courseless
            </a>
            <Link className="btn block bill-alt" href="/#pricing">
              Look at the plans again
            </Link>
          </div>

          <p className="note bill-foot">
            Changed your mind halfway, or something looked wrong? Upgrading again takes one click from{' '}
            <Link className="link" href="/account">
              your account
            </Link>
            .
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}

/** A turn-back arrow: the icon family's 1.5px stroke on the same 20px box. */
function UndoIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.2h8.1a3.7 3.7 0 0 1 0 7.4H8.4" />
      <path d="M7 5.8 3.6 9.2 7 12.6" />
    </svg>
  )
}
