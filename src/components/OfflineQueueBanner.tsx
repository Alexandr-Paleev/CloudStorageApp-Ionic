import { IonButton, IonIcon, IonLabel } from '@ionic/react';
import { alertCircleOutline, cloudOfflineOutline } from 'ionicons/icons';
import type { QueuedMutation } from '../services/mutation-queue';
import './OfflineQueueBanner.css';

interface OfflineQueueBannerProps {
  pending: number;
  /** Changes the server refused often enough to give up on. */
  discarded?: QueuedMutation[];
  onRetry: () => void;
}

const WHAT = {
  renameFile: 'Renaming a file',
  deleteFile: 'Deleting a file',
  renameFolder: 'Renaming a folder',
  deleteFolder: 'Deleting a folder',
} as const;

/**
 * What is waiting for the network.
 *
 * Shown whenever anything is queued, online or not: a change that has not
 * reached the server is worth knowing about even when the browser believes it
 * is connected — that is precisely the case where it would otherwise look as
 * though the rename simply worked.
 */
const OfflineQueueBanner: React.FC<OfflineQueueBannerProps> = ({
  pending,
  discarded = [],
  onRetry,
}) => {
  if (pending === 0 && discarded.length === 0) return null;

  /* A change that was given up on gets its own line, in red. The banner used
     to simply disappear when the queue emptied, whether every change had gone
     through or the last three attempts had failed — which meant a change the
     user watched apply on screen could vanish without a word. */
  if (pending === 0) {
    return (
      <div
        className="offline-queue-banner offline-queue-banner--failed"
        data-testid="offline-queue"
      >
        <IonIcon icon={alertCircleOutline} aria-hidden="true" />
        <IonLabel>
          {discarded.length === 1
            ? `${WHAT[discarded[0].op.kind]} did not go through: ${discarded[0].lastError ?? 'the server refused it'}`
            : `${discarded.length} changes did not go through and were not kept.`}
        </IonLabel>
      </div>
    );
  }

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
