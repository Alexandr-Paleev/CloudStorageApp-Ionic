import { IonAlert, type AlertInput } from '@ionic/react';

/**
 * One array for the life of the module, never a literal in the JSX.
 *
 * Ionic's alert rebuilds its fields whenever `inputs` is a different array,
 * and what has been typed lives in those fields. A literal is a new array on
 * every render, so any render while the dialog was open, such as a query
 * settling, wiped the typing. The text stayed on screen, the button read an
 * empty value, and New Folder quietly created nothing. Reproduced in Chrome
 * with Ionic 9.0.5. The same holds for Rename, in FolderActions.tsx, whose
 * array is memoised.
 */
const NEW_FOLDER_INPUTS: AlertInput[] = [
  { name: 'folderName', type: 'text', placeholder: 'Folder name' },
];

interface NewFolderDialogProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** Given a name with something in it, already trimmed. */
  onCreate: (name: string) => void;
}

/** Asks what a new folder is to be called. Where it goes is the page's to know. */
const NewFolderDialog: React.FC<NewFolderDialogProps> = ({ isOpen, onDismiss, onCreate }) => (
  <IonAlert
    isOpen={isOpen}
    onDidDismiss={onDismiss}
    header={'New Folder'}
    inputs={NEW_FOLDER_INPUTS}
    buttons={[
      {
        text: 'Cancel',
        role: 'cancel',
        handler: () => onDismiss(),
      },
      {
        text: 'Create',
        handler: (data: { folderName?: string }) => {
          const name = data.folderName?.trim();
          // Kept open rather than closed on nothing: an empty name is a
          // slip to correct, and a dialog that vanishes reads as success.
          if (!name) return false;
          onCreate(name);
        },
      },
    ]}
  />
);

export default NewFolderDialog;
