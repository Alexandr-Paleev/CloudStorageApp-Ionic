import { IonAlert } from '@ionic/react';

interface DeleteFileDialogProps {
  /** The file being asked about, or null when nothing is. */
  fileId: string | null;
  onDismiss: () => void;
  /** Called once the person has said yes, and not before. */
  onConfirm: (fileId: string) => void;
}

/**
 * The question between a tap on the bin and a file that is gone.
 *
 * Deletion is permanent and there is no trash, so the one thing the list must
 * never do is delete on a single tap.
 */
const DeleteFileDialog: React.FC<DeleteFileDialogProps> = ({ fileId, onDismiss, onConfirm }) => (
  <IonAlert
    isOpen={fileId !== null}
    onDidDismiss={onDismiss}
    header="Delete File"
    message="Are you sure you want to delete this file? This action is permanent."
    buttons={[
      {
        text: 'Cancel',
        role: 'cancel',
        handler: () => onDismiss(),
      },
      {
        text: 'Delete',
        role: 'destructive',
        handler: () => {
          if (fileId) onConfirm(fileId);
        },
      },
    ]}
  />
);

export default DeleteFileDialog;
