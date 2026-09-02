import { IonIcon, IonText } from '@ionic/react';
import { chevronForward, homeOutline } from 'ionicons/icons';
import type { Folder } from '../services/storage.service';

interface FolderBreadcrumbsProps {
  /** Root first, the folder currently open last. */
  path: Folder[];
  onNavigate: (folderId: string | null) => void;
}

/**
 * Where you are, and one click back to anywhere above it.
 *
 * The dashboard used to offer a single arrow that went to the root, whatever
 * the depth — from two levels down, "back" skipped the folder that was
 * actually above. The schema has had `parent_id` from the start; nothing in
 * the interface used it.
 */
const FolderBreadcrumbs: React.FC<FolderBreadcrumbsProps> = ({ path, onNavigate }) => {
  if (path.length === 0) return null;

  return (
    <nav className="folder-breadcrumbs" aria-label="Folder path">
      <button type="button" className="crumb" onClick={() => onNavigate(null)}>
        <IonIcon icon={homeOutline} aria-hidden="true" />
        <span>Home</span>
      </button>

      {path.map((folder, index) => {
        const isCurrent = index === path.length - 1;

        return (
          <span key={folder.id} className="crumb-group">
            <IonIcon icon={chevronForward} className="crumb-separator" aria-hidden="true" />
            {isCurrent ? (
              /* The folder you are already in is not a link — offering it as
                 one invites a click that does nothing. */
              <IonText color="dark" className="crumb crumb--current" aria-current="page">
                {folder.name}
              </IonText>
            ) : (
              <button type="button" className="crumb" onClick={() => onNavigate(folder.id ?? null)}>
                {folder.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
};

export default FolderBreadcrumbs;
