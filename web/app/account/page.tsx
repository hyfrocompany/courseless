import { AuthPanel } from '@/components/AuthPanel'
import { Footer, Topbar } from '@/components/chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Your Courseless account', robots: { index: false } }

export default function AccountPage() {
  return (
    <>
      <Topbar variant="plain" />
      <main className="wrap auth-main">
        <AuthPanel />
      </main>
      <Footer />
    </>
  )
}
