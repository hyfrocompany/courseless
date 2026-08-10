// BUILD-TIME SOURCE ONLY. This route exists so the share card can be photographed from the
// real page: same tokens, same fonts, same mock of the running app, so the embed can never
// drift from what the visitor lands on. Rendered at 1200x630, captured to app/opengraph-image.png,
// and then this route is deleted before shipping.

import { HeroStage } from '@/components/mocks'
import type { Metadata } from 'next'

// Kept in the tree, kept out of search: the card can be re-shot from the real design system
// after any change to the hero, instead of decaying into a stale screenshot nobody can rebuild.
export const metadata: Metadata = { title: 'Share card source', robots: { index: false, follow: false } }

export default function OgSource() {
  return (
    <div className="og">
      <div className="og-left">
        <p className="og-mark">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <linearGradient id="cl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0B2942" />
                <stop offset="1" stopColor="#0B96EA" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14.08" fill="url(#cl)" />
            <path
              d="M45.868 42.836 A17.6 17.6 0 1 1 45.868 21.164"
              fill="none"
              stroke="#fff"
              strokeWidth="8.96"
            />
          </svg>
          <span>courseless</span>
        </p>
        <h1>
          Stop taking courses.<span>Start doing things.</span>
        </h1>
        <p className="og-sub">
          A desktop coach that walks you through the real task, in the real app, and shows you where to click next.
        </p>
      </div>
      <div className="og-right">
        <HeroStage />
      </div>
    </div>
  )
}
