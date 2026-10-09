import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  APP_ORIGIN,
  IS_PRODUCTION,
  REPOSITORY_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from '../lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: 'summary_large_image' },
  /* A preview deployment is a draft of this site at an address nobody chose.
     Vercel already marks its responses; this says the same thing in the page. */
  robots: IS_PRODUCTION ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">
          Skip to the content
        </a>

        <header className="site-header">
          <Link className="site-header__brand" href="/">
            {SITE_NAME}
          </Link>
          {/* The links that leave this site, for the app or for GitHub, are
              plain ones. next/link is for the pages that are here. */}
          <nav aria-label="Site">
            <Link className="site-header__extra" href="/pricing">
              Pricing
            </Link>
            <a className="site-header__extra" href={REPOSITORY_URL}>
              Source
            </a>
            <a className="site-header__cta" href={`${APP_ORIGIN}/login`}>
              Open the app
            </a>
          </nav>
        </header>

        <main id="content">{children}</main>

        <footer className="site-footer">
          <nav aria-label="Legal and source">
            <Link href="/pricing">Pricing</Link>
            <a href={`${APP_ORIGIN}/privacy`}>Privacy</a>
            <a href={`${APP_ORIGIN}/terms`}>Terms</a>
            <a href={REPOSITORY_URL}>Source</a>
          </nav>
          <p>Open source, under the MIT licence.</p>
        </footer>
      </body>
    </html>
  );
}
