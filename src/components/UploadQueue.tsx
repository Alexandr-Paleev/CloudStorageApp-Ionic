import { useId } from 'react';
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
  /* For the ids that name the progress bars. Not the item's own id: that is
     made of the file's name (utils/upload-queue.ts), and Hotjar records an id
     as it is. */
  const base = useId();
  if (items.length === 0) return null;

  return (
    <div className="upload-queue" data-testid="upload-queue">
      {items.map((item, index) => {
        const icon = STATUS_ICON[item.status as keyof typeof STATUS_ICON];
        const nameId = `${base}-name-${index}`;

        return (
          /* The file's name, and a failure that may repeat it, are kept out of
             what Hotjar records. The controls below are named from the text,
             never with the name in an attribute: Hotjar records those whatever
             is around them. */
          <div
            key={item.id}
            className={`upload-queue-item upload-queue-item--${item.status}`}
            data-hj-suppress=""
          >
            <div className="upload-queue-head">
              <IonText id={nameId} color="dark" className="upload-queue-name">
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
                <IonButton fill="clear" size="small" onClick={() => onRemove(item.id)}>
                  <IonIcon icon={close} aria-hidden="true" />
                  <span className="sr-only">Remove {item.file.name}</span>
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
              <IonProgressBar value={item.progress / 100} aria-labelledby={nameId} />
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
