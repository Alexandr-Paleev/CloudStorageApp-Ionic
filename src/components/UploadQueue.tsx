import { IonButton, IonIcon, IonLabel, IonProgressBar, IonText } from '@ionic/react';
import { checkmarkCircle, closeCircle, close, pauseCircle } from 'ionicons/icons';
import { formatFileSize } from '../utils/format.utils';
import type { QueueItem } from '../utils/upload-queue';

interface UploadQueueProps {
  items: QueueItem[];
  /** True while the runner is working through the queue. */
  running: boolean;
  onRemove: (id: string) => void;
  /** Offered for a paused file small enough to simply start again. */
  onRetry: (id: string) => void;
}

const STATUS_ICON = {
  done: checkmarkCircle,
  failed: closeCircle,
  paused: pauseCircle,
} as const;

/**
 * The files waiting, going, and finished.
 *
 * One row each rather than a single bar, because a queue of ten hides the one
 * that failed: the summary would say "9 uploaded" and the tenth would be a
 * mystery until the dashboard came up short.
 */
const UploadQueue: React.FC<UploadQueueProps> = ({ items, running, onRemove, onRetry }) => {
  if (items.length === 0) return null;

  return (
    <div className="upload-queue" data-testid="upload-queue">
      {items.map((item) => {
        const icon = STATUS_ICON[item.status as keyof typeof STATUS_ICON];

        return (
          <div key={item.id} className={`upload-queue-item upload-queue-item--${item.status}`}>
            <div className="upload-queue-head">
              {/* data-hj-suppress masks file names from Hotjar recordings for privacy */}
              <IonText color="dark" className="upload-queue-name" data-hj-suppress>
                {item.file.name}
              </IonText>

              {icon && (
                <IonIcon
                  icon={icon}
                  className={`upload-queue-icon upload-queue-icon--${item.status}`}
                  aria-label={item.status}
                />
              )}

              {/* Only a file that has not started can be taken out; removing one
                  mid-flight would leave an upload running for a row nobody can
                  see. */}
              {item.status === 'pending' && !running && (
                <IonButton
                  fill="clear"
                  size="small"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => onRemove(item.id)}
                >
                  <IonIcon icon={close} aria-hidden="true" />
                </IonButton>
              )}
            </div>

            <IonLabel className="upload-queue-meta" color="medium">
              {formatFileSize(item.file.size)}
              {item.status === 'uploading' && ` • ${item.progress.toFixed(0)}%`}
              {item.status === 'failed' && ` • ${item.error ?? 'failed'}`}
              {item.status === 'paused' && ' • paused'}
            </IonLabel>

            {item.status === 'uploading' && (
              <IonProgressBar
                value={item.progress / 100}
                aria-label={`Uploading ${item.file.name}`}
              />
            )}

            {item.status === 'paused' && (
              <IonButton size="small" fill="outline" onClick={() => onRetry(item.id)}>
                Resume
              </IonButton>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default UploadQueue;
