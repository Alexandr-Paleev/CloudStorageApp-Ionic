import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useAuth } from '../contexts/AuthContext';
import accountService from '../services/account.service';
import './Account.css';

/** Typed exactly, because a destructive action reached by a single tap is one
 *  a person can take without having decided to. */
const CONFIRM_WORD = 'DELETE';

const Account: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await accountService.deleteAccount();
      /* replace, not push: the back button must not lead to a dashboard
         belonging to an account that no longer exists. */
      navigate('/login', { replace: true });
    } catch (err) {
      setDeleting(false);
      setError(err instanceof Error ? err.message : 'Failed to delete the account');
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" />
          </IonButtons>
          <IonTitle>Account</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="account-page">
          <section>
            <h2 className="account-heading">Signed in as</h2>
            <p className="account-email">{user?.email ?? '—'}</p>
          </section>

          <section className="account-danger">
            <h2 className="account-heading">Delete account</h2>

            <IonText>
              <p>
                This deletes your account, every file you uploaded, your folders and every share
                link you created. It cannot be undone, and support cannot restore it.
              </p>
            </IonText>

            <label className="account-label" htmlFor="delete-confirm">
              Type <strong>{CONFIRM_WORD}</strong> to confirm
            </label>
            <IonInput
              id="delete-confirm"
              className="account-confirm"
              value={confirmation}
              onIonInput={(e) => setConfirmation(e.detail.value ?? '')}
              placeholder={CONFIRM_WORD}
              autocapitalize="characters"
              disabled={deleting}
              aria-label={`Type ${CONFIRM_WORD} to confirm deleting your account`}
            />

            <IonButton
              expand="block"
              color="danger"
              disabled={confirmation !== CONFIRM_WORD || deleting}
              onClick={handleDelete}
            >
              {deleting ? (
                <IonSpinner name="crescent" aria-label="Deleting" />
              ) : (
                'Delete my account'
              )}
            </IonButton>

            {error && (
              <IonText color="danger">
                <p role="alert">{error}</p>
              </IonText>
            )}
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Account;
