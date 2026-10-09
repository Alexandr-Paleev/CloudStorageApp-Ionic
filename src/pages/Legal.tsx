import { useEffect } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { isNative } from '../native/shell';
import { LEGAL_URL, type LegalDocument } from '../utils/legal.utils';
import './Legal.css';

const TITLES: Record<LegalDocument, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

/**
 * What is left in the app at `/terms` and `/privacy`: a way on to the site,
 * where the two documents are pages now.
 *
 * The app used to render them here, from markdown, once its JavaScript had
 * run. A reader that runs none was given an empty shell, which is why two
 * static copies were kept beside it. On the site they are in the HTML.
 *
 * Most requests for these addresses never get here: `vercel.json` redirects
 * them before a byte of the app is served. The ones that do get here are a
 * browser this app's service worker controls, which is given the shell for
 * every navigation, and the native shells, which have no server in front of
 * them.
 *
 * A browser is sent straight on. A native shell is left where it is: its
 * window is the app and not a browser, and what that window shows is not
 * for this page to replace. There the page shows the link and waits.
 */
const Legal: React.FC<{ document: LegalDocument }> = ({ document }) => {
  const url = LEGAL_URL[document];

  useEffect(() => {
    if (!isNative()) window.location.replace(url);
  }, [url]);

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <p className="legal-moved" data-testid={`legal-${document}`}>
          The {TITLES[document]} is at{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
          .
        </p>
      </IonContent>
    </IonPage>
  );
};

export default Legal;
