import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonItem,
  IonLabel,
  IonProgressBar,
  IonSpinner,
} from '@ionic/react';
import type { PendingUpload } from '../services/storage.service';
import { formatFileSize } from '../utils/format.utils';

interface ResumableUploadsProps {
  uploads: PendingUpload[];
  /** The upload currently being resumed or discarded, if any. */
  busyKey?: string | null;
  onResume: (upload: PendingUpload) => void;
  onDiscard: (upload: PendingUpload) => void;
}

/**
 * The uploads that did not finish, and what can be done about them.
 *
 * Deliberately shown before the file picker rather than in a toast: someone
 * who closed the tab three quarters of the way through a large file is coming
 * back to finish it, and asking them to choose the file again would defeat the
 * point of having kept the parts.
 */
const ResumableUploads: React.FC<ResumableUploadsProps> = ({
  uploads,
  busyKey,
  onResume,
  onDiscard,
}) => {
  if (uploads.length === 0) return null;

  return (
    <IonCard>
      <IonCardHeader>
        <IonCardTitle>Unfinished uploads</IonCardTitle>
        <IonCardSubtitle>
          The parts already sent are still in storage — these carry on from where they stopped.
        </IonCardSubtitle>
      </IonCardHeader>
      <IonCardContent>
        {uploads.map((upload) => {
          const done = upload.partCount > 0 ? upload.completed.length / upload.partCount : 0;
          const busy = busyKey === upload.key;

          return (
            <IonItem key={upload.key} lines="full">
              <IonLabel>
                {/* data-hj-suppress masks file names from Hotjar recordings for privacy */}
                <h2 data-hj-suppress>{upload.fileName}</h2>
                <p>
                  {formatFileSize(upload.size)} • {Math.round(done * 100)}% sent (
                  {upload.completed.length} of {upload.partCount} parts)
                </p>
                <IonProgressBar value={done} />
              </IonLabel>

              <IonButton
                slot="end"
                size="small"
                disabled={!!busyKey}
                onClick={() => onResume(upload)}
              >
                {busy ? <IonSpinner name="crescent" /> : 'Resume'}
              </IonButton>
              <IonButton
                slot="end"
                size="small"
                fill="clear"
                color="medium"
                disabled={!!busyKey}
                onClick={() => onDiscard(upload)}
              >
                Discard
              </IonButton>
            </IonItem>
          );
        })}
      </IonCardContent>
    </IonCard>
  );
};

export default ResumableUploads;
