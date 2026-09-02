import { IonButton, IonIcon, IonLabel } from '@ionic/react';
import { cloudOfflineOutline } from 'ionicons/icons';

interface OfflineQueueBannerProps {
  pending: number;
  onRetry: () => void;
}

/**
 * What is waiting for the network.
 *
 * Shown whenever anything is queued, online or not: a change that has not
 * reached the server is worth knowing about even when the browser believes it
 * is connected — that is precisely the case where it would otherwise look as
 * though the rename simply worked.
 */
const OfflineQueueBanner: React.FC<OfflineQueueBannerProps> = ({ pending, onRetry }) => {
  if (pending === 0) return null;

  return (
    <div className="offline-queue-banner" data-testid="offline-queue">
      <IonIcon icon={cloudOfflineOutline} aria-hidden="true" />
      <IonLabel>
        {pending} change{pending === 1 ? '' : 's'} waiting for the network. They will be sent when
        it comes back.
      </IonLabel>
      <IonButton size="small" fill="clear" onClick={onRetry}>
        Try now
      </IonButton>
    </div>
  );
};

export default OfflineQueueBanner;
