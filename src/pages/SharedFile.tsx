import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonSpinner,
  IonText,
  IonButton,
  IonIcon,
  IonHeader,
  IonToolbar,
  IonTitle,
} from '@ionic/react';
import { cloudDownloadOutline, documentOutline, lockClosedOutline } from 'ionicons/icons';
import { formatFileSize } from '../utils/format.utils';
import './SharedFile.css';

interface SharedFile {
  name: string;
  size: number;
  type: string;
  downloadUrl: string;
}

/**
 * The page a share link opens. Public by design — the token in the URL is the
 * only credential, so this route sits outside PrivateRoute.
 */
const SharedFilePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [file, setFile] = useState<SharedFile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/share?token=${encodeURIComponent(token ?? '')}`);
        const body = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setError(body.message || 'This link cannot be opened');
        } else {
          setFile(body as SharedFile);
        }
      } catch {
        if (!cancelled) setError('Could not reach the server. Check your connection.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonTitle>Shared file</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="ion-padding">
        <div className="shared-file">
          {loading && (
            <div className="shared-file__state">
              <IonSpinner />
            </div>
          )}

          {!loading && error && (
            <div className="shared-file__state">
              <IonIcon icon={lockClosedOutline} className="shared-file__icon" aria-hidden="true" />
              <IonText>
                <h2>Link unavailable</h2>
                <p className="shared-file__message">{error}</p>
              </IonText>
              <IonButton fill="outline" routerLink="/login">
                Go to Cloud Storage
              </IonButton>
            </div>
          )}

          {!loading && file && (
            <div className="shared-file__card">
              <IonIcon icon={documentOutline} className="shared-file__icon" aria-hidden="true" />
              <IonText>
                <h2 className="shared-file__name">{file.name}</h2>
                <p className="shared-file__meta">
                  {formatFileSize(file.size)} · {file.type || 'file'}
                </p>
              </IonText>

              <IonButton
                expand="block"
                href={file.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <IonIcon icon={cloudDownloadOutline} slot="start" />
                Download
              </IonButton>

              <p className="shared-file__note">
                Shared with you through <Link to="/login">Cloud Storage</Link>. This link expires,
                and its owner can stop it from opening at any time.
              </p>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SharedFilePage;
