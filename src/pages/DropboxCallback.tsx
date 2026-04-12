import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IonContent, IonPage, IonSpinner, IonText } from '@ionic/react';
import dropboxAuthService from '../services/dropbox-auth.service';

const DropboxCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('No authorization code received');
      return;
    }

    dropboxAuthService
      .handleCallback(code)
      .then(() => {
        navigate('/upload', { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to connect Dropbox');
      });
  }, [searchParams, navigate]);

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
              <IonSpinner style={{ width: '48px', height: '48px' }} />
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
