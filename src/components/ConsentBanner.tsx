import { useEffect, useState, useSyncExternalStore } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { analyticsOutline } from 'ionicons/icons';
import { allowCollectors, refuseCollectors } from '../analytics/collectors';
import { collectorsConfigured, onConsentChange, questionIsOpen } from '../analytics/consent';
import { afterFirstInteraction } from '../utils/first-interaction';
import { LEGAL_URL } from '../utils/legal.utils';
import { whenLoadedAndIdle } from '../utils/when-loaded';
import './ConsentBanner.css';

/**
 * Asks whether Google Analytics and Hotjar may run. Neither does until the
 * answer is yes, so a question nobody answers is a no.
 *
 * The two buttons look alike on purpose: a no has to be as easy to give as a
 * yes, or it is not much of a question. It is not a modal either; the app can
 * be used with it open.
 *
 * It appears once the page has loaded and the visitor has first done
 * something there. Not sooner, because a block of text appearing on its own
 * a few seconds in can be counted as the login page's largest paint, the one
 * figure that page was made faster for (`utils/first-interaction.ts`).
 */
export const ConsentBanner: React.FC = () => {
  const [ready, setReady] = useState(false);
  const open = useSyncExternalStore(onConsentChange, questionIsOpen);

  useEffect(() => {
    let mounted = true;
    let stop = () => {};
    whenLoadedAndIdle(() => {
      if (!mounted) return;
      stop = afterFirstInteraction(() => mounted && setReady(true));
    });
    return () => {
      mounted = false;
      stop();
    };
  }, []);

  if (!ready || !open || !collectorsConfigured()) return null;

  return (
    <aside className="consent-banner" aria-labelledby="consent-banner-title">
      <div className="consent-banner__text">
        <p id="consent-banner-title" className="consent-banner__title">
          <IonIcon icon={analyticsOutline} aria-hidden="true" />
          Analytics cookies
        </p>
        <p className="consent-banner__body">
          May Google Analytics and Hotjar see how the app is used? It works the same without them.{' '}
          <a href={LEGAL_URL.privacy} target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
        </p>
      </div>
      <div className="consent-banner__actions">
        <IonButton fill="outline" onClick={() => refuseCollectors()}>
          Decline
        </IonButton>
        <IonButton fill="outline" onClick={() => allowCollectors()}>
          Accept
        </IonButton>
      </div>
    </aside>
  );
};
