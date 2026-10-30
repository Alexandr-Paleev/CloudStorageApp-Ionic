import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { IonButton, IonContent, IonPage, IonText, IonIcon, IonSpinner } from '@ionic/react';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import billingService from '../services/billing.service';

/** How often the profile is read while Stripe's word is awaited. */
export const CHECK_EVERY_MS = 2000;
/** How long that goes on before the page says it has not come. */
export const GIVE_UP_AFTER_MS = 30_000;

/**
 * Where Stripe sends a person back to after paying.
 *
 * Coming back here proves nothing. Stripe sends the person here and the
 * `checkout.session.completed` event to the webhook separately, and only the
 * webhook writes the plan into the profile. This page used to say "Your
 * subscription is active" whichever had happened first, and three seconds
 * later the dashboard read the profile and kept what it found for five
 * minutes (useProfile): a person who had just paid could be shown Free, with
 * Free's limit, for that long. Now the page reads the profile until it says
 * Pro, and says what it knows.
 */
const SubscriptionSuccess: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [waitedTooLong, setWaitedTooLong] = useState(false);

  /* The same entry useProfile reads, so the dashboard finds Pro there. Asked
     again for as long as the page is open and in view, past the half minute
     too: TanStack stops the interval in a tab that is in the background. */
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => billingService.getProfile(user!.id),
    enabled: !!user?.id,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.tier === 'pro' ? false : CHECK_EVERY_MS),
  });
  const isPro = profile?.tier === 'pro';

  useEffect(() => {
    const timer = setTimeout(() => setWaitedTooLong(true), GIVE_UP_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isPro) return;
    const timer = setTimeout(() => navigate('/dashboard', { replace: true }), 3000);
    return () => clearTimeout(timer);
  }, [isPro, navigate]);

  /* Leaving before the plan has changed: the profile is read again on the
     dashboard rather than kept as Free for five minutes. */
  const goOn = () => {
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    navigate('/dashboard', { replace: true });
  };

  return (
    <IonPage>
      <IonContent
        fullscreen
        className="ion-padding"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <div role="status" style={{ textAlign: 'center', paddingTop: '30vh' }}>
          {isPro ? (
            <>
              <IonIcon
                icon={checkmarkCircleOutline}
                color="success"
                style={{ fontSize: '80px' }}
                aria-hidden="true"
              />
              <IonText>
                <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '16px 0 8px' }}>
                  Welcome to Pro!
                </h1>
                <p style={{ color: 'var(--ion-color-medium)' }}>
                  Your subscription is active. Redirecting to dashboard...
                </p>
              </IonText>
            </>
          ) : waitedTooLong ? (
            <IonText>
              <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '16px 0 8px' }}>
                Stripe has not confirmed it yet
              </h1>
              <p style={{ color: 'var(--ion-color-medium)' }}>
                It usually takes a few seconds. Your plan changes to Pro as soon as it does, and
                this page is still asking.
              </p>
              <IonButton onClick={goOn}>Go to the dashboard</IonButton>
            </IonText>
          ) : (
            <>
              <IonSpinner aria-label="Working" />
              <IonText>
                <p style={{ color: 'var(--ion-color-medium)' }}>
                  Confirming your subscription with Stripe…
                </p>
              </IonText>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SubscriptionSuccess;
