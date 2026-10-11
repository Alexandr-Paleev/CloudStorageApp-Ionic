import type { Metadata } from 'next';
import Link from 'next/link';
import layout from '../../page.module.css';
import styles from './share.module.css';

/**
 * A link that was never issued, one whose file has been deleted since, or
 * an address that could not be a link at all. All three are answered 404.
 *
 * A revoked or an expired link is not here. It was a link, and its page says
 * which of the two happened to it.
 */
export const metadata: Metadata = { title: 'No file behind this link' };

export default function LinkNotFound() {
  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.name}>There is no file behind this link.</h1>
        <p className={styles.measure}>
          The link is incomplete or mistyped, or the file has been deleted since it was shared.
        </p>
        <p className={styles.note}>
          <Link className={layout.secondary} href="/">
            Go to the first page
          </Link>
        </p>
      </div>
    </section>
  );
}
