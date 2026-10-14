import { useNavigate, useParams } from 'react-router';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonItem,
  IonLabel,
  IonIcon,
  IonButtons,
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonList,
  IonGrid,
  IonRow,
  IonCol,
  IonText,
} from '@ionic/react';
import {
  add,
  logOutOutline,
  personCircleOutline,
  documentTextOutline,
  imageOutline,
  folderOpen,
  ellipsisHorizontal,
  arrowBack,
  createOutline,
  trashOutline,
  cloud,
  rocketOutline,
  star,
} from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import DeleteFileDialog from '../components/DeleteFileDialog';
import FileFilters, { type FileFiltersValue } from '../components/FileFilters';
import FolderActions from '../components/FolderActions';
import FolderBreadcrumbs from '../components/FolderBreadcrumbs';
import NewFolderDialog from '../components/NewFolderDialog';
import OfflineQueueBanner from '../components/OfflineQueueBanner';
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
import { billingIsOffered } from '../utils/billing.utils';
import { HttpError } from '../utils/http.utils';
import { useState } from 'react';
import { getThumbnailUrl } from '../utils/thumbnail.utils';
import { formatFileSize, formatDateTime } from '../utils/format.utils';
import { storageMeter } from '../utils/quota.utils';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { logout } = useAuth();
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
    loading: listLoading,
    error: listError,
    hasNextPage,
    fetchNextPage,
  } = listing;
  const { unindexed, indexing, indexMissing } = useSearchIndex({
    enabled: smartSearching,
    onProblem: setErrorToast,
  });
  const { folder: currentFolder, path: folderPath, parentId } = useFolderTrail(folderId);
  const usage = useStorageUsage();
  const { renameFolder, deleteFolder, deleteFile, createFolder } = useStorageMutations({
    folderId,
    onProblem: setErrorToast,
  });

  const openFolder = (id: string | null) => navigate(id ? `/dashboard/${id}` : '/dashboard');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleRefresh = async (event: CustomEvent) => {
    await Promise.all([listing.refresh(), usage.refresh()]);
    (event.target as HTMLIonRefresherElement).complete();
  };

  const getFileIcon = (type: string | undefined) => {
    if (!type) return documentTextOutline;
    if (type.startsWith('image/')) return imageOutline;
    if (type === 'application/pdf') return documentTextOutline;
    return documentTextOutline;
  };

  const { usedBytes, storageLimit } = usage;
  const {
    barWidth,
    percentage: percentageDisplay,
    isOverLimit,
  } = storageMeter(usedBytes, storageLimit);

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            {folderId && (
              /* The folder above, not the root: from two levels down those are
                 different places, and only one of them is "back". */
              <IonButton
                onClick={() => openFolder(parentId)}
                color="dark"
                title="Up one folder"
                aria-label="Up one folder"
              >
                <IonIcon icon={arrowBack} aria-hidden="true" />
              </IonButton>
            )}
          </IonButtons>
          {/* At the root you are not inside a folder, and the bar said "Folder"
              anyway — on the dashboard, in the mobile header, and in the hero
              screenshot of the README. */}
          <IonTitle>{folderId && currentFolder ? currentFolder.name : 'My Files'}</IonTitle>
          <IonButtons slot="end">
            {/* The only permanent way into billing: UpgradeBanner appears at
                80% usage, so without this a user could not reach the plans at
                all, and a Pro user had no route to the customer portal.
                Hidden where Stripe is not configured, and in the native shell,
                which sells nothing at all — see billingIsOffered. */}
            {billingIsOffered() && (
              <IonButton
                onClick={() => navigate('/pricing')}
                color="dark"
                data-testid="pricing-link"
                title={profile?.tier === 'pro' ? 'Manage subscription' : 'Plans'}
                aria-label={profile?.tier === 'pro' ? 'Manage subscription' : 'Plans'}
              >
                <IonIcon icon={profile?.tier === 'pro' ? star : rocketOutline} aria-hidden="true" />
              </IonButton>
            )}
            {/* Both stores require a person who can create an account to be
                able to delete it from inside the app, and to find that without
                being told where it is — Apple 5.1.1(v), Google's account
                deletion policy. The page behind it is where it lives. */}
            <IonButton
              onClick={() => navigate('/account')}
              color="dark"
              data-testid="account-link"
              title="Account"
              aria-label="Account"
            >
              <IonIcon icon={personCircleOutline} aria-hidden="true" />
            </IonButton>
            <IonButton onClick={handleLogout} color="dark" aria-label="Sign out">
              <IonIcon icon={logOutOutline} aria-hidden="true" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="ion-padding-horizontal">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="dashboard-header-spacer">
          <div className="glass-card storage-card">
            <div className="storage-header">
              <IonText color="dark" className="storage-title">
                Storage Used
              </IonText>
              <IonText color={isOverLimit ? 'danger' : 'medium'} className="storage-percentage">
                {percentageDisplay}%
              </IonText>
            </div>

            <div className="storage-bar-container">
              <div
                className="storage-bar-fill"
                style={{
                  width: `${barWidth}%`,
                }}
              />
            </div>

            <IonText color={isOverLimit ? 'danger' : 'medium'} className="storage-stats">
              {formatFileSize(usedBytes)} of {formatFileSize(storageLimit)} used
              {isOverLimit &&
                ` — ${formatFileSize(usedBytes - storageLimit)} over the limit, uploads are blocked until you free up space`}
              {profile?.tier === 'pro' && <span className="tier-badge tier-badge--pro">Pro</span>}
            </IonText>
          </div>

          <UpgradeBanner usedBytes={usedBytes} storageLimit={storageLimit} tier={profile?.tier} />

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

          {items?.folders && items.folders.length > 0 && (
            <div className="folders-section">
              <IonText color="dark" className="section-title">
                Folders
              </IonText>
              <IonGrid className="folders-grid">
                <IonRow>
                  {items.folders.map((f) => (
                    <IonCol size="6" sizeSm="4" sizeMd="3" key={f.id}>
                      <div className="folder-card">
                        <IonIcon icon={folderOpen} className="folder-icon" aria-hidden="true" />
                        <IonText color="dark" className="folder-name">
                          {f.name}
                        </IonText>

                        {/* The card was the button, and the menu below was a
                            button inside it. Now the card is a plain container
                            and this one covers it, leaving the menu a sibling
                            that keyboard and screen readers can reach on their
                            own. */}
                        <button
                          type="button"
                          className="row-open"
                          onClick={() => navigate(`/dashboard/${f.id}`)}
                        >
                          <span className="sr-only">Open {f.name}</span>
                        </button>

                        {/* stopPropagation, or opening the menu also opens the
                            folder the menu belongs to. */}
                        <IonButton
                          fill="clear"
                          size="small"
                          className="folder-menu-button"
                          aria-label={`Actions for ${f.name}`}
                          data-testid={`folder-actions-${f.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderMenu(f);
                          }}
                        >
                          <IonIcon icon={ellipsisHorizontal} aria-hidden="true" />
                        </IonButton>
                      </div>
                    </IonCol>
                  ))}
                </IonRow>
              </IonGrid>
            </div>
          )}

          <div>
            <IonText color="dark" className="section-title">
              Files
            </IonText>

            {listLoading && (
              <div className="files-loading">
                <IonSpinner color="primary" aria-label="Loading files" />
              </div>
            )}

            {listError && (
              <div className="files-error">
                {/* The message itself for a smart search. It fails for reasons
                    the person can act on — this deployment has no key for the
                    provider, this database has no migration 011 — and "Error
                    loading items" hides every one of them behind the same
                    sentence. */}
                {smartSearching && listError instanceof HttpError && listError.status === 501
                  ? /* The server's own words name environment variables. That
                       sentence is for whoever deploys this, not for whoever is
                       looking at it — it stays in the console and in Sentry. */
                    'Smart search is not set up on this deployment.'
                  : smartSearching && listError instanceof Error
                    ? listError.message
                    : 'Error loading items.'}
              </div>
            )}

            {!listLoading &&
              /* Not while searching: an empty result is not an empty account,
                 and the note under the searchbar has already said which of
                 the two this is. */
              !searching &&
              items?.files.length === 0 &&
              (!items.folders || items.folders.length === 0) && (
                <div className="files-empty">
                  <IonIcon icon={cloud} className="files-empty-icon" aria-hidden="true" />
                  <p>No files yet. Upload something!</p>
                </div>
              )}

            <IonList lines="none" className="files-list">
              {items?.files.map((file) => (
                /* The row is the list item itself. It used to be a div with
                   role="button" wrapped around an ion-item, which broke three
                   things at once: a list whose children were not list items, a
                   list item with no list above it, and a delete button nested
                   inside a button. The primary action is now a real button
                   stretched over the row, and delete is its sibling — two
                   controls side by side, inside one list item. */
                <IonItem
                  key={file.id}
                  detail={false}
                  lines="none"
                  className="glass-card file-list-item file-item-inner"
                >
                  <div slot="start" className="file-thumbnail-container">
                    {file.type?.startsWith('image/') ? (
                      <div className="file-thumbnail-img-box">
                        {/* getThumbnailUrl only resizes on Cloudinary — the
                              other backends hand back the original, so a long
                              list would otherwise fetch every full-size image
                              at once. lazy + async decoding keeps the ones
                              below the fold out of the way; the dimensions
                              reserve the box so the list does not jump. */}
                        <img
                          src={getThumbnailUrl(file.download_url, file.storage_type, 100, 100)}
                          alt={file.name}
                          className="file-thumbnail-img"
                          loading="lazy"
                          decoding="async"
                          width={100}
                          height={100}
                        />
                      </div>
                    ) : (
                      <div className="file-icon-box">
                        <IonIcon
                          icon={getFileIcon(file.type)}
                          className="file-icon"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </div>

                  <IonLabel className="ion-text-wrap">
                    <h2 className="file-meta-name">{file.name}</h2>
                    <p className="file-meta-details">
                      {formatFileSize(file.size)} • {formatDateTime(file.created_at)}
                    </p>
                    {'summary' in file && typeof file.summary === 'string' && (
                      /* Why this one came back. A ranked list with no reason
                         attached is indistinguishable from a wrong one — and
                         the sentence under the name is also what the search
                         actually matched against. */
                      <p className="file-meta-summary">{file.summary}</p>
                    )}
                  </IonLabel>

                  {/* Stretched over the row rather than wrapped around it, so
                        the whole card stays clickable without swallowing the
                        delete button. */}
                  <button
                    type="button"
                    className="row-open"
                    onClick={() => navigate(`/file/${file.id}`)}
                  >
                    <span className="sr-only">Open {file.name}</span>
                  </button>

                  <IonButton
                    slot="end"
                    fill="clear"
                    color="medium"
                    aria-label={`Delete ${file.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFileToDelete(file.id!);
                    }}
                  >
                    <IonIcon
                      icon={trashOutline}
                      color="danger"
                      className="file-delete-icon"
                      aria-hidden="true"
                    />
                  </IonButton>
                </IonItem>
              ))}
            </IonList>

            <IonInfiniteScroll
              onIonInfinite={async (ev) => {
                await fetchNextPage();
                (ev.target as HTMLIonInfiniteScrollElement).complete();
              }}
              disabled={!hasNextPage}
            >
              <IonInfiniteScrollContent loadingText="" loadingSpinner="bubbles" />
            </IonInfiniteScroll>
          </div>
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
