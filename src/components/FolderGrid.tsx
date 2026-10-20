import { IonButton, IonCol, IonGrid, IonIcon, IonRow, IonText } from '@ionic/react';
import { ellipsisHorizontal, folderOpen } from 'ionicons/icons';
import type { Folder } from '../services/storage.service';

interface FolderGridProps {
  /** The folders inside the one that is open. With none, there is no section. */
  folders: Folder[];
  /** The card was pressed. */
  onOpen: (folder: Folder) => void;
  /** The button in the card's corner was pressed: the menu FolderActions shows. */
  onActions: (folder: Folder) => void;
}

/** The folders inside the open one, as cards, each with a menu of its own. */
const FolderGrid: React.FC<FolderGridProps> = ({ folders, onOpen, onActions }) => {
  if (folders.length === 0) return null;

  return (
    <div className="folders-section">
      <IonText color="dark" className="section-title">
        Folders
      </IonText>
      <IonGrid className="folders-grid">
        <IonRow>
          {folders.map((f) => (
            <IonCol size="6" sizeSm="4" sizeMd="3" key={f.id}>
              {/* The folder's name, wherever the card says it, is the owner's:
                  kept out of what Hotjar records, and out of attributes,
                  which it records whatever is around them. */}
              <div className="folder-card" data-hj-suppress="">
                <IonIcon icon={folderOpen} className="folder-icon" aria-hidden="true" />
                <IonText color="dark" className="folder-name">
                  {f.name}
                </IonText>

                {/* The card was the button, and the menu below was a
                    button inside it. Now the card is a plain container
                    and this one covers it, leaving the menu a sibling
                    that keyboard and screen readers can reach on their
                    own. */}
                <button type="button" className="row-open" onClick={() => onOpen(f)}>
                  <span className="sr-only">Open {f.name}</span>
                </button>

                {/* stopPropagation, or opening the menu also opens the
                    folder the menu belongs to. */}
                <IonButton
                  fill="clear"
                  size="small"
                  className="folder-menu-button"
                  data-testid={`folder-actions-${f.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onActions(f);
                  }}
                >
                  <IonIcon icon={ellipsisHorizontal} aria-hidden="true" />
                  <span className="sr-only">Actions for {f.name}</span>
                </IonButton>
              </div>
            </IonCol>
          ))}
        </IonRow>
      </IonGrid>
    </div>
  );
};

export default FolderGrid;
