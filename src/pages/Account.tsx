import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonPage,
  IonProgressBar,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import accountService from '../services/account.service';
import billingService from '../services/billing.service';
import storageService from '../services/storage.service';
import { TIER_CONFIG } from '../types/billing.types';
import { formatFileSize, formatDate } from '../utils/format.utils';
import { billingIsOffered } from '../utils/billing.utils';
import './Account.css';

/** Typed exactly, because a destructive action reached by a single tap is one
 *  a person can take without having decided to. */
const CONFIRM_WORD = 'DELETE';

const Account: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();

  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  /* Kept apart from the deletion error rather than shared. One message for two
     buttons meant a failed portal printed itself inside the delete section, at
     the other end of the page from the thing that caused it. */
  const [billingError, setBillingError] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  /* The page used to open on a red box with a red button in it. Nothing else
     was on the screen, so the first thing this account's own settings said to
     its owner was "you can destroy this". Deleting is still two deliberate
     acts — open the section, type the word — and it now sits below what the
     page is actually for. */
  const [dangerOpen, setDangerOpen] = useState(false);
  const confirmRef = useRef<HTMLIonInputElement>(null);

  /* The button that opened the section is the button that disappears with it,
     which leaves a keyboard user's focus on <body>. It goes to the field they
     came here to fill. */
  useEffect(() => {
    /* `setFocus?.()` and not `setFocus()`: outside a browser the custom
       element never upgrades, so the ref points at a bare stub with none of
       Ionic's methods on it. */
    if (dangerOpen) void confirmRef.current?.setFocus?.();
  }, [dangerOpen]);

  const tier = profile?.tier ?? 'free';
  const limit = profile?.storage_limit ?? TIER_CONFIG.free.storage_limit;

  const { data: used } = useQuery({
    queryKey: ['storageSize', user?.id],
    queryFn: () => storageService.getUserStorageSize(user!.id),
    enabled: !!user?.id,
  });

  const usedBytes = used ?? 0;
  /* Capped at 1 for the bar only. An account can sit above its limit after a
     downgrade, and a progress bar that renders past its end looks like a bug
     rather than like the thing it is trying to say — the number beside it
     keeps telling the truth. */
  const ratio = limit > 0 ? Math.min(usedBytes / limit, 1) : 0;

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

  const handleManageBilling = async () => {
    setPortalLoading(true);
    setBillingError('');
    try {
      window.location.href = await billingService.createPortalSession();
    } catch (err) {
      setPortalLoading(false);
      setBillingError(err instanceof Error ? err.message : 'Failed to open the billing portal');
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
          <section className="account-card">
            <h2 className="account-heading">Signed in as</h2>
            <p className="account-email">{user?.email ?? '—'}</p>

            <div className="account-plan-row">
              <span className={`account-tier account-tier-${tier}`}>{TIER_CONFIG[tier].name}</span>
              {profile?.created_at && (
                <span className="account-since">Member since {formatDate(profile.created_at)}</span>
              )}
            </div>
          </section>

          <section className="account-card">
            <h2 className="account-heading">Storage</h2>

            <div className="account-storage-row">
              <span className="account-storage-used">
                {formatFileSize(usedBytes)} of {formatFileSize(limit)}
              </span>
              <span className="account-storage-percent">{Math.round(ratio * 100)}%</span>
            </div>

            <IonProgressBar
              value={ratio}
              color={usedBytes >= limit ? 'danger' : 'primary'}
              aria-label="Storage used"
            />

            {usedBytes >= limit && (
              /* The same condition that turns the bar red, so a red bar is
                 never left without a sentence explaining it. */
              <IonText color="danger">
                <p className="account-note">
                  {usedBytes > limit
                    ? `${formatFileSize(usedBytes - limit)} over the limit — uploads are blocked until you free up space.`
                    : 'Storage is full — uploads are blocked until you free up space.'}
                </p>
              </IonText>
            )}

            {/* The predicate every other billing surface asks, rather than the
                env flag underneath it: in the native shell it is false whatever
                the flag says, because App Store 3.1.1 does not allow a button
                that steers towards a purchase made anywhere but In-App
                Purchase. Without this the shell showed "See Pro" and /pricing
                sent the tap straight back to the dashboard. See ADR 0012. */}
            {billingIsOffered() &&
              (tier === 'pro' ? (
                <IonButton
                  expand="block"
                  fill="outline"
                  disabled={portalLoading}
                  onClick={handleManageBilling}
                >
                  {portalLoading ? (
                    <IonSpinner name="crescent" aria-label="Opening the billing portal" />
                  ) : (
                    'Manage billing'
                  )}
                </IonButton>
              ) : (
                <IonButton expand="block" fill="outline" onClick={() => navigate('/pricing')}>
                  See Pro
                </IonButton>
              ))}

            {billingError && (
              <IonText color="danger">
                <p className="account-note" role="alert">
                  {billingError}
                </p>
              </IonText>
            )}
          </section>

          <section
            id="account-danger"
            className={dangerOpen ? 'account-danger account-danger-open' : 'account-danger'}
          >
            {!dangerOpen ? (
              <button
                type="button"
                className="account-danger-toggle"
                aria-expanded={false}
                aria-controls="account-danger"
                onClick={() => setDangerOpen(true)}
              >
                Delete account
              </button>
            ) : (
              <>
                <h2 className="account-heading account-heading-danger">Delete account</h2>

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
                  ref={confirmRef}
                  id="delete-confirm"
                  className="account-confirm"
                  value={confirmation}
                  onIonInput={(e) => setConfirmation(e.detail.value ?? '')}
                  placeholder={CONFIRM_WORD}
                  autocapitalize="characters"
                  disabled={deleting}
                  aria-label={`Type ${CONFIRM_WORD} to confirm deleting your account`}
                />

                <div className="account-danger-actions">
                  <IonButton
                    fill="clear"
                    color="medium"
                    disabled={deleting}
                    onClick={() => {
                      setDangerOpen(false);
                      setConfirmation('');
                      setError('');
                    }}
                  >
                    Cancel
                  </IonButton>

                  <IonButton
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
                </div>
              </>
            )}

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
