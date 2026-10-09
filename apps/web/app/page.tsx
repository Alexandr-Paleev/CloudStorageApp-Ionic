import type { Metadata } from 'next';
import { TIER_LIMITS } from '@cloud-storage/core/tiers';
import { APP_ORIGIN, REPOSITORY_URL } from '../lib/site';
import styles from './page.module.css';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/* The number the app enforces, read from where the app reads it. A figure
   typed into this page would be a second copy, and the limits have drifted
   between copies before. */
const FREE_MEGABYTES = TIER_LIMITS.free.storage_limit / (1024 * 1024);

const FEATURES = [
  {
    title: 'Folders, previews, and several files at once',
    body:
      'Drop a handful of files on the page and they upload one after another, each with ' +
      'its own progress. Folders nest. A PDF or an image opens in place, without a download.',
  },
  {
    title: 'A link that expires, and one you can take back',
    body:
      'Share a file by link, give the link a lifetime, or end it yourself. The server keeps ' +
      'a hash of each link and not the link, so a copy of the database is not a list of ' +
      'working links.',
  },
  {
    title: 'An app, from the browser',
    body:
      'Install it from the browser on a phone or a laptop, and it opens like any other app. ' +
      'There is nothing to download from a store.',
  },
  {
    title: `${FREE_MEGABYTES} MB without paying`,
    body:
      `A free account holds ${FREE_MEGABYTES} MB of files. It asks for no card, and it is ` +
      'not a trial that ends.',
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className={styles.hero}>
        <h1>Your files, and links to them you can take back.</h1>
        <p className={styles.lead}>
          Cloud Storage keeps files in folders, shows a PDF or an image without downloading it, and
          shares one by a link that expires or stops working when you say so. It runs in a browser
          and installs from there as an app.
        </p>
        <div className={styles.actions}>
          <a className={styles.primary} href={`${APP_ORIGIN}/login`}>
            Open the app
          </a>
          <a className={styles.secondary} href={REPOSITORY_URL}>
            Read the source
          </a>
        </div>
        <p className={styles.note}>
          Just looking? The login page opens a demo account with no sign-up. It is a real account,
          seeded with a few files and deleted after 24 hours.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="what-it-does">
        <h2 id="what-it-does">What it does</h2>
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="in-the-open">
        <h2 id="in-the-open">Built in the open</h2>
        <p className={styles.prose}>
          All of it is on GitHub under the MIT licence: the app, the functions behind it, and this
          site. The decisions that shaped it are written down next to the code, each with what it
          cost.
        </p>
        <p className={styles.prose}>
          <a href={`${REPOSITORY_URL}/tree/main/docs/decisions`}>Read the decisions</a>
        </p>
      </section>
    </>
  );
}
