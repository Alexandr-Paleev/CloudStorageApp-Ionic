import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IonContent, IonPage, IonSpinner, IonText } from '@ionic/react';
import dropboxAuthService from '../services/dropbox-auth.service';

const DropboxCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [exchangeError, setExchangeError] = useState('');
  const exchangeStarted = useRef(false);

  /* Whether Dropbox sent us back with a code is in the URL, and the URL is
     known while rendering. Setting it as state from inside the effect made the
     page render "Connecting..." once, then immediately re-render with the
     failure — a cascading render for a value that was never asynchronous.
     Only the exchange itself is. */
  const code = searchParams.get('code');
  const error = code ? exchangeError : 'No authorization code received';

  useEffect(() => {
    if (!code) return;
    // StrictMode runs effects twice in dev — the code may only be exchanged once
    if (exchangeStarted.current) return;
    exchangeStarted.current = true;

    dropboxAuthService
      .handleCallback(code, searchParams.get('state'))
      .then(() => {
        navigate('/upload', { replace: true });
      })
      .catch((err) => {
        setExchangeError(err instanceof Error ? err.message : 'Failed to connect Dropbox');
      });
  }, [code, searchParams, navigate]);

  return (
    <IonPage>
      <IonContent
        fullscreen
        className="ion-padding"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <div style={{ textAlign: 'center', paddingTop: '30vh' }}>
          {error ? (
            <IonText color="danger">
              <h2>Connection failed</h2>
              <p>{error}</p>
            </IonText>
          ) : (
            <>
              <IonSpinner
                style={{ width: '48px', height: '48px' }}
                aria-label="Connecting Dropbox"
              />
              <IonText>
                <p style={{ marginTop: '16px', color: 'var(--ion-color-medium)' }}>
                  Connecting Dropbox...
                </p>
              </IonText>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default DropboxCallback;
