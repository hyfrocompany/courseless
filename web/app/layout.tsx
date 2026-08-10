import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://courseless.hyfro.org'),
  alternates: {
    canonical: 'https://courseless.hyfro.org'
  },
  title: 'Courseless: stop taking courses, start doing things',
  description:
    'Courseless is a desktop coach. Say what you want to be able to do, and it walks you through the real task in the real app: a pinned coach over your work, a pointer that shows you where, and an honest measure of how much help you needed.',
  // The icons come from the file convention: app/icon.svg (the app's own C mark, vector, so it
  // survives a 16px tab) and app/apple-icon.png. The old entry here was a blank gradient square.
  openGraph: {
    title: 'Courseless: stop taking courses, start doing things',
    description:
      'A desktop coach that walks you through the real task in the real app: a pinned coach over your work, a pointer that shows you where, and an honest measure of how much help you needed.',
    url: 'https://courseless.hyfro.org',
    siteName: 'Courseless',
    locale: 'en_US',
    type: 'website'
  },
  // Without this a shared link renders as a title and a line of grey text. app/opengraph-image.png
  // supplies the picture; this asks every client to show it full width rather than as a thumbnail.
  twitter: {
    card: 'summary_large_image',
    title: 'Courseless: stop taking courses, start doing things',
    description:
      'A desktop coach that walks you through the real task in the real app: a pinned coach over your work, a pointer that shows you where, and an honest measure of how much help you needed.'
  }
}

// One surface, the app's own paper. The site does not follow the OS into dark.
export const viewport: Viewport = { themeColor: '#f7f9fb', colorScheme: 'light' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" as="font" type="font/woff2" href="/fonts/newsreader-latin-400-normal.woff2" crossOrigin="" />
        <link rel="preload" as="font" type="font/woff2" href="/fonts/manrope-latin-400-normal.woff2" crossOrigin="" />
        <link rel="preload" as="font" type="font/woff2" href="/fonts/manrope-latin-600-normal.woff2" crossOrigin="" />
        <script
          // Set before first paint so the download buttons never flip emphasis in front of you.
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var n=navigator,u=n.userAgent||'',p=(n.userAgentData&&n.userAgentData.platform)||n.platform||'';var m=/Mac/i.test(p)||(/Mac OS X/i.test(u)&&!/iPhone|iPad/i.test(u));document.documentElement.dataset.os=m?'mac':'win'}catch(e){}})()"
          }}
        />
      </head>
      <body>
        {/*
          THESIS: the page is the app's own surface, so the product proves itself instead of
          describing itself. It refuses the marketing-gradient hero.
          OWN-WORLD: the renderer's tokens, ported one for one. Paper #f7f9fb, white surfaces
          inlaid with a 1px hairline, the ocean ramp as accent only, Newsreader for display,
          Manrope for text, JetBrains Mono for keys and counts. The ocean gradient appears
          only where the app puts it: lesson cover art.
          STORY: this walks me through the real task in the real app, and the mock in front of
          me is what I will see on my own screen.
          FIRST VIEWPORT: headline and two downloads at left; at right the mechanism in one
          picture, a work surface with the pointer arriving on the button the step names, the
          pinned coach, one coach exchange.
          FORM: app-surface-as-landing-page.
        */}
        {children}
      </body>
    </html>
  )
}
