'use client';

import { useState } from 'react';
import { askForAddress } from '../../../lib/open-share';
import layout from '../../page.module.css';
import styles from './share.module.css';

/**
 * The one part of this site that runs in a browser because it has to.
 *
 * The address of the file is signed when a person asks for it, and it is
 * asked for from here. A page rendered on a server is rendered for every
 * messenger that unfurls the link, and an address written into it would be
 * signed for each of them.
 */
export function DownloadButton({ from }: { from: string }) {
  const [asking, setAsking] = useState(false);
  const [ended, setEnded] = useState(false);
  const [problem, setProblem] = useState('');

  async function download() {
    if (asking) return;
    setAsking(true);
    setProblem('');

    const opening = await askForAddress(from);

    /* Before the browser leaves, and not after. A file that opens in the
       tab takes this page's place, and the page that comes back with the
       Back button is this one exactly as it was left. */
    setAsking(false);

    if (opening.outcome === 'address') {
      /* In this tab. A tab of its own would have to be opened before the
         address is known, or be refused as a pop-up after it. */
      window.location.assign(opening.url);
      return;
    }

    setProblem(opening.message);
    setEnded(opening.outcome === 'ended');
  }

  return (
    <div className={styles.download}>
      {!ended && (
        /* `aria-disabled` and not `disabled`: a button that is switched off
           while it has the focus drops it, and a keyboard is then nowhere. */
        <button
          type="button"
          className={`${layout.primary} ${styles.button}`}
          aria-disabled={asking}
          onClick={download}
        >
          {asking ? 'Asking for the file…' : 'Download'}
        </button>
      )}

      {/* Always in the page, so that what is put in it later is announced. */}
      <p className={styles.problem} role="alert">
        {problem}
      </p>

      <noscript>
        <p className={styles.problem}>The download needs JavaScript, and it is switched off.</p>
      </noscript>
    </div>
  );
}
