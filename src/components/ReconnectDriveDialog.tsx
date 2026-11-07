import { IonAlert } from '@ionic/react';

interface ReconnectDriveDialogProps {
  /** What could not be deleted, or null when nothing is waiting. */
  blocked: 'file' | 'folder' | null;
  onDismiss: () => void;
  /** Connect Drive, then delete again. Called from the press itself, so the
   *  window Google opens is not taken for a pop-up nobody asked for. */
  onConnect: () => void;
  /** Take what is in Drive off the list, and leave it there. */
  onRemoveFromList: () => void;
}

/**
 * What a deletion asks once Google Drive is not connected any more.
 *
 * A Drive token lasts an hour, and Supabase drops the one a Google sign-in
 * brings along before that. Past it, a file in Drive could not be deleted at
 * all: its row goes only after the provider has said yes, there was no token
 * to ask with, and the page said "Failed to delete". The one place to connect
 * Drive again was the upload page, which a free account under its quota has
 * no reason to open. So two ways out: connect and delete it in Drive, or
 * take it off this list and leave it in Drive, for a person who cannot reach
 * that account any more.
 */
const ReconnectDriveDialog: React.FC<ReconnectDriveDialogProps> = ({
  blocked,
  onDismiss,
  onConnect,
  onRemoveFromList,
}) => (
  <IonAlert
    isOpen={blocked !== null}
    onDidDismiss={onDismiss}
    header="Google Drive is not connected"
    message={
      blocked === 'folder'
        ? 'Some files in this folder are in your Google Drive. Connect Drive to delete them there too, or remove them from this list and keep them in your Drive.'
        : 'This file is in your Google Drive. Connect Drive to delete it there, or remove it from this list and keep it in your Drive.'
    }
    buttons={[
      { text: 'Cancel', role: 'cancel' },
      { text: 'Remove from list', handler: () => onRemoveFromList() },
      { text: 'Connect Drive', handler: () => onConnect() },
    ]}
  />
);

export default ReconnectDriveDialog;
