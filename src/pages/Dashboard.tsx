import { useNavigate, useParams } from 'react-router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonToast,
} from '@ionic/react';
import { add, createOutline } from 'ionicons/icons';
import DashboardHeader from '../components/DashboardHeader';
import DeleteFileDialog from '../components/DeleteFileDialog';
import FileFilters, { type FileFiltersValue } from '../components/FileFilters';
import FileList from '../components/FileList';
import FolderActions from '../components/FolderActions';
import FolderBreadcrumbs from '../components/FolderBreadcrumbs';
import FolderGrid from '../components/FolderGrid';
import NewFolderDialog from '../components/NewFolderDialog';
import OfflineQueueBanner from '../components/OfflineQueueBanner';
import StorageMeter from '../components/StorageMeter';
import { useFileListing } from '../hooks/useFileListing';
import { useFolderTrail } from '../hooks/useFolderTrail';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { useSearchIndex } from '../hooks/useSearchIndex';
import { useStorageMutations } from '../hooks/useStorageMutations';
import { useStorageUsage } from '../hooks/useStorageUsage';
import { DEFAULT_DIRECTION, DEFAULT_SORT } from '../utils/file-query';
import type { Folder } from '../services/storage.service';
import { useProfile } from '../hooks/useProfile';
import UpgradeBanner from '../components/UpgradeBanner';
import { useState } from 'react';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const offlineQueue = useOfflineQueue();
  /* Which dialog is open, and about what. What each one asks, and what it
     does with the answer, is in the component that shows it. */
  const [showFolderAlert, setShowFolderAlert] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<Folder | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [filters, setFilters] = useState<FileFiltersValue>({
    search: '',
    sort: DEFAULT_SORT,
    direction: DEFAULT_DIRECTION,
    group: 'all',
    mode: 'name',
  });

  /* What the page shows and what it can change. Where each comes from, and
     what a change makes stale, is in the hook that holds it. */
  const listing = useFileListing(folderId, filters);
  const {
    items,
    searching,
    smartSearching,
    smartModel,
    loading: listLoading,
    error: listError,
    hasNextPage,
    fetchNextPage,
  } = listing;
  const { unindexed, indexing, indexMissing } = useSearchIndex({
    enabled: smartSearching,
    model: smartModel,
    onProblem: setErrorToast,
  });
  const { folder: currentFolder, path: folderPath, parentId } = useFolderTrail(folderId);
  const usage = useStorageUsage();
  const { renameFolder, deleteFolder, deleteFile, createFolder } = useStorageMutations({
    folderId,
    onProblem: setErrorToast,
  });

  const openFolder = (id: string | null) => navigate(id ? `/dashboard/${id}` : '/dashboard');

  const handleRefresh = async (event: CustomEvent) => {
    await Promise.all([listing.refresh(), usage.refresh()]);
    (event.target as HTMLIonRefresherElement).complete();
  };

  return (
    <IonPage>
      <DashboardHeader
        /* At the root you are not inside a folder, and the bar said "Folder"
           anyway — on the dashboard, in the mobile header, and in the hero
           screenshot of the README. */
        title={folderId && currentFolder ? currentFolder.name : 'My Files'}
        onUp={folderId ? () => openFolder(parentId) : undefined}
        tier={profile?.tier}
      />

      <IonContent fullscreen className="ion-padding-horizontal">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="dashboard-header-spacer">
          <StorageMeter
            usedBytes={usage.usedBytes}
            storageLimit={usage.storageLimit}
            tier={profile?.tier}
          />

          <UpgradeBanner
            usedBytes={usage.usedBytes}
            storageLimit={usage.storageLimit}
            tier={profile?.tier}
          />

          <div className="dashboard-actions-grid">
            <IonButton
              className="premium-button"
              expand="block"
              onClick={() => navigate(folderId ? `/upload/${folderId}` : '/upload')}
            >
              <IonIcon icon={add} slot="start" aria-hidden="true" />
              Upload
            </IonButton>
            <IonButton
              color="light"
              className="premium-button new-folder-button"
              expand="block"
              onClick={() => setShowFolderAlert(true)}
            >
              <IonIcon icon={createOutline} slot="start" aria-hidden="true" />
              New Folder
            </IonButton>
          </div>

          <OfflineQueueBanner
            pending={offlineQueue.pending}
            discarded={offlineQueue.lastResult?.discarded ?? []}
            onRetry={() => offlineQueue.flush()}
          />

          {folderId && folderPath.length > 0 && (
            <FolderBreadcrumbs path={folderPath} onNavigate={openFolder} />
          )}

          <FileFilters
            value={filters}
            onChange={setFilters}
            resultCount={items.files.length}
            /* An empty list after a failed search is not an empty result, and
               saying "nothing matches" about a search that never ran is the
               kind of small lie that makes the rest look unreliable. */
            searchFailed={!!listError}
          />

          {smartSearching && (unindexed?.length ?? 0) > 0 && (
            <div className="smart-index-row">
              <IonText color="medium">
                {unindexed!.length} file{unindexed!.length === 1 ? '' : 's'} not indexed yet
              </IonText>
              <IonButton size="small" fill="outline" disabled={!!indexing} onClick={indexMissing}>
                {indexing ? `Indexing ${indexing.done}/${indexing.total}` : 'Index them'}
              </IonButton>
            </div>
          )}

          <FolderGrid
            folders={items.folders}
            onOpen={(folder) => navigate(`/dashboard/${folder.id}`)}
            onActions={setFolderMenu}
          />

          <FileList
            files={items.files}
            loading={listLoading}
            error={listError}
            searching={searching}
            smartSearching={smartSearching}
            hasFolders={items.folders.length > 0}
            hasNextPage={hasNextPage}
            onLoadMore={fetchNextPage}
            onOpen={(file) => navigate(`/file/${file.id}`)}
            onDelete={(file) => setFileToDelete(file.id!)}
          />
        </div>

        <FolderActions
          folder={folderMenu}
          onClose={() => setFolderMenu(null)}
          onRename={(folder, name) => renameFolder.mutate({ folder, name })}
          onDelete={(folder) => deleteFolder.mutate(folder)}
        />

        <IonToast
          isOpen={deleteFile.isError}
          message="Failed to delete file"
          duration={3000}
          color="danger"
        />

        <DeleteFileDialog
          fileId={fileToDelete}
          onDismiss={() => setFileToDelete(null)}
          onConfirm={(fileId) => deleteFile.mutate(fileId)}
        />

        <NewFolderDialog
          isOpen={showFolderAlert}
          onDismiss={() => setShowFolderAlert(false)}
          onCreate={(name) => createFolder.mutate(name)}
        />

        <IonToast
          isOpen={!!errorToast}
          message={errorToast || 'An error occurred'}
          duration={3000}
          color="danger"
          onDidDismiss={() => setErrorToast(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
