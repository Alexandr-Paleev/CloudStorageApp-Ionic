import { useId } from 'react';
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
  /* The ids that name each row's progress bar. Not the upload's key: that is
     its path in storage, and ends in the file's name. */
  const base = useId();
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
        {uploads.map((upload, index) => {
          const done = upload.partCount > 0 ? upload.completed.length / upload.partCount : 0;
          const busy = busyKey === upload.key;
          const nameId = `${base}-name-${index}`;

          return (
            /* The whole row is kept out of what Hotjar records, as the upload
               queue's are, and the bar is named by the name it shows rather
               than given it as a label: Hotjar records an attribute as it is,
               hidden or not (src/test/hotjar.ts). */
            <IonItem key={upload.key} lines="full" data-hj-suppress="">
              <IonLabel>
                <h2 id={nameId}>{upload.fileName}</h2>
                <p>
                  {formatFileSize(upload.size)} • {Math.round(done * 100)}% sent (
                  {upload.completed.length} of {upload.partCount} parts)
                </p>
                <IonProgressBar value={done} aria-labelledby={nameId} />
              </IonLabel>

              <IonButton
                slot="end"
                size="small"
                disabled={!!busyKey}
                onClick={() => onResume(upload)}
              >
                {busy ? <IonSpinner name="crescent" aria-label="Working" /> : 'Resume'}
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
