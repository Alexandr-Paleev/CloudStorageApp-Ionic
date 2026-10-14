import { useMemo, useState } from 'react';
import { IonActionSheet, IonAlert, type AlertInput } from '@ionic/react';
import type { Folder } from '../services/storage.service';

interface FolderActionsProps {
  /** The folder whose menu is open, or null when no menu is. */
  folder: Folder | null;
  /** The menu has gone, whatever was chosen from it. */
  onClose: () => void;
  /** Given a name that is not empty and not the one the folder already has. */
  onRename: (folder: Folder, name: string) => void;
  /** Called once the person has said yes, and not before. */
  onDelete: (folder: Folder) => void;
}

/**
 * What can be done to a folder: its menu, and the dialog each choice leads to.
 *
 * The three overlays have to appear one after another, and that is why they
 * are one component. The dashboard used to hold all of it, as four pieces of
 * state beside everything else that page keeps track of. All it holds now is
 * which folder's menu is open.
 */
const FolderActions: React.FC<FolderActionsProps> = ({ folder, onClose, onRename, onDelete }) => {
  const [chosen, setChosen] = useState<'rename' | 'delete' | null>(null);
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);

  // A new array only when another name is being edited; see NewFolderDialog.
  const renameInputs = useMemo<AlertInput[]>(
    () => [{ name: 'name', type: 'text', value: renaming?.name, placeholder: 'Folder name' }],
    [renaming?.name]
  );

  return (
    <>
      <IonActionSheet
        isOpen={!!folder}
        header={folder?.name}
        /* The dialog opens here rather than in the button handler: Ionic
           presents one overlay at a time, and an alert asked for while the
           sheet is still dismissing never appears. */
        onDidDismiss={() => {
          if (chosen === 'rename') setRenaming(folder);
          if (chosen === 'delete') setDeleting(folder);
          setChosen(null);
          onClose();
        }}
        buttons={[
          { text: 'Rename', handler: () => setChosen('rename') },
          { text: 'Delete', role: 'destructive', handler: () => setChosen('delete') },
          { text: 'Cancel', role: 'cancel' },
        ]}
      />

      <IonAlert
        isOpen={!!renaming}
        onDidDismiss={() => setRenaming(null)}
        header="Rename folder"
        inputs={renameInputs}
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Save',
            handler: (data: { name?: string }) => {
              const name = data.name?.trim();
              if (!renaming || !name || name === renaming.name) return;
              onRename(renaming, name);
            },
          },
        ]}
      />

      <IonAlert
        isOpen={!!deleting}
        onDidDismiss={() => setDeleting(null)}
        header="Delete folder?"
        /* Said in full, because it cannot be undone and because what goes is
           more than what was clicked: every file inside, and every folder
           below it. */
        message={`“${deleting?.name}” and everything inside it — files and subfolders — will be deleted from storage. This cannot be undone.`}
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Delete',
            role: 'destructive',
            handler: () => {
              if (deleting) onDelete(deleting);
            },
          },
        ]}
      />
    </>
  );
};

export default FolderActions;
