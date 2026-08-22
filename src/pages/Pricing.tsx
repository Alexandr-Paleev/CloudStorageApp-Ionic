import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonButtons,
  IonBackButton,
  IonSpinner,
  IonText,
  IonIcon,
} from '@ionic/react';
import { checkmarkCircle, lockClosed } from 'ionicons/icons';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { env } from '../env';
import { useProfile } from '../hooks/useProfile';
import billingService from '../services/billing.service';
import { TIER_CONFIG } from '../types/billing.types';
import './Pricing.css';
import './Legal.css';

const Pricing: React.FC = () => {
  const { profile, isLoading } = useProfile();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState('');

  const isPro = profile?.tier === 'pro';

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    setError('');
    try {
      const url = await billingService.createCheckoutSession();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setCheckoutLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    setError('');
    try {
      const url = await billingService.createPortalSession();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open portal');
      setPortalLoading(false);
    }
  };

  // Reachable by URL even with the header link hidden, and every button here
  // would hit a /api/stripe route that has no keys in this environment.
  if (!env.VITE_BILLING_ENABLED) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isLoading) {
    return (
      <IonPage>
        <IonContent
          className="ion-padding"
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          <IonSpinner />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" />
          </IonButtons>
          <IonTitle>Plans</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="ion-padding">
        <div className="pricing-container">
          <IonText className="pricing-heading">
            <h1>Choose your plan</h1>
            <p>Unlock more storage and premium providers</p>
          </IonText>

          <div className="pricing-cards">
            {/* Free Plan */}
            <div className={`pricing-card ${!isPro ? 'pricing-card--active' : ''}`}>
              <div className="pricing-card__header">
                <h2>Free</h2>
                <div className="pricing-card__price">
                  <span className="pricing-card__amount">$0</span>
                  <span className="pricing-card__period">/month</span>
                </div>
              </div>
              <ul className="pricing-card__features">
                {TIER_CONFIG.free.features.map((feature) => (
                  <li key={feature}>
                    <IonIcon icon={checkmarkCircle} color="success" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {!isPro && (
                <IonButton expand="block" fill="outline" disabled>
                  Current Plan
                </IonButton>
              )}
            </div>

            {/* Pro Plan */}
            <div
              className={`pricing-card ${isPro ? 'pricing-card--active' : ''} pricing-card--pro`}
            >
              <div className="pricing-card__badge">Popular</div>
              <div className="pricing-card__header">
                <h2>Pro</h2>
                <div className="pricing-card__price">
                  <span className="pricing-card__amount">$9</span>
                  <span className="pricing-card__period">/month</span>
                </div>
              </div>
              <ul className="pricing-card__features">
                {TIER_CONFIG.pro.features.map((feature) => (
                  <li key={feature}>
                    <IonIcon icon={checkmarkCircle} color="success" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {isPro ? (
                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                >
                  {portalLoading ? <IonSpinner name="crescent" /> : 'Manage Subscription'}
                </IonButton>
              ) : (
                <IonButton
                  expand="block"
                  className="premium-button"
                  onClick={handleUpgrade}
                  disabled={checkoutLoading}
                >
                  {checkoutLoading ? <IonSpinner name="crescent" /> : 'Upgrade to Pro'}
                  {!checkoutLoading && <IonIcon icon={lockClosed} slot="end" />}
                </IonButton>
              )}
            </div>
          </div>

          {error && (
            <IonText color="danger" className="pricing-error">
              <p>{error}</p>
            </IonText>
          )}

          {/* Consumer rules expect the terms to be readable before paying */}
          <p className="legal-links">
            Subscriptions renew monthly until cancelled. See our{' '}
            <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Pricing;
