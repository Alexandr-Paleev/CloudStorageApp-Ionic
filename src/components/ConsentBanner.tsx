import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { analyticsOutline } from 'ionicons/icons';
import { allowCollectors, refuseCollectors } from '../analytics/collectors';
import {
  collectorsConfigured,
  onConsentChange,
  questionIsOpen,
  questionWasPutAgain,
} from '../analytics/consent';
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
 *
 * Asked for, from "Cookie settings", it comes at once, whatever the page is
 * doing, and takes the focus, so that a keyboard or a screen reader is where
 * the question is; the focus goes back once it is answered. Put on its own,
 * it takes nothing: it waits for the visitor instead.
 */
export const ConsentBanner: React.FC = () => {
  const [ready, setReady] = useState(false);
  const open = useSyncExternalStore(onConsentChange, questionIsOpen);
  const askedFor = useSyncExternalStore(onConsentChange, questionWasPutAgain);
  const card = useRef<HTMLElement>(null);
  const shown = (ready || askedFor) && open && collectorsConfigured();

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

  useEffect(() => {
    if (!shown || !askedFor) return;
    const before = document.activeElement;
    card.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [shown, askedFor]);

  if (!shown) return null;

  return (
    <aside
      ref={card}
      tabIndex={-1}
      className="consent-banner"
      aria-labelledby="consent-banner-title"
    >
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
