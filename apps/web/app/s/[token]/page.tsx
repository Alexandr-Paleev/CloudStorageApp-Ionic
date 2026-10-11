import type { Metadata, ResolvingMetadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatBytes } from '@cloud-storage/core/format';
import { describeLink, type Description } from '../../../lib/share';
import { APP_ORIGIN, SITE_NAME } from '../../../lib/site';
import { DownloadButton } from './download-button';
import styles from './share.module.css';

/**
 * The page a share link opens.
 *
 * It is rendered when it is asked for, and it is the only page of this site
 * that is. The others are written out when the site is built. This one is
 * about a link somebody can take back, so it is never kept as a page:
 * neither Next nor a CDN holds a copy of it. What is kept, for a minute, is
 * what the functions said about the link: `lib/share.ts`.
 *
 * There is no `loading.tsx` beside it, on purpose. One would send the first
 * bytes before the link has been asked about, and after that a link that
 * does not exist can no longer be answered 404.
 */
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string }>;
}

function titleOf(description: Description): string {
  switch (description.state) {
    case 'described':
      return description.file.name;
    case 'ended':
      return description.message;
    default:
      return 'A shared file';
  }
}

/** "1.2 MB · application/pdf", or the size alone for a file of no stated type. */
function measureOf({ size, type }: { size: number; type: string }): string {
  return type ? `${formatBytes(size)} · ${type}` : formatBytes(size);
}

/**
 * What a messenger shows for the link. It runs no script, and reads this.
 *
 * As a page of the app, every share link unfurled as the same card: the
 * product's name, whichever file had been shared.
 */
export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { token } = await params;
  const description = await describeLink(token);

  const title = titleOf(description);
  const summary =
    description.state === 'described'
      ? `${measureOf(description.file)}. Shared through ${SITE_NAME}.`
      : `A file shared through ${SITE_NAME}.`;

  return {
    title,
    description: summary,
    /* The address of this page is the whole of what it takes to read the
       file. It belongs in no index, whatever the link's state. The same is
       sent as a header from `next.config.ts`, and that is the one a test
       can see missing. */
    robots: { index: false, follow: false },
    /* All of it again, and not only the title. A page that sets `openGraph`
       replaces the layout's, and loses the image with it: the one beside
       the layout is handed down to a page that sets nothing, and to no
       other. */
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description: summary,
      images: (await parent).openGraph?.images ?? [],
    },
  };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  /* The second of two callers. The metadata above asked first, and both are
     given the one answer. That is also what puts the card's tags in the
     head for everybody. Next holds a page back for its metadata only when
     the reader is a crawler it knows by name, and writes the tags into the
     body for anyone else whose page was ready first. Here neither is ready
     before the other. */
  const description = await describeLink(token);

  if (description.state === 'missing') notFound();

  if (description.state === 'ended') {
    return (
      <section className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.name}>{description.message}</h1>
          <p className={styles.measure}>
            It no longer opens the file. Whoever sent it can make a new one.
          </p>
          <p className={styles.note}>
            <Link href="/">What is {SITE_NAME}?</Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        {description.state === 'described' ? (
          <>
            <p className={styles.eyebrow}>Shared with you</p>
            <h1 className={styles.name}>{description.file.name}</h1>
            <p className={styles.measure}>{measureOf(description.file)}</p>
          </>
        ) : (
          /* Nobody answered. The button below asks from the visitor's own
             browser, which is counted apart from this site, so the file can
             still be had when its name cannot. */
          <>
            <h1 className={styles.name}>A file was shared with you</h1>
            <p className={styles.measure}>
              Its name and size could not be read just now. The file itself can still be asked for.
            </p>
          </>
        )}

        {/* The address the browser asks, and not an address for the file.
            That one is signed when the button is pressed. */}
        <DownloadButton from={`${APP_ORIGIN}/api/share?token=${encodeURIComponent(token)}`} />

        <p className={styles.note}>
          Shared through <Link href="/">{SITE_NAME}</Link>. This link expires, and whoever made it
          can stop it from opening at any time.
        </p>
      </div>
    </section>
  );
}
