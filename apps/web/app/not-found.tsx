import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Not found',
};

export default function NotFound() {
  return (
    <section className={styles.hero}>
      <h1>There is no page at this address.</h1>
      <p className={styles.lead}>
        If a link brought you here, the link is wrong, or the page has moved.
      </p>
      <div className={styles.actions}>
        <Link className={styles.primary} href="/">
          Go to the first page
        </Link>
      </div>
    </section>
  );
}
