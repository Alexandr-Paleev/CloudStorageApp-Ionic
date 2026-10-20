import { IonButton, IonButtons, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/react';
import { arrowBack, logOutOutline, personCircleOutline, rocketOutline, star } from 'ionicons/icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { billingIsOffered } from '../utils/billing.utils';

interface DashboardHeaderProps {
  /** What the bar says: the name of the folder that is open, or "My Files". */
  title: string;
  /** Goes up one folder. Absent at the root, which has nothing above it. */
  onUp?: () => void;
  /** The account's plan, which decides whether the billing button sells or manages. */
  tier?: string;
}

/**
 * The bar across the top of the dashboard: the way up, where you are, and the
 * three ways off the page — the plans, the account and signing out.
 */
const DashboardHeader: React.FC<DashboardHeaderProps> = ({ title, onUp, tier }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <IonHeader className="ion-no-border">
      <IonToolbar>
        <IonButtons slot="start">
          {onUp && (
            /* The folder above, not the root: from two levels down those are
               different places, and only one of them is "back". */
            <IonButton onClick={onUp} color="dark" title="Up one folder" aria-label="Up one folder">
              <IonIcon icon={arrowBack} aria-hidden="true" />
            </IonButton>
          )}
        </IonButtons>
        {/* The name of the folder that is open, when one is: the owner's,
            and kept out of what Hotjar records. */}
        <IonTitle data-hj-suppress="">{title}</IonTitle>
        <IonButtons slot="end">
          {/* The only permanent way into billing: UpgradeBanner appears at
              80% usage, so without this a user could not reach the plans at
              all, and a Pro user had no route to the customer portal.
              Hidden where Stripe is not configured, and in the native shell,
              which sells nothing at all — see billingIsOffered. */}
          {billingIsOffered() && (
            <IonButton
              onClick={() => navigate('/pricing')}
              color="dark"
              data-testid="pricing-link"
              title={tier === 'pro' ? 'Manage subscription' : 'Plans'}
              aria-label={tier === 'pro' ? 'Manage subscription' : 'Plans'}
            >
              <IonIcon icon={tier === 'pro' ? star : rocketOutline} aria-hidden="true" />
            </IonButton>
          )}
          {/* Both stores require a person who can create an account to be
              able to delete it from inside the app, and to find that without
              being told where it is — Apple 5.1.1(v), Google's account
              deletion policy. The page behind it is where it lives. */}
          <IonButton
            onClick={() => navigate('/account')}
            color="dark"
            data-testid="account-link"
            title="Account"
            aria-label="Account"
          >
            <IonIcon icon={personCircleOutline} aria-hidden="true" />
          </IonButton>
          <IonButton onClick={handleLogout} color="dark" aria-label="Sign out">
            <IonIcon icon={logOutOutline} aria-hidden="true" />
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
  );
};

export default DashboardHeader;
