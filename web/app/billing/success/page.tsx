// Where Stripe Checkout lands after a successful subscribe (billing/index.ts sets
// success_url = `${APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`).
// The webhook is what actually grants the plan, so this page never claims to have done the work:
// it confirms, points back at the app, and gets out of the way.

import { Footer, Topbar } from '@/components/chrome'
import { CheckIcon } from '@/components/icons'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'You are upgraded on Courseless', robots: { index: false } }

export default async function BillingSuccessPage({
  searchParams
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id: sessionId } = await searchParams

  return (
    <>
      <Topbar variant="plain" />
      <main className="wrap auth-main">
        <div className="auth">
          <div className="auth-card bill-card">
            <div className="done-mark bill-mark" aria-hidden="true">
              <CheckIcon size={20} />
            </div>
            <h1 className="done-title">That is it. You are upgraded.</h1>
            <p className="note bill-note">
              Payment went through and your new plan is already on your account. Open Courseless, and the next lesson
              you start runs on it.
            </p>

            <a className="btn ocean block bill-cta" href="courseless://signed-in">
              Open Courseless
            </a>
            <Link className="btn block bill-alt" href="/account">
              See your account
            </Link>

            {sessionId ? (
              <p className="bill-ref" title={sessionId}>
                <span>receipt</span>
                <code className="mono">{shortRef(sessionId)}</code>
              </p>
            ) : null}
          </div>

          <p className="note bill-foot">
            A receipt is on its way by email. You can change or cancel your plan any time from{' '}
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

/** `cs_live_a1MZ28Hkq…mDv1qhAy` — enough to quote in a support email, short enough to read. */
function shortRef(id: string): string {
  return id.length > 24 ? `${id.slice(0, 14)}…${id.slice(-8)}` : id
}
